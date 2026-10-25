import { build } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..')
await build({entryPoints:[path.join(root,'src/main/index.ts'),path.join(root,'src/main/engine-worker.ts')],outdir:path.join(root,'out/main'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron','electron-updater'],sourcemap:true})
await build({entryPoints:[path.join(root,'src/main/preload.ts')],outfile:path.join(root,'out/main/preload.js'),bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron']})
await build({entryPoints:[path.join(root,'src/renderer/main.tsx')],outdir:path.join(root,'out/renderer'),bundle:true,format:'esm',platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'}})
const html=(await fs.readFile(path.join(root,'src/renderer/index.html'),'utf8')).replace('/main.tsx','./main.js').replace('</head>','<link rel="stylesheet" href="./main.css"/></head>')
await fs.writeFile(path.join(root,'out/renderer/index.html'),html)
await fs.copyFile(path.join(root,'assets/icon.png'),path.join(root,'out/renderer/icon.png'))
