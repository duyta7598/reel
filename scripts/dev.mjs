import { spawn } from 'node:child_process'
import { context } from 'esbuild'
import fs from 'node:fs/promises'
import path from 'node:path'
import electron from 'electron'
import './build.mjs'
const root=path.resolve(import.meta.dirname,'..')
const renderer=await context({entryPoints:[path.join(root,'src/renderer/main.tsx')],outdir:path.join(root,'out/renderer'),bundle:true,format:'esm',platform:'browser',sourcemap:true})
await renderer.watch()
await renderer.serve({servedir:path.join(root,'out/renderer'),host:'127.0.0.1',port:5173})
const env={...process.env,REEL_DEV_URL:'http://127.0.0.1:5173'};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(electron,[root],{env,stdio:'inherit'})
child.on('exit',async(code)=>{await renderer.dispose();process.exit(code??0)})
