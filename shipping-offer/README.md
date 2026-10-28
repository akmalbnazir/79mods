# Timed free-shipping offer

The service creates one unique Shopify free-shipping code per cart. Codes expire
10 minutes after the cart first requests an offer, can be redeemed once, apply
to US and Canadian destinations, and cover eligible shipping rates priced at
US$15 or less. The app enables combination with product discounts and issues
at most 100 unique codes per calendar day in Eastern Time.

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
4. Configure the Halloween Buy X Get Y discounts in Shopify Admin to combine
   with shipping discounts too. Combinations must be permitted by both
   discounts; this service only enables product discounts on the shipping code.
5. Confirm that the store's base currency is USD. The service refuses to create
   an offer if it detects another base currency, so the 15.00 cap always means
   US$15.
6. Deploy this service with the persistent disk configured in `render.yaml`,
   then test a US and Canadian checkout, an expired offer, and the Halloween
   discount combination before advertising it.

The existing Halloween Buy X Get Y discounts must also allow shipping discounts
in Shopify Admin for both promotions to stack. Shopify's native free-shipping
discount targets eligible rates by price, not by a shipping-service name. Any
eligible rate costing US$15 or less could qualify, including expedited service
if it is priced within the cap.

The Render `starter` service and persistent disk can incur monthly charges.
Review Render's current pricing and approve the service before deployment.

The Blueprint uses `shipping-offer` as the Docker build context so the
Dockerfile's `COPY app.py .` instruction resolves to this service's source file.
If configuring the service manually, set Dockerfile Path to
`./shipping-offer/Dockerfile` and Docker Build Context Directory to
`./shipping-offer`.

## Local checks

Run the unit tests from the repository root with:

```sh
python3 -m unittest discover -s shipping-offer/tests -v
```

For local manual service tests, set the same required environment variables
using test credentials and point `DATABASE_PATH` to a temporary file. Do not
use a production Admin API token on an untrusted machine.
