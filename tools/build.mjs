#!/usr/bin/env node
// Builds the plugin (one plugin.js: the Hermes loader takes no .css and no chunks) or the dev page.
//   node tools/build.mjs          → desktop/plugin.js (the plugin's Desktop half, committed)
//   node tools/build.mjs --install → the same, then copied to ~/.hermes/desktop-plugins/hermesford/
//   node tools/build.mjs --dev    → dev/dev.js
// Lumina's UI CSS (vendor) is bundled with its Latin pixel fonts inlined and injected as a <style>.
import * as esbuild from 'esbuild'
import os from 'node:os'
import fs from 'node:fs'

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

// Water's shore-bake worker (shoreWorker.js) isn't shipped next to the single plugin.js: no worker,
// Water bakes the shore on the main thread (its own fallback for `_newShoreWorker() === null`).
const WORKER = "new Worker(new URL('./shoreWorker.js', import.meta.url), { type: 'module' })"
const noShoreWorker = {
  name: 'no-shore-worker',
  setup(b) {
    b.onLoad({ filter: /engine[\\/]world[\\/]Water\.js$/ }, async ({ path }) => {
      const src = await fs.promises.readFile(path, 'utf8')
      if (!src.includes(WORKER)) throw new Error(`no-shore-worker: the Worker line moved in ${path}`)
      return { contents: src.replace(WORKER, 'null'), loader: 'js' }
    })
  },
}

await esbuild.build({
  entryPoints: [dev ? 'src/dev.js' : 'src/plugin.js'],
  bundle: true,
  format: 'esm',
  minify: !dev,
  sourcemap: dev,
  outfile: dev ? 'dev/dev.js' : 'desktop/plugin.js',
  external: dev ? [] : ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'],
  plugins: [inlineCss, noShoreWorker],
  logLevel: 'warning',
})
if (!dev && process.argv.includes('--install')) {
  const to = `${os.homedir()}/.hermes/desktop-plugins/hermesford`
  fs.mkdirSync(to, { recursive: true })
  fs.copyFileSync('desktop/plugin.js', `${to}/plugin.js`)
  console.log(`installed → ${to}/plugin.js`)
}
