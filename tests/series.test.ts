import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { episodeIdentity, episodeCode, playableJobs, findJob } from '../src/shared/series'
import { confidence } from '../src/shared/matching'
import { movie as validateMovie } from '../src/main/validation'
import { tvSeasons, tvEpisodes } from '../src/main/catalog'
import { searchTorrent, searchSubtitle, subtitleArchive } from '../src/main/providers'
import { defaults, StateDatabase } from '../src/main/database'
import { Store, subtitleFile } from '../src/main/store'
import type { Movie, EngineSnapshot } from '../src/shared/types'
const movie:Movie={id:'tmdb-tv-1',title:'Fixture',searchTitle:'Fixture',year:'2026',genre:'TV',overview:'',mediaType:'tv',season:1,episode:2}
const response=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}})
test('TV selection validates season and episode and refuses subtitle matches for another episode',()=>{
  assert.equal(validateMovie(movie).episode,2)
  assert.equal(validateMovie({...movie,season:0}).season,0)
  for(const value of [{...movie,season:undefined},{...movie,season:-1},{...movie,episode:0},{...movie,episode:2.5}])assert.throws(()=>validateMovie(value))
  assert.deepEqual(episodeIdentity('Fixture.S01E02-E04.mkv'),{season:1,episodes:[2,3,4]})
  assert.deepEqual(episodeIdentity('Fixture.1x02.mkv'),{season:1,episodes:[2]})
  assert.deepEqual(episodeIdentity('Fixture.S01E02E03.mkv'),{season:1,episodes:[2,3]})
  assert.equal(episodeCode(0,2),'S00E02')
  assert.equal(confidence('Fixture.S01E03.1080p.WEB-DL','Fixture.S01E02.1080p.WEB-DL.mkv'),0)
  assert.equal(confidence('Fixture.S02E02.1080p.WEB-DL','Fixture.S01E02.1080p.WEB-DL.mkv'),0)
  assert.equal(confidence('Fixture.S01E02.1080p.WEB-DL','Fixture.S01E02.1080p.WEB-DL.mkv'),0.95)
  assert.ok(confidence('Fixture.S01E02.1080p.WEB-DL.x264-GROUP','Fixture.S01E02.720p.WEB-DL.x264-GROUP.mkv')>=0.85)
})
test('TMDB returns season and episode choices for the selected show',async()=>{
  const original=globalThis.fetch,urls:URL[]=[]
  globalThis.fetch=async input=>{const url=new URL(String(input));urls.push(url);return response(url.pathname.endsWith('/season/1')?{episodes:[{episode_number:2,name:'Second',air_date:'2026-01-02'},{episode_number:1,name:'Pilot'}]}:{seasons:[{season_number:1,name:'Season 1',episode_count:2},{season_number:0,name:'Specials',episode_count:1},{season_number:2,episode_count:0}]})}
  try{
    assert.deepEqual((await tvSeasons(movie.id,'fixture','en')).map(item=>item.number),[0,1])
    assert.deepEqual((await tvEpisodes(movie.id,1,'fixture','vi')).map(item=>item.number),[1,2])
    assert.equal(urls[1].pathname,'/3/tv/1/season/1');assert.equal(urls[1].searchParams.get('language'),'vi-VN')
    await assert.rejects(()=>tvSeasons('../bad','fixture','en'),/identifier/)
    await assert.rejects(()=>tvSeasons(movie.id,'','en'),/TMDB token/)
  }finally{globalThis.fetch=original}
})
test('TV torrents use TV categories and episode codes while movies keep their existing query',async()=>{
  const original=globalThis.fetch,urls:URL[]=[]
  globalThis.fetch=async input=>{const url=new URL(String(input));urls.push(url);return url.pathname.endsWith('q.php')?response([]):new Response('<rss><channel/></rss>')}
  try{
    const pirate={id:'p',name:'Pirate',kind:'pirateBay' as const,endpoint:'https://example.test',enabled:true},torznab={...pirate,kind:'torznab' as const}
    await searchTorrent(pirate,'',movie);assert.equal(urls[0].searchParams.get('q'),'Fixture S01E02');assert.equal(urls[0].searchParams.get('cat'),'205')
    await searchTorrent(torznab,'fixture',{...movie,episode:undefined});assert.equal(urls[1].searchParams.get('q'),'Fixture S01');assert.equal(urls[1].searchParams.get('cat'),'5000')
    await searchTorrent(pirate,'',{...movie,mediaType:'movie'});assert.equal(urls[2].searchParams.get('q'),'Fixture 2026');assert.equal(urls[2].searchParams.get('cat'),'200')
    assert.deepEqual(await searchTorrent({...pirate,kind:'archive'},'',movie),[])
  }finally{globalThis.fetch=original}
})
test('TV subtitle providers and season archives select the requested episode',async()=>{
  const original=globalThis.fetch,urls:URL[]=[]
  const source={id:'s',name:'SubDL',kind:'subdl' as const,endpoint:'https://example.test',enabled:true}
  globalThis.fetch=async input=>{const url=new URL(String(input));urls.push(url);return response({status:true,subtitles:[{release_name:'Fixture.S01',name:'pack.zip',language:'EN',unpack_files:[1,2].map(n=>({name:`Fixture.S01E0${n}.srt`,release_name:`Fixture.S01E0${n}`,language:'EN',format:'srt',season:1,episode:n,url:`/subtitle/pack/${n}`}))}]})}
  try{
    const matches=await searchSubtitle(source,'fixture','Fixture','2026','Fixture.S01E02.mkv',['en'],{season:1,episode:2})
    assert.equal(matches.length,1);assert.equal(matches[0].release,'Fixture.S01E02')
    assert.equal(urls[0].searchParams.get('type'),'tv');assert.equal(urls[0].searchParams.get('season_number'),'1');assert.equal(urls[0].searchParams.get('episode_number'),'2')
    globalThis.fetch=async input=>new URL(String(input)).pathname.endsWith('/movies/search')?response({data:[{movieId:7,title:'Fixture',releaseYear:2026}]}):response({data:[1,2].map(n=>({subtitleId:n,language:'English',releaseInfo:[`Fixture.S01E0${n}`]}))})
    const subsource=await searchSubtitle({...source,kind:'subsource'},'fixture','Fixture','2026','Fixture.S01E02.mkv',['en'],{season:1,episode:2})
    assert.equal(subsource.length,1);assert.equal(subsource[0].fileID,2)
    const archive=fs.readFileSync(path.join(import.meta.dirname,'fixtures/TVSubtitles.zip'))
    assert.match((await subtitleArchive(archive,'Fixture.S01E02.mkv')).toString(),/Episode 2/)
    await assert.rejects(()=>subtitleArchive(archive,'Fixture.S01E03.mkv'),/multiple subtitles/)
    await assert.rejects(()=>subtitleArchive(archive),/multiple subtitles/)
  }finally{globalThis.fetch=original}
})
test('one season torrent retains independent episode progress, subtitles and resume state',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reel-series-')),db=new StateDatabase(root),settings=defaults(),calls:any[][]=[]
  settings.downloadDirectory=path.join(root,'downloads');settings.autoSubtitles=false;db.save({version:2,settings,jobs:[]})
  let snapshots:EngineSnapshot[]=[]
  const engine={call:async(...args:any[])=>{calls.push(args);return args[0]==='snapshot'?snapshots:undefined},close:async()=>{}}
  const vault={has:()=>false,get:()=>''}
  const store=new Store(db,vault as any,engine as any,'');store.engineReady=true
  let closed=false
  try{
    await store.add({id:'release',title:'Fixture.S01.Complete',uri:'magnet:?xt=urn:btih:1234567890123456789012345678901234567890',source:'Fixture',size:200},{...movie,episode:undefined})
    const parent=store.jobs[0]
    assert.deepEqual(calls[0].slice(-2),[1,-1]);assert.equal(store.jobs.length,1)
    fs.mkdirSync(path.join(parent.directory,'Season 1'),{recursive:true})
    for(const n of [1,2])fs.writeFileSync(path.join(parent.directory,`Season 1/Fixture.S01E0${n}.mkv`),'fixture')
    snapshots=[{id:parent.id,name:'Fixture',progress:0.75,downloadRate:10,downloaded:150,uploaded:0,total:200,peers:1,paused:false,finished:false,metadata:true,state:3,error:'',videoPath:'Season 1/Fixture.S01E01.mkv',videos:[{index:0,path:'Season 1/Fixture.S01E01.mkv',size:100,downloaded:100,completed:true,season:1,episode:1},{index:1,path:'Season 1/Fixture.S01E02.mkv',size:100,downloaded:50,completed:false,season:1,episode:2}]}]
    await (store as any).poll()
    const episodes=parent.episodes!
    assert.equal(episodes.length,2);assert.equal(episodes[0].completed,true);assert.equal(episodes[1].completed,false);assert.equal(parent.completed,false)
    assert.equal(playableJobs(store.jobs).length,2);assert.equal(findJob(store.jobs,episodes[0].id),episodes[0]);assert.equal(store.job(episodes[1].id).episode,2)
    const srt=path.join(root,'input.srt');fs.writeFileSync(srt,'1\n00:00:01,000 --> 00:00:03,000\nEpisode 1\n')
    await store.importSubtitle(episodes[0].id,'en',srt)
    assert.deepEqual(episodes[0].subtitleLanguages,['en']);assert.deepEqual(episodes[1].subtitleLanguages,[])
    assert.equal(fs.existsSync(subtitleFile(path.join(parent.directory,episodes[0].videoPath),'en')),true)
    assert.equal(fs.existsSync(subtitleFile(path.join(parent.directory,episodes[1].videoPath),'en')),false)
    await store.pause(parent.id);assert.equal(episodes.every(item=>item.paused),true)
    await store.close();closed=true
    const reopened=new StateDatabase(root),restored=new Store(reopened,vault as any,engine as any,'')
    try{calls.length=0;await restored.start();const added=calls.filter(args=>args[0]==='add');assert.equal(added.length,1);assert.deepEqual(added[0].slice(-2),[1,-1]);assert.deepEqual(restored.job(episodes[0].id).subtitleLanguages,['en'])}finally{await restored.close()}
  }finally{if(!closed)await store.close();fs.rmSync(root,{recursive:true,force:true})}
})

