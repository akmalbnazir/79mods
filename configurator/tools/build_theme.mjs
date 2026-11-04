import { build } from 'esbuild';
import { parse, parseFragment, serialize } from 'parse5';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
async function writeChanged(path, contents) {
  const bytes = Buffer.from(contents);
  const previous = await readFile(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (!previous?.equals(bytes)) await writeFile(path, bytes);
}
async function copyChanged(source, destination) {
  await writeChanged(destination, await readFile(source));
}
const data = JSON.parse(await readFile(resolve(root, 'configurator/data.json'), 'utf8'));
const bundle = await build({
  absWorkingDir: root,
  entryPoints: ['configurator/app.js'],
  outfile: 'assets/configurator-app.js',
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  alias: {
    'three/addons': resolve(root, 'configurator/vendor/addons'),
    three: resolve(root, 'configurator/vendor/three.module.js')
  }
});
for (const output of bundle.outputFiles) await writeChanged(output.path, output.contents);
await copyChanged(resolve(root, 'configurator/style.css'), resolve(root, 'assets/configurator-style.css'));
await copyChanged(resolve(root, 'configurator/data.json'), resolve(root, 'assets/configurator-data.json'));

const models = [...new Set(data.bikes.filter((bike) => bike.glb).map((bike) => bike.glb.split('?')[0]))];
for (const model of models) {
  await copyChanged(resolve(root, 'configurator', model), resolve(root, 'assets', `configurator-${basename(model)}`));
}

const document = parse(await readFile(resolve(root, 'configurator/index.html'), 'utf8'));
let entry;
function visit(node) {
  if (node.tagName === 'a') {
    const href = node.attrs.find((attribute) => attribute.name === 'href');
    if (href?.value === '/') {
      href.value = 'CONFIGURATOR_HOME_URL';
      if (!node.attrs.some((attribute) => attribute.name === 'target')) node.attrs.push({ name: 'target', value: '_top' });
    }
    if (href?.value === '/cart') href.value = 'CONFIGURATOR_CART_URL';
    if (href?.value === '/collections/all') href.value = 'CONFIGURATOR_COLLECTION_URL';
  }
  if (node.tagName === 'link' && node.attrs.some((attribute) => attribute.name === 'href' && attribute.value.startsWith('style.css'))) {
    node.attrs.find((attribute) => attribute.name === 'href').value = 'CONFIGURATOR_STYLE_URL';
  }
  if (node.tagName === 'script' && node.attrs.some((attribute) => attribute.name === 'type' && attribute.value === 'importmap')) {
    node.parentNode.childNodes = node.parentNode.childNodes.filter((child) => child !== node);
  }
  if (node.tagName === 'script' && node.attrs.some((attribute) => attribute.name === 'src' && attribute.value.startsWith('app.js'))) {
    node.attrs.find((attribute) => attribute.name === 'src').value = 'CONFIGURATOR_APP_URL';
    entry = node;
  }
  for (const child of [...(node.childNodes || [])]) visit(child);
}
visit(document);
if (!entry) throw new Error('Configurator entry script not found');
const configuration = parseFragment('<script>CONFIGURATOR_SETTINGS</script>').childNodes[0];
configuration.parentNode = entry.parentNode;
entry.parentNode.childNodes.splice(entry.parentNode.childNodes.indexOf(entry), 0, configuration);
const settings = `window.configuratorSettings = {
  cartMode: 'shopify',
  currency: window.parent.Shopify?.currency?.active || {{ shop.currency | json }},
  storefrontRoot: {{ routes.root_url | json }},
  dataUrl: {{ 'configurator-data.json' | asset_url | json }},
  models: {
${models.map((model) => `    ${JSON.stringify(model)}: {{ 'configurator-${basename(model)}' | asset_url | json }}`).join(',\n')}
  }
};`;
const markup = serialize(document)
  .replace('CONFIGURATOR_HOME_URL', '{{ routes.root_url }}')
  .replace('CONFIGURATOR_CART_URL', '{{ routes.cart_url }}')
  .replace('CONFIGURATOR_COLLECTION_URL', '{{ routes.all_products_collection_url }}')
  .replace('CONFIGURATOR_STYLE_URL', "{{ 'configurator-style.css' | asset_url }}")
  .replace('CONFIGURATOR_APP_URL', "{{ 'configurator-app.js' | asset_url }}")
  .replace('CONFIGURATOR_SETTINGS', settings);
await writeChanged(resolve(root, 'snippets/configurator-app.liquid'), markup);
console.log(`Built configurator app, stylesheet, data, iframe markup, and ${models.length} model assets.`);