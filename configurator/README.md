# Bike Configurator

## Theme Build

Run `npm ci` and `npm run build:configurator` from the repository root after changing the app, data, styling, or model GLBs. The build creates Shopify-ready assets and the generated iframe snippet. Keep these generated files with the theme release.

The configurator runs in a same-origin iframe to keep its full-screen styling separate from the storefront. Product options, stock, and prices come from Shopify's product JSON endpoints. Add build to cart rechecks the selected bike-compatible variants and submits one batch to Shopify's Ajax Cart API. Bike and wheelset option details are included on each cart line. A successful submission exposes a shopping-bag link; failures keep the build intact.

## Shopify Access

The `page.configurator` template can be assigned to a Shopify page with handle `configurator`. Until that page exists, the header uses the existing About Us page with `?view=configurator`, which renders the same template. Preview this on a development theme before publishing. Creating static files does not create Shopify page records.

Thanksgiving messaging announces 5% off automatically at checkout; theme code does not create that discount. Before publishing, verify the automatic 5% discount in Shopify Admin and its combination rules with existing shipping offers. Displayed product and build prices remain unchanged until checkout.

## Model Limits

Rim previews retain the stock tires and wheel dimensions; they are not exact 17-inch wheel-and-tire conversions. Lite and several print-kit assemblies remain visual approximations, not manufacturer CAD or physical fitment certification. Models without configured, previewable parts show Coming Soon. Catalog errors and sold-out variants disable purchase rather than submitting an unverified SKU.

The standalone `python3 server.py` preview does not provide Shopify cart or catalog endpoints. Test purchasing through `shopify theme dev` with mocked cart responses until approving a real cart test. Do not publish or push the theme as part of a local preview.