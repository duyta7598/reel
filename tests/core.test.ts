import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { confidence, parseSRT, recommended, releaseKey, safeName } from '../src/shared/matching'
import { defaults, StateDatabase } from '../src/main/database'
import { parsePirateBay, parseTorznab, parseSubDL, parseSubSource, subSourceMovie, subtitleArchive, validateSubtitle } from '../src/main/providers'
import { byteRange } from '../src/main/media'
import { settings } from '../src/main/validation'
const torrent=defaults().torrentSources[1],source=defaults().subtitleSources[0]
test('release scoring accepts similar BluRay and rejects conflicting source/year/edition',()=>{
  const file='Black.Widow.2021.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG265.mkv'
  assert.equal(confidence('Black Widow (2021) (1080p BluRay x265 10bit Tigole)',file),0.89)
  assert.equal(confidence(file.replace('.mkv',''),file),0.95)
  assert.ok(confidence('Black.Widow.2021.WEB-DL.1080p.x265',file)<0.85)
  assert.ok(confidence('Black.Widow.2021.Extended.1080p.BluRay.x265',file)<0.85)
  assert.equal(confidence('Black.Widow.1987.1080p.BluRay',file),0)
})
test('subtitle recommendations are per-language and stable by source priority',()=>{
  const a={id:'a',fileID:1,sourceID:'source',source:'Source',language:'vi' as const,release:'Film',fileName:'Film.srt',hashMatch:false,confidence:0.89}
  assert.deepEqual([...recommended([a,{...a,id:'b'},{...a,id:'c',language:'en',confidence:0.2}])],['a'])
})
test('magnet identity merges duplicate torrents and encodes display names',()=>{
  const hash='a'.repeat(40),releases=parsePirateBay([{name:'Film & Title',info_hash:hash,size:'1200',seeders:'5'},{name:'No results',info_hash:'0'.repeat(40)}],torrent)
  assert.equal(releases.length,1);assert.equal(new URL(releases[0].uri).searchParams.get('dn'),'Film & Title');assert.equal(releases[0].seeds,5)
  assert.equal(releaseKey(releases[0].uri),releaseKey(`magnet:?xt=urn:btih:${hash}&dn=other`))
})
test('Torznab namespaces, enclosure and XML entities are parsed safely',()=>{
  const data='<?xml version="1.0"?><rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><item><title>Film &amp; Title</title><guid isPermaLink="false">first</guid><enclosure url="magnet:?xt=urn:btih:abcdef&amp;dn=Film" length="123"/><torznab:attr name="seeders" value="8"/></item></channel></rss>'
  const releases=parseTorznab(data,{...torrent,kind:'torznab'})
  assert.equal(releases[0].title,'Film & Title');assert.equal(releases[0].id,torrent.id+'first');assert.equal(releases[0].seeds,8);assert.ok(releases[0].uri.includes('&dn='))
  assert.throws(()=>parseTorznab('<!DOCTYPE rss><rss/>',torrent))
})
test('SubDL filters external links and unsupported languages',()=>{
  const matches=parseSubDL({status:true,subtitles:[{language:'Vietnamese',release_name:'Film.2024.1080p.BluRay',url:'/subtitle/1.zip'},{language:'VI',url:'https://evil.example/subtitle/2.zip'},{language:'FR',url:'/subtitle/3.zip'}]},source,'Film.2024.1080p.BluRay.mkv',['vi'])
  assert.equal(matches.length,1);assert.equal(matches[0].confidence,0.95);assert.equal(new URL(matches[0].downloadURL!).hostname,'dl.subdl.com')
})
test('SubSource requires an unambiguous matching title and year',()=>{
  const data={success:true,data:[{movieId:1,title:'Film',releaseYear:2024},{movieId:2,title:'Film',releaseYear:2000}]}
  assert.equal(subSourceMovie(data,'Film','2024'),1);assert.equal(subSourceMovie(data,'Film',''),null)
  const result=parseSubSource({success:true,data:[{subtitleId:20,language:'Vietnamese',releaseInfo:['Different','Film.2024.1080p.BluRay']}]},{...source,kind:'subsource'},'Film.2024.1080p.BluRay.mkv',['vi'])
  assert.equal(result[0].confidence,0.95)
})
test('SRT validation preserves text and rejects non-subtitle responses',async()=>{
  const data=Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello\n')
  assert.equal(validateSubtitle(data).toString(),data.toString());assert.equal((await subtitleArchive(data)).toString(),data.toString());assert.equal(parseSRT(data.toString())[0].start,1)
  assert.throws(()=>validateSubtitle(Buffer.from('<html>Error</html>')))
})
test('Electron storage starts independently and preserves its own settings',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reel-independent-'))
  try{
    const old=new DatabaseSync(path.join(root,'reel.sqlite'));old.exec('CREATE TABLE state(id INTEGER PRIMARY KEY,data BLOB)');old.prepare('INSERT INTO state VALUES(1,?)').run(Buffer.from(JSON.stringify({settings:{...defaults(),downloadDirectory:'/swift-movies'},jobs:[{id:'swift-job'}]})));old.close()
    const db=new StateDatabase(root)
    assert.equal(db.load(),undefined)
    const state={version:2,settings:defaults(),jobs:[]}
    db.save(state);db.close()
    const reopened=new StateDatabase(root)
    assert.deepEqual(reopened.load(),state);reopened.close()
    const original=new DatabaseSync(path.join(root,'reel.sqlite'),{readOnly:true})
    assert.equal(original.prepare('SELECT COUNT(*) AS count FROM state').get()?.count,1);original.close()
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('media byte ranges support direct seek and reject invalid ranges',()=>{
  assert.deepEqual(byteRange('bytes=20-39',100),{start:20,end:39});assert.deepEqual(byteRange('bytes=-10',100),{start:90,end:99});assert.equal(byteRange('bytes=100-200',100),null);assert.equal(byteRange('bytes=40-20',100),null)
})
test('settings validation rejects unsupported input',()=>{assert.throws(()=>settings({languages:['fr']}));assert.throws(()=>settings({appearance:'invalid'}));assert.equal(safeName('../Movie: Title'),'..-Movie- Title')})
