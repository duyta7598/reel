import { _electron as electron } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { StateDatabase, defaults } from '../src/main/database.ts'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'reel-electron-smoke-'))
const movie=path.join(root,'Preview.mp4')
execFileSync(path.resolve('../Vendor/SubtitleTools',process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),['-nostdin','-y','-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=5','-f','lavfi','-i','sine=frequency=440:duration=5','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',movie])
fs.writeFileSync(path.join(root,'Preview.vi.srt'),'1\n00:00:00,000 --> 00:00:05,000\nPhụ đề kiểm tra\n')
const db=new StateDatabase(root),settings=defaults();settings.autoSubtitles=false
db.save({version:2,settings,jobs:[{id:'fixture',title:'Preview fixture',year:'2026',uri:'',sourceURI:'',directory:root,createdAt:Date.now(),paused:true,completed:true,videoPath:movie,subtitlePhase:'complete',subtitleLanguages:['vi'],subtitleError:'',engineError:''}]});db.close()
const env={...process.env,REEL_HEADLESS:'1',REEL_DATA_DIR:root}
delete env.ELECTRON_RUN_AS_NODE
const application=await electron.launch({...(process.env.REEL_APP_PATH?{executablePath:process.platform==='win32'?process.env.REEL_APP_PATH:path.join(process.env.REEL_APP_PATH,'Contents/MacOS/Reel Electron'),args:[]}:{args:[path.resolve('.')]}),env,timeout:30_000})
try{
  const page=await application.firstWindow(),errors=[]
  page.setDefaultTimeout(15_000)
  page.on('pageerror',error=>errors.push(error.message))
  await page.getByRole('button',{name:/^Downloads/}).click()
  await page.getByText('No active downloads',{exact:true}).waitFor()
  const isolation=await page.evaluate(()=>({require:typeof window.require,api:typeof window.reel.invoke}))
  assert.deepEqual(isolation,{require:'undefined',api:'function'})
  await page.waitForFunction(async()=>Boolean((await window.reel.invoke('state')).engineReady))
  await page.getByRole('button',{name:'Settings',exact:true}).click()
  await page.getByText('Appearance',{exact:true}).waitFor()
  await page.evaluate(()=>window.reel.invoke('saveSettings',{appearance:'light',interfaceLanguage:'vi'}))
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light')
  await page.getByRole('button',{name:'Close',exact:true}).click()
  await page.getByRole('button',{name:/^Thư viện/}).click()
  await page.getByText('Preview fixture',{exact:true}).waitFor()
  await page.screenshot({path:path.join(root,'light.png')})
  await page.evaluate(()=>window.reel.invoke('saveSettings',{appearance:'dark',interfaceLanguage:'en'}))
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark')
  await page.getByRole('button',{name:'Play Preview fixture',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2)
  await page.getByRole('button',{name:'Play',exact:true}).click()
  await page.getByText('Phụ đề kiểm tra',{exact:true}).waitFor()
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0.2)
  const preview=await page.evaluate(()=>window.reel.invoke('preview',{id:'fixture',start:1,transcode:false}))
  const ranged=await fetch(preview.url,{headers:{Range:'bytes=0-31'}});assert.equal(ranged.status,206);assert.equal((await ranged.arrayBuffer()).byteLength,32)
  const blocked=new URL(preview.url);blocked.searchParams.delete('token');assert.equal((await fetch(blocked)).status,403)
  const compatible=await page.evaluate(()=>window.reel.invoke('preview',{id:'fixture',start:1,transcode:true}))
  const stream=await fetch(compatible.url),reader=stream.body.getReader();assert.equal(stream.status,200);assert.ok((await reader.read()).value.length>0);await reader.cancel()
  await page.getByRole('button',{name:'Back to library',exact:true}).click()
  await page.getByRole('button',{name:'Add torrent',exact:true}).click()
  await page.getByRole('button',{name:'Start download',exact:true}).waitFor()
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(window=>window.isVisible())),false)
  assert.deepEqual(errors,[])
  process.stdout.write(JSON.stringify({passed:true,checks:['native worker','isolated preload IPC','downloads','settings','light/dark','Vietnamese','library','torrent dialog','hidden window','video playback','subtitle overlay','byte-range seek','local server authorization','compatible preview'],screenshot:path.join(root,'light.png')})+'\n')
}catch(error){const page=await application.firstWindow();process.stdout.write(JSON.stringify({error:String(error),body:await page.locator('body').innerText()})+'\n');throw error}finally{await application.evaluate(({app})=>app.quit());await application.close()}
