import fs from 'node:fs'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..'),tools=path.join(root,'../Vendor/SubtitleTools')
const executable=process.platform==='win32'?'.exe':''
for(const file of [path.join(root,'build/Release/reel_engine.node'),path.join(tools,'ffmpeg'+executable),path.join(tools,'reel-subtitle-align','reel-subtitle-align'+executable)])if(!fs.existsSync(file))throw new Error(`Missing packaged resource: ${file}`)
const signature=fs.readFileSync(path.join(root,'build/Release/reel_engine.node')).subarray(0,2).toString('ascii')
if(process.platform==='win32'&&signature!=='MZ')throw new Error('Rebuild the native engine on Windows before packaging.')
