import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


LOG = logging.getLogger("shipping_offer")
TOKEN_LOCK = threading.Lock()
ADMIN_TOKENS = {}
PROXY_MAX_AGE_SECONDS = 300
OFFER_SECONDS = 10 * 60
IP_HOURLY_LIMIT = 20
GRAPHQL_MUTATION = """
mutation CreateShippingOffer($input: DiscountCodeFreeShippingInput!) {
  discountCodeFreeShippingCreate(freeShippingCodeDiscount: $input) {
    codeDiscountNode { id }
    userErrors { field message }
  }
}
"""
SHOP_CURRENCY_QUERY = "query ShopCurrency { shop { currencyCode } }"
DELETE_DISCOUNT_MUTATION = """
mutation DeleteShippingOffer($id: ID!) {
  discountCodeDelete(id: $id) {
    deletedCodeDiscountId
    userErrors { field message }
  }
}
"""


class ConfigurationError(RuntimeError):
    pass


class ShopifyAPIError(RuntimeError):
    pass


def required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigurationError(f"Missing required environment variable: {name}")
    return value


class Config:
    def __init__(
        self,
        shop_domain,
        app_secret,
        client_id,
        database_path,
        api_version="2026-10",
        shipping_cap="none",
        daily_code_limit=100,
    ):
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*\.myshopify\.com", shop_domain):
            raise ConfigurationError("SHOPIFY_STORE_DOMAIN must be a *.myshopify.com domain.")
        if not re.fullmatch(r"\d{4}-\d{2}", api_version):
            raise ConfigurationError("SHOPIFY_API_VERSION must use YYYY-MM format.")
        cap_value = str(shipping_cap or "").strip().lower()
        if cap_value in ("", "none"):
            cap = None
        else:
            try:
                cap = float(cap_value)
            except ValueError as error:
                raise ConfigurationError("SHIPPING_DISCOUNT_CAP must be a positive amount or 'none'.") from error
            if cap <= 0:
                raise ConfigurationError("SHIPPING_DISCOUNT_CAP must be a positive amount or 'none'.")
        if daily_code_limit <= 0:
            raise ConfigurationError("DAILY_CODE_LIMIT must be a positive integer.")
        self.shop_domain = shop_domain
        self.app_secret = app_secret
        self.client_id = client_id
        self.database_path = database_path
        self.api_version = api_version
        self.shipping_cap = None if cap is None else f"{cap:.2f}"
        self.daily_code_limit = daily_code_limit

    @classmethod
    def from_env(cls):
        return cls(
            shop_domain=required_env("SHOPIFY_STORE_DOMAIN"),
            app_secret=required_env("SHOPIFY_API_SECRET"),
            client_id=required_env("SHOPIFY_CLIENT_ID"),
            database_path=os.environ.get("DATABASE_PATH", "/data/offers.sqlite3"),
            api_version=os.environ.get("SHOPIFY_API_VERSION", "2026-10"),
            shipping_cap=os.environ.get("SHIPPING_DISCOUNT_CAP", "none"),
            daily_code_limit=int(os.environ.get("DAILY_CODE_LIMIT", "100")),
        )


def _db_connect(config):
    if config.database_path != ":memory:":
        Path(config.database_path).parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(config.database_path, timeout=40)
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS offers (
            cart_hash TEXT PRIMARY KEY,
            discount_code TEXT NOT NULL UNIQUE,
            discount_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            ip_hash TEXT NOT NULL,
            discount_deleted INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    connection.execute("CREATE INDEX IF NOT EXISTS offers_ip_created ON offers(ip_hash, created_at)")
    return connection


@contextmanager
def _database(config):
    connection = _db_connect(config)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _hmac_hash(value, secret):
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def _eastern_day_start(timestamp):
    eastern_now = datetime.fromtimestamp(timestamp, ZoneInfo("America/New_York"))
    midnight = eastern_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(midnight.timestamp())


def verify_proxy_signature(query_string, app_secret, expected_shop, now=None):
    params = parse_qs(query_string, keep_blank_values=True, strict_parsing=False)
    signatures = params.pop("signature", [])
    if len(signatures) != 1 or not re.fullmatch(r"[a-fA-F0-9]{64}", signatures[0]):
        return None
    if len(params.get("timestamp", [])) != 1 or len(params.get("shop", [])) != 1:
        return None

    try:
        timestamp = int(params["timestamp"][0])
        shops = params["shop"]
    except (KeyError, IndexError, ValueError):
        return None

    current_time = int(time.time() if now is None else now)
    if abs(current_time - timestamp) > PROXY_MAX_AGE_SECONDS or shops != [expected_shop]:
        return None

    message = "".join(
        f"{key}={','.join(values)}"
        for key, values in sorted(params.items())
    )
    expected_signature = hmac.new(app_secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signatures[0].lower(), expected_signature):
        return None
    return params


def _shopify_graphql(config, query, variables):
    url = f"https://{config.shop_domain}/admin/api/{config.api_version}/graphql.json"
    payload = json.dumps({"query": query, "variables": variables}).encode()
    try:
        token = _get_admin_access_token(config)
        request = Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": token,
            },
            method="POST",
        )
        with urlopen(request, timeout=15) as response:
            result = json.loads(response.read())
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        LOG.exception("Shopify Admin API request failed")
        raise ShopifyAPIError("The shipping offer service is temporarily unavailable.") from error

    if result.get("errors"):
        LOG.error("Shopify Admin API returned GraphQL errors: %s", result["errors"])
        raise ShopifyAPIError("The shipping offer service is temporarily unavailable.")
    return result.get("data", {})


