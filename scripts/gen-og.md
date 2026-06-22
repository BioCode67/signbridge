# OG image generation

Regenerate `public/og.png` (1200×630) from `scripts/og.svg`:

```bash
npm i @resvg/resvg-js --no-save
node -e '
const { Resvg } = require("@resvg/resvg-js");
const fs = require("fs");
const r = new Resvg(fs.readFileSync("scripts/og.svg"), {
  font: { fontFiles: ["/System/Library/Fonts/Supplemental/AppleGothic.ttf"], loadSystemFonts: false, defaultFontFamily: "AppleGothic" },
  fitTo: { mode: "width", value: 1200 },
});
fs.writeFileSync("public/og.png", r.render().asPng());
'
```