test('automatic TV subtitle sync saves each episode subtitle beside its matching video',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reel-tv-subtitles-')),db=new StateDatabase(root),settings=defaults(),original=globalThis.fetch,requested:number[]=[]
  settings.autoSubtitles=false;settings.autoAlignSubtitles=false;settings.languages=['vi'];settings.subtitleSources=[{id:'subdl',name:'SubDL',kind:'subdl',endpoint:'https://api.subdl.com/api/v1',enabled:true}]
  const base={id:'series',title:'Fixture · S01',year:'2026',uri:'',sourceURI:'',directory:root,createdAt:Date.now(),paused:true,completed:true,videoPath:'',subtitlePhase:'pending' as const,subtitleLanguages:[],subtitleError:'',engineError:'',mediaType:'tv' as const,season:1,subtitleSearchTitle:'Fixture'}
  const episodes=[1,2].map(episode=>{const videoPath=`Fixture.S01E0${episode}.1080p.WEB-DL.mkv`;fs.writeFileSync(path.join(root,videoPath),'video');return{...base,id:`series-file-${episode}`,title:`Fixture · S01E0${episode}`,episode,torrentID:'series',videoPath}})
  db.save({version:2,settings,jobs:[{...base,episodes}]})
  globalThis.fetch=async input=>{
    const url=new URL(String(input))
    if(url.hostname==='dl.subdl.com')return new Response(`1\n00:00:01,000 --> 00:00:03,000\nEpisode ${url.pathname.split('/').at(-1)}\n`)
    assert.equal(url.searchParams.get('type'),'tv');assert.equal(url.searchParams.get('season_number'),'1')
    const episode=Number(url.searchParams.get('episode_number'));requested.push(episode)
    return response({status:true,subtitles:[{language:'VI',season:1,episode,release_name:`Fixture.S01E0${episode}.1080p.WEB-DL`,name:`Fixture.S01E0${episode}.srt`,url:`/subtitle/fixture/${episode}`}]})
  }
  const store=new Store(db,{has:()=>true,get:()=> 'fixture'} as any,{close:async()=>{}} as any,'')
  try{
    store.sync();await (store as any).syncTask
    assert.deepEqual(requested,[1,2])
    for(const episode of episodes){assert.equal(store.job(episode.id).subtitlePhase,'complete');const output=fs.readFileSync(subtitleFile(path.join(root,episode.videoPath),'vi'),'utf8');assert.match(output,new RegExp(`Episode ${episode.episode}`));assert.deepEqual(store.job(episode.id).subtitleLanguages,['vi'])}
  }finally{globalThis.fetch=original;await store.close();fs.rmSync(root,{recursive:true,force:true})}
})
