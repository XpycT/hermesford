#!/usr/bin/env node
// Builds the plugin (one plugin.js: the Hermes loader takes no .css and no chunks) or the dev page.
//   node tools/build.mjs          → ~/.hermes/desktop-plugins/village/plugin.js
//   node tools/build.mjs --dev    → dev/dev.js
// Lumina's UI CSS (vendor) is bundled with its Latin pixel fonts inlined and injected as a <style>.
import * as esbuild from 'esbuild'
import os from 'node:os'

const dev = process.argv.includes('--dev')

const inlineCss = {
  name: 'inline-css',
  setup(b) {
    // Japanese / Chinese faces: the village UI is English only
    b.onResolve({ filter: /^@fontsource\/(dotgothic16|noto-sans-(jp|sc))\// }, () => ({ path: 'cjk', namespace: 'empty' }))
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '' }))
    b.onLoad({ filter: /\.css$/ }, async ({ path }) => {
      const r = await esbuild.build({ entryPoints: [path], bundle: true, write: false, minify: !dev, loader: { '.woff2': 'dataurl', '.woff': 'dataurl' } })
      const css = JSON.stringify(r.outputFiles[0].text)
      return { contents: `const s=document.createElement('style');s.dataset.village='';s.textContent=${css};document.head.append(s)`, loader: 'js' }
    })
  },
}

await esbuild.build({
  entryPoints: [dev ? 'src/dev.js' : 'src/plugin.js'],
  bundle: true,
  format: 'esm',
  minify: !dev,
  sourcemap: dev,
  outfile: dev ? 'dev/dev.js' : `${os.homedir()}/.hermes/desktop-plugins/village/plugin.js`,
  external: dev ? [] : ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'],
  plugins: [inlineCss],
  logLevel: 'warning',
})
