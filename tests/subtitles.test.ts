import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { StateDatabase, defaults } from '../src/main/database'
import { Store } from '../src/main/store'
import type { Job } from '../src/shared/types'
const srt='1\n00:00:01,000 --> 00:00:03,000\nSubtitle fixture\n'
test('subtitle sync downloads only missing exact matches and preserves existing files',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reel-subtitle-sync-')),originalFetch=globalThis.fetch,db=new StateDatabase(root),settings=defaults()
  settings.autoSubtitles=false;settings.autoAlignSubtitles=false;settings.languages=['vi'];settings.subtitleSources=[{id:'subdl',name:'SubDL',kind:'subdl',endpoint:'https://api.subdl.com/api/v1',enabled:true}]
  const jobs:Job[]=['existing','missing','uncertain'].map((id,index)=>{const directory=path.join(root,id);fs.mkdirSync(directory);const videoPath=`Film.${2020+index}.1080p.BluRay.x264-GROUP.mkv`;fs.writeFileSync(path.join(directory,videoPath),'video');return{id,title:'Film',year:String(2020+index),directory,videoPath,uri:'',sourceURI:'',createdAt:Date.now(),paused:true,completed:true,subtitlePhase:'pending',subtitleLanguages:[],subtitleError:'',engineError:''}})
  const existing=path.join(jobs[0].directory,path.parse(jobs[0].videoPath).name+'.vi.srt');fs.writeFileSync(existing,srt)
  db.save({version:2,settings,jobs});let searches=0,downloads=0
  globalThis.fetch=async(input)=>{const url=new URL(String(input));if(url.hostname==='dl.subdl.com'){downloads++;return new Response(srt)}searches++;const year=url.searchParams.get('year');return new Response(JSON.stringify({status:true,subtitles:[{language:'Vietnamese',release_name:year==='2022'?'Film.2022.1080p.WEB-DL.x264-OTHER':`Film.${year}.1080p.BluRay.x264-GROUP`,url:'/subtitle/fixture.srt'}]}),{headers:{'Content-Type':'application/json'}})}
  const store=new Store(db,{has:()=>true,get:()=> 'fixture'} as any,{} as any,'')
  try{
    assert.equal(store.sync().syncing,true)
    for(let attempt=0;attempt<100&&store.syncing;attempt++)await delay(10)
    assert.equal(store.syncing,false);assert.equal(searches,2);assert.equal(downloads,1)
    assert.equal(fs.readFileSync(existing,'utf8'),srt)
    assert.equal(store.job('missing').subtitlePhase,'complete');assert.equal(store.job('uncertain').subtitlePhase,'needsSelection')
    assert.equal(fs.readFileSync(path.join(jobs[1].directory,path.parse(jobs[1].videoPath).name+'.vi.srt'),'utf8'),srt)
    assert.equal(fs.existsSync(path.join(jobs[2].directory,path.parse(jobs[2].videoPath).name+'.vi.srt')),false)
    assert.equal(store.busy.size,0)
  }finally{globalThis.fetch=originalFetch;db.close();fs.rmSync(root,{recursive:true,force:true})}
})
