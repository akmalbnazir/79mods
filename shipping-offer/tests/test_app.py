from concurrent.futures import ThreadPoolExecutor
import hashlib
import hmac
import tempfile
import unittest
from pathlib import Path
import sys
import time
from unittest.mock import patch
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import Config, ShopifyAPIError, create_shipping_discount, get_or_create_offer, verify_proxy_signature


class ProxySignatureTests(unittest.TestCase):
    def setUp(self):
        self.secret = "test-client-secret"
        self.shop = "example.myshopify.com"
        self.now = 1_800_000_000

    def signed_query(self, extra=None, timestamp=None):
        params = {
            "cart_token": ["cart-123"],
            "shop": [self.shop],
            "timestamp": [str(timestamp if timestamp is not None else self.now)],
            "path_prefix": ["/apps/shipping-offer"],
        }
        params.update(extra or {})
        message = "".join(f"{key}={','.join(values)}" for key, values in sorted(params.items()))
        params["signature"] = [
            hmac.new(self.secret.encode(), message.encode(), hashlib.sha256).hexdigest()
        ]
        return urlencode([(key, value) for key, values in params.items() for value in values])

    def test_accepts_valid_shopify_signature(self):
        query = self.signed_query()
        result = verify_proxy_signature(query, self.secret, self.shop, self.now)
        self.assertIsNotNone(result)
        self.assertEqual(result["cart_token"], ["cart-123"])

    def test_rejects_modified_query(self):
        query = self.signed_query().replace("cart-123", "cart-999")
        self.assertIsNone(verify_proxy_signature(query, self.secret, self.shop, self.now))

    def test_rejects_stale_signature(self):
        query = self.signed_query(timestamp=self.now - 301)
        self.assertIsNone(verify_proxy_signature(query, self.secret, self.shop, self.now))

    def test_rejects_duplicate_shop_or_timestamp(self):
        duplicate_shop = self.signed_query(extra={"shop": [self.shop, self.shop]})
        duplicate_timestamp = self.signed_query(extra={"timestamp": [str(self.now), str(self.now)]})
        self.assertIsNone(verify_proxy_signature(duplicate_shop, self.secret, self.shop, self.now))
        self.assertIsNone(verify_proxy_signature(duplicate_timestamp, self.secret, self.shop, self.now))


class OfferPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config = Config(
            shop_domain="example.myshopify.com",
            app_secret="test-client-secret",
            client_id="test-client-id",
            database_path=str(Path(self.temp_dir.name) / "offers.sqlite3"),
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_creates_discount_with_approved_rules(self):
        create_payload = {
            "discountCodeFreeShippingCreate": {
                "codeDiscountNode": {"id": "gid://shopify/DiscountCodeNode/1"},
                "userErrors": [],
            }
        }
        expires_at = 1_800_000_600
        with patch("app._shopify_graphql", return_value=create_payload) as graphql:
            code, discount_id = create_shipping_discount(self.config, expires_at)

        graphql.assert_called_once()
        discount_input = graphql.call_args.args[2]["input"]
        self.assertRegex(code, r"^RIDE[A-F0-9]{12}$")
        self.assertEqual(discount_id, "gid://shopify/DiscountCodeNode/1")
        self.assertEqual(discount_input["context"], {"all": "ALL"})
        self.assertEqual(discount_input["destination"], {"countries": {"add": ["US", "CA"]}})
        self.assertNotIn("maximumShippingPrice", discount_input)
        self.assertEqual(discount_input["usageLimit"], 1)
        self.assertTrue(discount_input["appliesOncePerCustomer"])
        self.assertEqual(discount_input["combinesWith"]["productDiscounts"], True)
        self.assertEqual(discount_input["combinesWith"]["orderDiscounts"], False)
        self.assertEqual(discount_input["endsAt"], "2027-01-15T08:10:00+00:00")

    def test_applies_optional_cap_in_usd(self):
        self.config.shipping_cap = "15.00"
        create_payload = {
            "discountCodeFreeShippingCreate": {
                "codeDiscountNode": {"id": "gid://shopify/DiscountCodeNode/1"},
                "userErrors": [],
            }
        }
        with patch("app._shopify_graphql", side_effect=[{"shop": {"currencyCode": "USD"}}, create_payload]) as graphql:
            create_shipping_discount(self.config, 1_800_000_600)
        self.assertEqual(graphql.call_args_list[1].args[2]["input"]["maximumShippingPrice"], "15.00")

    def test_refuses_shipping_cap_when_store_currency_is_not_usd(self):
        self.config.shipping_cap = "15.00"
        with patch("app._shopify_graphql", return_value={"shop": {"currencyCode": "CAD"}}) as graphql:
            with self.assertRaises(ShopifyAPIError):
                create_shipping_discount(self.config, 1_800_000_600)
        graphql.assert_called_once()

    def test_reuses_offer_for_cart_and_expires_it(self):
        created = []

        def create_discount(expires_at):
            created.append(expires_at)
            return "RIDE123", "gid://shopify/DiscountCodeNode/1"

        first = get_or_create_offer(
            self.config, "cart-123", "127.0.0.1", now=1000, discount_creator=create_discount
        )
        repeated = get_or_create_offer(
            self.config, "cart-123", "127.0.0.1", now=1100, discount_creator=create_discount
        )
        expired = get_or_create_offer(
            self.config, "cart-123", "127.0.0.1", now=1600, discount_creator=create_discount
        )

        self.assertEqual(first, {"code": "RIDE123", "expiresAt": 1600})
        self.assertEqual(repeated, first)
        self.assertEqual(expired, {"expired": True, "expiresAt": 1600})
        self.assertEqual(len(created), 1)

    def test_limits_new_offers_per_ip(self):
        created = []

        def create_discount(expires_at):
            created.append(expires_at)
            return f"RIDE{len(created)}", f"gid://shopify/DiscountCodeNode/{len(created)}"

        for index in range(20):
            get_or_create_offer(
                self.config,
                f"cart-{index}",
                "127.0.0.1",
                now=2000,
                discount_creator=create_discount,
            )

        with self.assertRaises(PermissionError):
            get_or_create_offer(
                self.config,
                "cart-over-limit",
                "127.0.0.1",
                now=2000,
                discount_creator=create_discount,
            )

    def test_limits_new_offers_per_eastern_calendar_day(self):
        created = []

        def create_discount(expires_at):
            created.append(expires_at)
            return f"RIDE{len(created)}", f"gid://shopify/DiscountCodeNode/{len(created)}"

        for index in range(100):
            get_or_create_offer(
                self.config,
                f"daily-cart-{index}",
                f"ip-{index}",
                now=1_800_000_000,
                discount_creator=create_discount,
            )

        with self.assertRaisesRegex(PermissionError, "Today's free-shipping offers"):
            get_or_create_offer(
                self.config,
                "daily-cart-over-limit",
                "ip-new",
                now=1_800_000_000,
                discount_creator=create_discount,
            )

    def test_concurrent_requests_for_cart_create_one_discount(self):
        created = []

        def create_discount(expires_at):
            time.sleep(0.02)
            created.append(expires_at)
            return "RIDEONCE", "gid://shopify/DiscountCodeNode/once"

        def request_offer(_):
            return get_or_create_offer(
                self.config,
                "cart-concurrent",
                "127.0.0.1",
                now=3000,
                discount_creator=create_discount,
            )

        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(request_offer, range(8)))

        self.assertEqual(len(created), 1)
        self.assertTrue(all(result == results[0] for result in results))


if __name__ == "__main__":
    unittest.main()
