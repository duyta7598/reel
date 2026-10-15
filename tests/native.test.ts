import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
const require=createRequire(import.meta.url),native=require('../build/Release/reel_engine.node')
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
    assert.equal(finished,true);assert.deepEqual(fs.readFileSync(path.join(downloadDir,'Fixture.mkv')),original)
    native.pause(download,'download',true);native.save(download);await delay(300);native.snapshot(download);native.destroy(download);download=null
    restored=native.create(path.join(root,'download-resume'),true);native.add(restored,'download',torrent,downloadDir,true)
    assert.equal(JSON.parse(native.snapshot(restored))[0].paused,true)
  }finally{for(const engine of [restored,download,seed])if(engine)native.destroy(engine);fs.rmSync(root,{recursive:true,force:true})}
})
