# Bike Configurator

## Theme Build

Run `npm ci` and `npm run build:configurator` from the repository root after changing the app, data, styling, or model GLBs. The build creates Shopify-ready assets and the generated iframe snippet. Keep these generated files with the theme release.

The configurator runs in a same-origin iframe to keep its full-screen styling separate from the storefront. Product options, stock, and prices come from Shopify's product JSON endpoints. Add build to cart rechecks the selected bike-compatible variants and submits one batch to Shopify's Ajax Cart API. Bike and wheelset option details are included on each cart line. A successful submission exposes a shopping-bag link; failures keep the build intact.

## Shopify Access

The `page.configurator` template can be assigned to a Shopify page with handle `configurator`. Until that page exists, the header uses the existing About Us page with `?view=configurator`, which renders the same template. Preview this on a development theme before publishing. Creating static files does not create Shopify page records.

Black Friday messaging announces 15% off automatically at checkout; theme code does not create that discount. Before publishing, verify the automatic 15% discount in Shopify Admin and its combination rules with existing shipping offers. Update any reused discount's old campaign name in Admin. Homepage deal cards show advertised checkout prices; cart and build totals remain Shopify's authoritative prices until checkout.

Black Friday bundles reuse the original Lights + Brakes, Brakes + Frame Guards, and Frame Guards + Wheels product groups with 20% off the second eligible item. The `page.black-friday` template is accessible on the existing Halloween Sale page with `?view=black-friday`, or can be assigned to a dedicated Black Friday page. Enable or rename the matching Shopify Buy X get Y rules before publishing; the bundle offer is separate from the site-wide 15% promotion, and stacking is governed by Shopify's combination rules.

The campaign keeps the storefront's original blue/purple/pink palette, gradient buttons, floating rider visual, and pointer-responsive cards. `assets/black-friday.css` styles campaign components without replacing the base theme tokens or category/bike styling. Check narrow phones, tablets, desktop, landscape, touch input, and reduced-motion mode on the development theme when changing these styles.

### Storefront depth experiment

Theme settings > Storefront experiments > Enable glass and depth UI controls the optional `depth-ui.css` and `depth-ui.js` layer. It is enabled in the development configuration; the schema default is off. Disable it to return to the original restored theme without changing the catalog, campaign, or configurator.

Inspired by Apple's [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) and [Motion](https://developer.apple.com/design/human-interface-guidelines/motion) guidance, glass is reserved for navigation and overlays; prices and product content stay readable. Control magnification is limited to fine hover pointers and respects reduced motion. Glass surfaces respect reduced transparency, increased contrast, and forced colors, with opaque fallbacks in unsupported browsers. The rider image has no magnifier overlay.

## Model Limits

The garage uses a charcoal workshop backdrop, blue/purple accent strips, a branded wall panel, and a flush display pad. Neutral key/fill lighting preserves part finishes; only the key light casts shadows to limit GPU cost. All room details and textures are generated locally, with no external environment downloads.

Rim previews retain the stock tires and wheel dimensions; they are not exact 17-inch wheel-and-tire conversions. Lite and several print-kit assemblies remain visual approximations, not manufacturer CAD or physical fitment certification. Models without configured, previewable parts show Coming Soon. Catalog errors and sold-out variants disable purchase rather than submitting an unverified SKU.

The standalone `python3 server.py` preview does not provide Shopify cart or catalog endpoints. Test purchasing through `shopify theme dev` with mocked cart responses until approving a real cart test. Do not publish or push the theme as part of a local preview.