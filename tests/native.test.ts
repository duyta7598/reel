import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
const require=createRequire(import.meta.url),native=require('../build/Release/reel_engine.node')
function assertFile(file:string,expected:Buffer){assert.equal(fs.statSync(file).size,expected.length);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),crypto.createHash('sha256').update(expected).digest('hex'))}
test('native libtorrent transfers a movie between localhost peers and restores state',{timeout:30_000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reel-native-'))
  let seed:any,download:any,restored:any
  try{
    const seedDir=path.join(root,'seed'),downloadDir=path.join(root,'download');fs.mkdirSync(seedDir);fs.mkdirSync(downloadDir)
    const original=crypto.randomBytes(1_000_000),file=path.join(seedDir,'Fixture.mkv'),torrent=path.join(root,'Fixture.torrent');fs.writeFileSync(file,original)
    assert.equal(native.makeTestTorrent(file,torrent),true)
    seed=native.create(path.join(root,'seed-resume'),true);download=native.create(path.join(root,'download-resume'),true)
    native.add(seed,'seed',torrent,seedDir,false);native.add(download,'download',torrent,downloadDir,false)
    let finished=false
    for(let i=0;i<150;i++){const a=JSON.parse(native.snapshot(seed)),b=JSON.parse(native.snapshot(download));if(a[0]?.finished){native.connectPeer(download,'download',native.listenPort(seed));native.connectPeer(seed,'seed',native.listenPort(download))}if(b[0]?.finished){finished=true;break}await delay(100)}
    assert.equal(finished,true);assertFile(path.join(downloadDir,'Fixture.mkv'),original)
    native.pause(download,'download',true);native.save(download);await delay(300);native.snapshot(download);native.destroy(download);download=null
    restored=native.create(path.join(root,'download-resume'),true);native.add(restored,'download',torrent,downloadDir,true)
    assert.equal(JSON.parse(native.snapshot(restored))[0].paused,true)
  }finally{for(const engine of [restored,download,seed])if(engine)native.destroy(engine);fs.rmSync(root,{recursive:true,force:true})}
})

test('native TV selection transfers every episode in a season, supports one episode and survives resume',{timeout:30_000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reel-native-series-'))
  const engines:any[]=[]
  try{
    const seedDir=path.join(root,'seed'),show=path.join(seedDir,'Fixture'),downloadDir=path.join(root,'all'),singleDir=path.join(root,'single');fs.mkdirSync(show,{recursive:true});fs.mkdirSync(downloadDir);fs.mkdirSync(singleDir)
    const originals=new Map<string,Buffer>()
    for(const [name,size]of [['Fixture.S01E01.mkv',200000],['Fixture.S01E02.mkv',300000],['Fixture.S02E01.mkv',400000],['Fixture.S01E03.sample.mkv',500000]] as const){const data=crypto.randomBytes(size);originals.set(name,data);fs.writeFileSync(path.join(show,name),data)}
    const torrent=path.join(root,'Fixture.torrent');assert.equal(native.makeTestTorrent(show,torrent),true)
    const create=(name:string)=>{const value=native.create(path.join(root,name+'-resume'),true);engines.push(value);return value}
    const seed=create('seed'),all=create('all'),single=create('single'),missing=create('missing'),waiting=create('waiting')
    native.add(seed,'seed',torrent,seedDir,false,1,-1);native.add(all,'all',torrent,downloadDir,false,1,-1);native.add(single,'single',torrent,singleDir,false,1,2);native.add(missing,'missing',torrent,path.join(root,'missing'),false,9,-1)
    native.add(waiting,'waiting','magnet:?xt=urn:btih:1234567890123456789012345678901234567890',path.join(root,'waiting'),false,1,-1)
    const waitingState=JSON.parse(native.snapshot(waiting))[0];assert.equal(waitingState.metadata,false);assert.equal(waitingState.finished,false);assert.deepEqual(waitingState.videos,[])
    let done=false
    for(let n=0;n<150;n++){
      const a=JSON.parse(native.snapshot(all))[0],b=JSON.parse(native.snapshot(single))[0]
      native.snapshot(seed)
      for(const [engine,id]of [[all,'all'],[single,'single']] as const)native.connectPeer(engine,id,native.listenPort(seed))
      if(a?.finished&&b?.finished){done=true;break}await delay(100)
    }
    assert.equal(done,true)
    const allState=JSON.parse(native.snapshot(all))[0],oneState=JSON.parse(native.snapshot(single))[0],missingState=JSON.parse(native.snapshot(missing))[0]
    assert.deepEqual(allState.videos.map((item:any)=>item.episode),[1,2]);assert.equal(allState.videos.every((item:any)=>item.completed),true)
    assert.deepEqual(oneState.videos.map((item:any)=>item.episode),[2]);assert.equal(missingState.finished,false);assert.match(missingState.error,/No matching episodes/)
    for(const name of ['Fixture.S01E01.mkv','Fixture.S01E02.mkv'])assertFile(path.join(downloadDir,'Fixture',name),originals.get(name)!)
    assertFile(path.join(singleDir,'Fixture/Fixture.S01E02.mkv'),originals.get('Fixture.S01E02.mkv')!)
    native.pause(all,'all',true);native.save(all);await delay(300);native.snapshot(all);native.destroy(all);engines.splice(engines.indexOf(all),1)
    const restored=create('all');native.add(restored,'all',torrent,downloadDir,true,1,-1)
    const resumed=JSON.parse(native.snapshot(restored))[0];assert.equal(resumed.paused,true);assert.deepEqual(resumed.videos.map((item:any)=>item.episode),[1,2])
  }finally{for(const engine of engines)native.destroy(engine);fs.rmSync(root,{recursive:true,force:true})}
})