def _get_admin_access_token(config):
    cache_key = (config.shop_domain, config.client_id)
    with TOKEN_LOCK:
        cached = ADMIN_TOKENS.get(cache_key)
        if cached and cached[1] > time.time() + 60:
            return cached[0]

        payload = urlencode({
            "grant_type": "client_credentials",
            "client_id": config.client_id,
            "client_secret": config.app_secret,
        }).encode()
        request = Request(
            f"https://{config.shop_domain}/admin/oauth/access_token",
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=15) as response:
                token_result = json.loads(response.read())
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            LOG.exception("Shopify access token request failed")
            raise ShopifyAPIError("The shipping offer service is temporarily unavailable.") from error

        access_token = token_result.get("access_token")
        expires_in = token_result.get("expires_in")
        if not access_token or not isinstance(expires_in, int):
            LOG.error("Shopify access token response was incomplete")
            raise ShopifyAPIError("The shipping offer service is temporarily unavailable.")
        ADMIN_TOKENS[cache_key] = (access_token, time.time() + expires_in)
        return access_token


def create_shipping_discount(config, expires_at):
    if config.shipping_cap is not None:
        currency_data = _shopify_graphql(config, SHOP_CURRENCY_QUERY, {})
        currency = currency_data.get("shop", {}).get("currencyCode")
        if currency != "USD":
            LOG.error("Shipping offer requires a USD shop currency; Shopify returned %s", currency)
            raise ShopifyAPIError("The shipping offer is configured for a USD store.")

    now = datetime.now(timezone.utc)
    ends_at = datetime.fromtimestamp(expires_at, timezone.utc)
    code = f"RIDE{secrets.token_hex(6).upper()}"
    variables = {
        "input": {
            "title": "10-minute cart shipping offer",
            "code": code,
            "startsAt": now.isoformat(timespec="seconds"),
            "endsAt": ends_at.isoformat(timespec="seconds"),
            "usageLimit": 1,
            "appliesOncePerCustomer": True,
            "context": {"all": "ALL"},
            "destination": {"countries": {"add": ["US", "CA"]}},
            "combinesWith": {
                "productDiscounts": True,
                "orderDiscounts": False,
            },
        }
    }
    if config.shipping_cap is not None:
        variables["input"]["maximumShippingPrice"] = config.shipping_cap
    data = _shopify_graphql(config, GRAPHQL_MUTATION, variables)
    payload = data.get("discountCodeFreeShippingCreate")
    if not payload:
        LOG.error("Shopify Admin API returned an empty discount creation payload")
        raise ShopifyAPIError("The shipping offer service is temporarily unavailable.")
    if payload.get("userErrors"):
        LOG.error("Shopify rejected shipping discount creation: %s", payload["userErrors"])
        raise ShopifyAPIError("The shipping offer service is temporarily unavailable.")
    node = payload.get("codeDiscountNode")
    if not node or not node.get("id"):
        LOG.error("Shopify did not return the created shipping discount ID")
        raise ShopifyAPIError("The shipping offer service is temporarily unavailable.")
    return code, node["id"]


