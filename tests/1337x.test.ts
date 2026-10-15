import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse1337x, search1337x, resolve1337x } from '../src/main/1337x'
import { searchTorrent, testSource } from '../src/main/providers'
import { defaults, StateDatabase } from '../src/main/database'
import { Store } from '../src/main/store'
import { source as validateSource, settings as validateSettings } from '../src/main/validation'
import type { TorrentSource } from '../src/shared/types'
const source:TorrentSource={id:'x1337',name:'1337x',kind:'x1337',endpoint:'https://1337x.to',enabled:true}
const hash='1234567890abcdef1234567890abcdef12345678',magnet=`magnet:?xt=urn:btih:${hash}&dn=Fixture`
const row=(id:number,title:string,category=42,href=`/torrent/${id}/Fixture/`)=>`<tr><td class="coll-1 name"><a href="/sub/${category}/"><i></i></a><a href="${href}">${title}</a></td><td class="coll-2 seeds">1,234</td><td class="coll-4 size">1.5 GB<span>1,234</span></td></tr>`
const table=(rows:string)=>`<table class="table-list"><tbody>${rows}</tbody></table>`
test('1337x parses title, size and seeds while filtering category, duplicate and external links',()=>{
  const results=parse1337x(table(row(1,'Fixture &amp; Film')+row(1,'Duplicate')+row(2,'Fixture.S01E02',41)+row(3,'External',42,'https://other.test/torrent/3/Fixture/')),source,false)
  assert.equal(results.length,1);assert.equal(results[0].title,'Fixture & Film');assert.equal(results[0].seeds,1234);assert.equal(results[0].size,1.5*1024**3);assert.equal(results[0].sourceID,source.id)
  assert.equal(parse1337x(table(row(2,'Fixture.S01E02',41)),source,true)[0].title,'Fixture.S01E02')
  assert.deepEqual(parse1337x('<p>No results were returned.</p>',source,false),[])
  assert.throws(()=>parse1337x('<html>Just a moment... cf-chl-test</html>',source,false),/blocked/)
  assert.throws(()=>parse1337x('<html>Unexpected page</html>',source,false),/Could not read/)
})
test('1337x supports movie and episode searches without fetching detail pages during search',async()=>{
  const original=globalThis.fetch,urls:URL[]=[]
  globalThis.fetch=async input=>{const url=new URL(String(input));urls.push(url);return new Response(table(row(1,'Fixture.S01E02',41)+row(2,'Fixture.2026',42)))}
  try{
    const base={id:'fixture',title:'Fixture',searchTitle:'Fixture',year:'2026',genre:'',overview:''}
    assert.equal((await searchTorrent(source,'',base)).length,1)
    assert.equal(decodeURIComponent(urls[0].pathname),'/search/Fixture 2026/1/')
    assert.equal((await searchTorrent(source,'',{...base,mediaType:'tv',season:1,episode:2})).length,1)
    assert.equal(decodeURIComponent(urls[1].pathname),'/search/Fixture S01E02/1/')
    assert.equal(urls.length,2)
    assert.equal(validateSource(source).kind,'x1337');assert.equal(validateSettings({torrentSources:[source]}).torrentSources?.[0].kind,'x1337')
  }finally{globalThis.fetch=original}
})
test('1337x resolves valid magnets, rejects external detail URLs and detects blocked responses',async()=>{
  const original=globalThis.fetch;let requests=0
  globalThis.fetch=async()=>{requests++;return new Response(`<ul><li><a href="javascript:alert(1)">Bad</a><a href="magnet:?xt=bad">Bad</a><a href="${magnet.replace('&','&amp;')}">Magnet Download</a></li></ul>`)}
  try{
    assert.equal(await resolve1337x('https://1337x.to/torrent/1/Fixture/',source),magnet)
    await assert.rejects(()=>resolve1337x('https://other.test/torrent/1/Fixture/',source),/Invalid/);assert.equal(requests,1)
    globalThis.fetch=async()=>new Response('<html>Cloudflare</html>',{status:403})
    await assert.rejects(()=>search1337x(source,'Fixture',false),/1337x blocked/)
    await assert.rejects(()=>testSource(source,''),/1337x blocked/)
    globalThis.fetch=async()=>new Response('<html>No magnet</html>')
    await assert.rejects(()=>resolve1337x('/torrent/1/Fixture/',source),/did not provide a magnet/)
  }finally{globalThis.fetch=original}
})
test('1337x is added to existing profiles once and a user deletion remains respected',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reel-source-migration-')),db=new StateDatabase(root),settings=defaults()
  settings.autoSubtitles=false;settings.torrentSources=settings.torrentSources.filter(item=>item.kind!=='x1337');settings.torrentSources[0].enabled=false;db.save({version:2,settings,jobs:[]})
  const vault={has:()=>false},engine={close:async()=>{}},store=new Store(db,vault as any,engine as any,'')
  try{
    assert.equal(store.state.version,3);assert.equal(store.settings.torrentSources.filter(item=>item.kind==='x1337').length,1);assert.equal(store.settings.torrentSources[0].enabled,false)
    store.deleteSource(store.settings.torrentSources.find(item=>item.kind==='x1337')!.id)
    await store.close()
    const reopened=new Store(new StateDatabase(root),vault as any,engine as any,'')
    try{assert.equal(reopened.settings.torrentSources.some(item=>item.kind==='x1337'),false)}finally{await reopened.close()}
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('1337x detail pages are resolved to magnets before starting a download and deduplicated by hash',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reel-1337x-download-')),db=new StateDatabase(root),settings=defaults(),original=globalThis.fetch,calls:any[][]=[]
  settings.autoSubtitles=false;settings.downloadDirectory=path.join(root,'downloads');settings.torrentSources=[source];db.save({version:3,settings,jobs:[]})
  const store=new Store(db,{has:()=>false} as any,{call:async(...args:any[])=>{calls.push(args)},close:async()=>{}} as any,'');store.engineReady=true
  globalThis.fetch=async()=>new Response(`<a href="${magnet.replace('&','&amp;')}">Magnet</a>`)
  try{
    const release=parse1337x(table(row(1,'Fixture.2026')),source,false)[0]
    await store.add(release)
    assert.equal(calls[0][2],magnet);assert.equal(store.jobs[0].uri,magnet);assert.equal(store.jobs[0].sourceURI,magnet)
    await assert.rejects(()=>store.add(release),/already in your library/);assert.equal(calls.length,1)
  }finally{globalThis.fetch=original;await store.close();fs.rmSync(root,{recursive:true,force:true})}
})
