#!/usr/bin/env node
// Converts images/ja_icon.svg → icon-16.png, icon-48.png, icon-128.png in images/
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'images', 'ja_icon.svg');
const svg = fs.readFileSync(svgPath, 'utf8');

const sizes = [16, 48, 128];

for (const size of sizes) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: true },
    imageRendering: 1, // crisp edges where needed
  });

  const rendered = resvg.render();
  const png = rendered.asPng();
  const out = path.join(root, 'images', `icon-${size}.png`);
  fs.writeFileSync(out, png);
  console.log(`✓ icon-${size}.png  (${png.length} bytes)`);
}
