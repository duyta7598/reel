import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { run } from './process'
const candidates=process.platform==='darwin'?['/usr/local/bin/warp-cli','/opt/homebrew/bin/warp-cli','/Applications/Cloudflare WARP.app/Contents/Resources/warp-cli']:process.platform==='win32'?[path.join(process.env.ProgramFiles??'C:\\Program Files','Cloudflare','Cloudflare WARP','warp-cli.exe')]:['/usr/bin/warp-cli','/usr/local/bin/warp-cli']
const cli=()=>candidates.find(file=>fs.existsSync(file))
export function proxyReady(value:string,timeout=1000):Promise<boolean>{
  return new Promise(resolve=>{let url:URL;try{url=new URL(value)}catch{resolve(false);return}const socket=net.connect({host:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port)||(url.protocol==='https:'?443:80)});let settled=false;const done=(ready:boolean)=>{if(settled)return;settled=true;socket.destroy();resolve(ready)};socket.setTimeout(timeout,()=>done(false));socket.on('connect',()=>done(true));socket.on('error',()=>done(false))})
}
export async function warpStatus(){
  const executable=cli();if(!executable)return{warpInstalled:false,warpConnected:false,warpProxyMode:false}
  try{const settings=await run(executable,['--no-ansi','settings'],{timeout:5000,maxOutput:20000}),status=await run(executable,['--no-ansi','status'],{timeout:5000,maxOutput:4000});return{warpInstalled:true,warpConnected:/Status update:\s*Connected\b/i.test(status.stdout.toString()),warpProxyMode:/Mode:\s*WarpProxy\b/i.test(settings.stdout.toString()),warpProxyPort:Number(settings.stdout.toString().match(/WarpProxy on port (\d+)/i)?.[1])||undefined}}catch{return{warpInstalled:true,warpConnected:false,warpProxyMode:false}}
}
let pending:Promise<void>|undefined,pendingURL=''
export async function prepareWarp(value:string):Promise<void>{
  if(pending){await pending;if(pendingURL===value)return}
  pendingURL=value
  pending=(async()=>{
    const executable=cli();if(!executable)throw new Error('Install and open Cloudflare WARP once to enable automatic proxy.')
    const url=new URL(value),host=url.hostname.replace(/^\[|\]$/g,'')
    if(!['127.0.0.1','localhost','::1'].includes(host))throw new Error('Automatic WARP requires a localhost proxy.')
    const port=Number(url.port)||(url.protocol==='https:'?443:url.protocol==='http:'?80:40000)
    const status=await warpStatus();if(status.warpConnected&&status.warpProxyMode&&status.warpProxyPort===port&&await proxyReady(value))return
    for(const args of [['proxy','port',String(port)],['mode','proxy'],['connect']]){
      const result=await run(executable,args,{timeout:10000,maxOutput:4000})
      if(result.code!==0)throw new Error('Could not configure WARP local proxy. Open Cloudflare WARP and check its connection.')
    }
    const deadline=Date.now()+15000
    while(Date.now()<deadline){if(await proxyReady(value,500)){const next=await warpStatus();if(next.warpConnected&&next.warpProxyMode&&next.warpProxyPort===port)return}await new Promise(resolve=>setTimeout(resolve,250))}
    throw new Error('WARP local proxy is not ready. Open Cloudflare WARP and try again.')
  })()
  try{await pending}finally{pending=undefined}
}