def get_or_create_offer(config, cart_token, client_ip, now=None, discount_creator=None):
    current_time = int(time.time() if now is None else now)
    cart_hash = _hmac_hash(cart_token, config.app_secret)
    ip_hash = _hmac_hash(client_ip, config.app_secret)
    expiry = current_time + OFFER_SECONDS
    creator = discount_creator or (lambda ends_at: create_shipping_discount(config, ends_at))

    with _database(config) as db:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute(
            "SELECT discount_code, expires_at FROM offers WHERE cart_hash = ?",
            (cart_hash,),
        ).fetchone()
        if existing:
            if existing["expires_at"] <= current_time:
                return {"expired": True, "expiresAt": existing["expires_at"]}
            return {"code": existing["discount_code"], "expiresAt": existing["expires_at"]}

        recent = db.execute(
            "SELECT COUNT(*) AS count FROM offers WHERE ip_hash = ? AND created_at > ?",
            (ip_hash, current_time - 3600),
        ).fetchone()["count"]
        if recent >= IP_HOURLY_LIMIT:
            raise PermissionError("Too many shipping offers were requested. Please try again later.")
        today = db.execute(
            "SELECT COUNT(*) AS count FROM offers WHERE created_at >= ?",
            (_eastern_day_start(current_time),),
        ).fetchone()["count"]
        if today >= config.daily_code_limit:
            raise PermissionError("Today's free-shipping offers have all been claimed.")

        code, discount_id = creator(expiry)
        db.execute(
            """
            INSERT INTO offers (cart_hash, discount_code, discount_id, created_at, expires_at, ip_hash)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (cart_hash, code, discount_id, current_time, expiry, ip_hash),
        )
    return {"code": code, "expiresAt": expiry}


def clean_expired_discounts(config, now=None):
    current_time = int(time.time() if now is None else now)
    with _database(config) as db:
        expired = db.execute(
            """
            SELECT cart_hash, discount_id FROM offers
            WHERE expires_at < ? AND discount_deleted = 0
            ORDER BY expires_at LIMIT 25
            """,
            (current_time - 60,),
        ).fetchall()

    for offer in expired:
        data = _shopify_graphql(
            config,
            DELETE_DISCOUNT_MUTATION,
            {"id": offer["discount_id"]},
        )
        result = data.get("discountCodeDelete")
        if not result or result.get("userErrors"):
            LOG.error("Shopify could not delete expired shipping discount %s: %s", offer["discount_id"], result)
            continue
        with _database(config) as db:
            db.execute(
                "UPDATE offers SET discount_deleted = 1 WHERE cart_hash = ?",
                (offer["cart_hash"],),
            )

    with _database(config) as db:
        db.execute(
            "DELETE FROM offers WHERE discount_deleted = 1 AND expires_at < ?",
            (current_time - 30 * 24 * 60 * 60,),
        )


def _cleanup_worker(config):
    while True:
        time.sleep(3600)
        try:
            clean_expired_discounts(config)
        except (ShopifyAPIError, sqlite3.Error):
            LOG.exception("Expired shipping discount cleanup failed; it will retry in an hour")


class Handler(BaseHTTPRequestHandler):
    config = None

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/health":
            self._send_json(200, {"ok": True})
            return
        if parsed.path != "/proxy/offer":
            self._send_json(404, {"error": "Not found"})
            return

        params = verify_proxy_signature(
            parsed.query,
            self.config.app_secret,
            self.config.shop_domain,
        )
        if params is None:
            self._send_json(401, {"error": "Invalid storefront request"})
            return

        cart_tokens = params.get("cart_token", [])
        if len(cart_tokens) != 1 or not cart_tokens[0] or len(cart_tokens[0]) > 512:
            self._send_json(400, {"error": "A valid cart is required"})
            return

        forwarded_for = self.headers.get("X-Forwarded-For", "")
        client_ip = forwarded_for.split(",")[0].strip() or "unknown"
        try:
            result = get_or_create_offer(self.config, cart_tokens[0], client_ip)
        except PermissionError as error:
            self._send_json(429, {"error": str(error)})
            return
        except ShopifyAPIError:
            self._send_json(503, {"error": "We couldn't start the free-shipping offer. You can still check out normally."})
            return
        except sqlite3.Error:
            LOG.exception("Offer database operation failed")
            self._send_json(503, {"error": "We couldn't start the free-shipping offer. You can still check out normally."})
            return

        if result.get("expired"):
            self._send_json(410, {"error": "This cart's free-shipping offer has expired."})
            return
        self._send_json(200, result)

    def do_POST(self):
        self._send_json(405, {"error": "Method not allowed"})

    def log_message(self, format_string, *args):
        LOG.info("%s - HTTP request", self.address_string())


def main():
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    config = Config.from_env()
    Handler.config = config
    with _database(config):
        pass
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    threading.Thread(target=_cleanup_worker, args=(config,), daemon=True).start()
    LOG.info("Shipping offer service listening on port %s", port)
    server.serve_forever()


if __name__ == "__main__":
    main()
