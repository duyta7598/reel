import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { movieFiles, deleteMovieFiles } from '../src/main/library-files'
import { Store } from '../src/main/store'
import { StateDatabase, defaults } from '../src/main/database'
import type { Job } from '../src/shared/types'
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reel-delete-')),directory=path.join(root,'Movie');await fs.mkdir(directory)
  const job={id:'movie',title:'Movie',year:'2026',directory,videoPath:'Movie.mkv',completed:true,paused:true,subtitlePhase:'complete',subtitleLanguages:['vi'],uri:'magnet:?xt=urn:btih:1234567890123456789012345678901234567890',sourceURI:'',createdAt:0,subtitleError:'',engineError:''} as Job
  for(const file of ['Movie.mkv','Movie.vi.srt','Movie.en.srt','Movie.vi.original.srt','keep.txt'])await fs.writeFile(path.join(directory,file),file)
  const db=new StateDatabase(root),settings=defaults();settings.autoSubtitles=false;db.save({version:3,settings,jobs:[job]})
  const calls:string[]=[],engine={call:async(method:string)=>{calls.push(method);return method==='snapshot'?[{id:job.id}]:undefined},close:async()=>{}}
  const store=new Store(db,{has:()=>false} as any,engine as any,'');store.engineReady=true
  return{root,directory,job,store,calls,close:async()=>{await store.close();await fs.rm(root,{recursive:true,force:true})}}
}
test('removing a library entry keeps files by default and detaches completed torrents',async()=>{
  const f=await fixture()
  try{await f.store.remove(f.job.id);assert.deepEqual(f.calls,['snapshot','remove']);assert.equal(f.store.jobs.length,0);assert.equal(await fs.readFile(path.join(f.directory,'Movie.mkv'),'utf8'),'Movie.mkv')}finally{await f.close()}
})
test('file deletion removes video and matching subtitles while keeping unrelated files',async()=>{
  const f=await fixture()
  try{
    await f.store.remove(f.job.id,true)
    assert.deepEqual((await fs.readdir(f.directory)).sort(),['keep.txt']);assert.equal(f.store.jobs.length,0)
    const reopened=new StateDatabase(f.root);try{assert.equal(reopened.load()?.jobs.length,0)}finally{reopened.close()}
  }finally{await f.close()}
})
test('season deletion includes every known episode and partial video',async()=>{
  const f=await fixture()
  try{
    const job=f.store.jobs[0];job.mediaType='tv';job.episodes=[{...job,id:'episode',torrentID:job.id,videoPath:'Show.S01E02.mkv'}];job.engine={videos:[{path:'Show.S01E03.mkv'}]} as any
    for(const file of ['Show.S01E02.mkv','Show.S01E02.vi.srt','Show.S01E03.mkv'])await fs.writeFile(path.join(f.directory,file),'fixture')
    await f.store.remove(job.id,true);assert.deepEqual(await fs.readdir(f.directory),['keep.txt'])
  }finally{await f.close()}
})
test('unsafe paths and shared files are rejected before detaching or deleting anything',async()=>{
  const f=await fixture()
  try{
    f.store.jobs[0].videoPath='../private.mkv';await fs.writeFile(path.join(f.root,'private.mkv'),'keep')
    await assert.rejects(f.store.remove(f.job.id,true),/outside/);assert.deepEqual(f.calls,[]);assert.equal(f.store.jobs.length,1)
    f.store.jobs[0].videoPath='Movie.mkv';f.store.jobs.push({...f.store.jobs[0],id:'shared'})
    await assert.rejects(f.store.remove(f.job.id,true),/another library/);assert.deepEqual(f.calls,[])
    assert.equal(await fs.readFile(path.join(f.root,'private.mkv'),'utf8'),'keep')
  }finally{await f.close()}
})
test('symbolic links outside the movie folder never delete the target',async()=>{
  if(process.platform==='win32')return
  const f=await fixture()
  try{
    await fs.unlink(path.join(f.directory,'Movie.mkv'));await fs.writeFile(path.join(f.root,'private.mkv'),'keep');await fs.symlink(path.join(f.root,'private.mkv'),path.join(f.directory,'Movie.mkv'))
    await assert.rejects(movieFiles(f.store.jobs[0],f.store.jobs),/outside/)
    assert.equal(await fs.readFile(path.join(f.root,'private.mkv'),'utf8'),'keep')
  }finally{await f.close()}
})
test('subtitle processing blocks removal and engine errors keep library and files intact',async()=>{
  const f=await fixture()
  try{
    f.store.busy.set(f.job.id,Promise.resolve());await assert.rejects(f.store.remove(f.job.id,true),/subtitle/);f.store.busy.clear()
    f.store.engine.call=async()=>{throw new Error('engine unavailable')}
    await assert.rejects(f.store.remove(f.job.id,true),/engine unavailable/);assert.equal(f.store.jobs.length,1)
    assert.equal(await fs.readFile(path.join(f.directory,'Movie.mkv'),'utf8'),'Movie.mkv')
  }finally{await f.close()}
})
test('missing files are tolerated and shared folders keep other movies',async()=>{
  const f=await fixture()
  try{
    const other={...f.job,id:'other',videoPath:'Other.mkv'};await fs.writeFile(path.join(f.directory,'Other.mkv'),'keep');await fs.unlink(path.join(f.directory,'Movie.en.srt'))
    const files=await movieFiles(f.job,[f.job,other]);await deleteMovieFiles(files)
    assert.equal(await fs.readFile(path.join(f.directory,'Other.mkv'),'utf8'),'keep');assert.deepEqual((await fs.readdir(f.directory)).sort(),['Other.mkv','keep.txt'])
  }finally{await f.close()}
})
