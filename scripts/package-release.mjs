import { build } from 'electron-builder'
import { spawnSync } from 'node:child_process'
const target=process.argv[2]
if(!['mac','win'].includes(target))throw new Error('Choose mac or win.')
if(process.platform!==(target==='mac'?'darwin':'win32'))throw new Error('Build each release on its target operating system so the native engine matches.')
if(target==='mac'&&(!process.env.REEL_MAC_SIGN_IDENTITY||process.env.REEL_MAC_SIGN_IDENTITY.trim()==='-'))throw new Error('Set REEL_MAC_SIGN_IDENTITY to your Developer ID Application identity before building a macOS update.')
for(const args of [['scripts/check-resources.mjs'],['scripts/build.mjs']]){
  const result=spawnSync(process.execPath,args,{stdio:'inherit'})
  if(result.status!==0)process.exit(result.status??1)
}
await build({[target]:target==='mac'?['dmg','zip']:['nsis'],[target==='mac'?'arm64':'x64']:true,publish:'never',config:{...(target==='mac'?{mac:{identity:process.env.REEL_MAC_SIGN_IDENTITY,hardenedRuntime:true},forceCodeSigning:true}:{}),artifactName:'${productName}-${version}-${os}-${arch}.${ext}'}})
