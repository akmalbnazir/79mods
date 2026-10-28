# Timed free-shipping offer

The service creates one unique Shopify free-shipping code per cart. Codes expire
10 minutes after the cart first requests an offer, can be redeemed once, and
make standard shipping free for US or Canadian destinations. The storefront
sends the shopper's detected country (`US` or `CA`), and each code is limited to
that country and its rate cap:

| Country | Standard rate | Cheapest express rate | Cap variable | Default |
| --- | --- | --- | --- | --- |
| US | Ground US$8.30 | Express US$24.00 | `SHIPPING_DISCOUNT_CAP_US` | `10.00` |
| CA | Standard International US$30.00 | Express International US$45.00 | `SHIPPING_DISCOUNT_CAP_CA` | `35.00` |

Each cap must stay at or above that country's standard rate and below its
cheapest express rate. Update the caps whenever shipping rates change. The app
enables combination with product discounts and issues at most 100 unique codes
per calendar day in Eastern Time.

The cart retains the same timer when the page is refreshed or the cart drawer is
reopened. The backend stores only a keyed hash of the Shopify cart token and
client IP, plus the generated discount code and Shopify discount ID.

## Required Shopify setup

1. Create a Shopify app in the Shopify Dev Dashboard and configure an app proxy:
   - Prefix: `apps`
   - Subpath: `shipping-offer`
   - Proxy URL: `https://<your-render-service>.onrender.com/proxy`
2. Create and release an app version with the `write_discounts,write_app_proxy`
   access scopes, then install it on `pnfpfp-66.myshopify.com`. The client-credentials
   token flow requires the app and store to belong to the same Shopify
   organization.
3. Add the app's Client ID and Client secret to the Render service's secret
   environment variables. The service uses them to verify app-proxy requests
   and obtain short-lived Admin API access tokens. Never put either value in
   this repository or storefront JavaScript.
4. Configure every Halloween discount in Shopify Admin, including the
   automatic `HALLOWEEN` discount and the Buy X Get Y discounts, to combine
   with shipping discounts. Combinations must be permitted by both
   discounts; this service only enables product discounts on the shipping code.
   Otherwise checkout reports that the code "couldn't be used with your
   existing discounts."
5. Confirm that the store's base currency is USD. The service refuses to create
   an offer if it detects another base currency, so the caps are always in USD.
6. Deploy this service with the persistent disk configured in `render.yaml`,
   then test a US and Canadian checkout, an expired offer, and the Halloween
   discount combination before advertising it.

The Halloween discounts must also allow shipping discounts
in Shopify Admin for both promotions to stack. Shopify's native free-shipping
discount targets rates by price, not by a shipping-service name, which is why
each country uses a cap between its standard and express rates. A cart keeps
the country used for its first offer; if detection is wrong, the code does not
apply at checkout and standard rates are charged instead.

The Render `starter` service and persistent disk can incur monthly charges.
Review Render's current pricing and approve the service before deployment.

The Blueprint uses `shipping-offer` as the Docker build context so the
Dockerfile's `COPY app.py .` instruction resolves to this service's source file.
If configuring the service manually, set Dockerfile Path to
`./shipping-offer/Dockerfile` and Docker Build Context Directory to
`./shipping-offer`.

## Troubleshooting

The `/health` endpoint checks service availability, not Shopify discount creation.
A request to the storefront's `/apps/shipping-offer/offer` without a cart token
should return `400` with `A valid cart is required`; this confirms proxy routing
and signature validation. If actual offer requests fail, inspect Render's
runtime logs for Shopify authentication or GraphQL errors before changing the
proxy settings.

## Local checks

Run the unit tests from the repository root with:

```sh
python3 -m unittest discover -s shipping-offer/tests -v
```

For local manual service tests, set the same required environment variables
using test credentials and point `DATABASE_PATH` to a temporary file. Do not
use a production Admin API token on an untrusted machine.
