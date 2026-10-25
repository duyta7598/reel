import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { DownloadQueue, validateManifest, type DownloadDisk, type DownloadEntry, type Connection } from '../mobile/src/queue'
import type { TransferItem } from '../src/shared/transfer'
const peer:Connection={baseURL:'http://192.168.1.2:47653',token:'secret',deviceID:'phone',computer:'PC'}
const manifest:TransferItem={id:'movie',title:'Movie',year:'2026',mediaType:'movie',files:[{kind:'video',name:'Movie.mkv',size:100,version:'100-1',md5:'a'.repeat(32)},{kind:'subtitle-vi',name:'Movie.vi.srt',size:20,version:'20-1',md5:'b'.repeat(32)}]}
async function until(check:()=>boolean){for(let n=0;n<100;n++){if(check())return;await delay(5)}assert.fail('Queue did not reach expected state.')}
function fixture(){
  const files=new Map<string,{size:number;md5?:string}>(),saved:DownloadEntry[][]=[],started:string[]=[],removed:string[]=[]
  let finish:(()=>void)|undefined,corrupt=false,hold=false
  const disk:DownloadDisk={save:async entries=>{saved.push(entries)},manifest:async()=>structuredClone(manifest),info:async(id,name,part)=>files.get(id+'/'+name+(part?'.part':''))??null,remove:async id=>{removed.push(id);for(const key of files.keys())if(key.startsWith(id+'/'))files.delete(key)},removePartial:async(id,name)=>{files.delete(id+'/'+name+'.part')},commit:async(id,name)=>{files.set(id+'/'+name,files.get(id+'/'+name+'.part')!);files.delete(id+'/'+name+'.part')},free:async()=>1e9,task:(_,entry,file,progress)=>{let resolve:(value:number|undefined)=>void;return{run:()=>new Promise(done=>{resolve=done;started.push(file.kind);progress(file.size/2);finish=()=>{files.set(entry.id+'/'+file.name+'.part',{size:file.size,md5:corrupt?'c'.repeat(32):file.md5});done(200)};if(!hold)finish()}),pause:async()=>{resolve(undefined);return'resume-data'}}}}
  return{disk,files,saved,started,removed,setHold:(value:boolean)=>{hold=value},setCorrupt:(value:boolean)=>{corrupt=value},finish:()=>finish?.()}
}
test('mobile queue downloads video and subtitle as one verified offline item and stores no credentials',async()=>{
  const f=fixture(),queue=new DownloadQueue(f.disk);await queue.connect(peer);queue.enqueue(manifest)
  await until(()=>queue.entries[0].phase==='complete')
  assert.deepEqual(f.started,['video','subtitle-vi']);assert.equal(queue.entries[0].fileIndex,2)
  await delay(10);assert.equal(JSON.stringify(f.saved).includes('secret'),false)
  await queue.connect(null);assert.equal(queue.entries[0].phase,'complete');await queue.remove(queue.entries[0].id);assert.equal(queue.entries.length,0)
})
test('mobile queue restores a paused transfer and resumes without duplicating completed files',async()=>{
  const f=fixture();f.setHold(true);const queue=new DownloadQueue(f.disk);await queue.connect(peer);queue.enqueue(manifest)
  await until(()=>f.started.length===1);const id=queue.entries[0].id;await queue.pause(id);assert.equal(queue.entries[0].resumeData,'resume-data');await delay(10)
  const restored=new DownloadQueue(f.disk);restored.restore(structuredClone(queue.entries));assert.equal(restored.entries[0].phase,'paused');await restored.connect(peer);f.setHold(false);await restored.resume(id);await until(()=>restored.entries[0].phase==='complete');assert.equal(restored.entries[0].fileIndex,2)
})
test('checksum mismatch stays failed and cannot appear as an offline movie',async()=>{
  const f=fixture();f.setCorrupt(true);const queue=new DownloadQueue(f.disk);await queue.connect(peer);queue.enqueue(manifest);await until(()=>queue.entries[0].phase==='failed');assert.match(queue.entries[0].error!,/checksum/);assert.equal(queue.entries[0].fileIndex,0);assert.equal([...f.files.keys()].length,0)
  f.setCorrupt(false);await queue.resume(queue.entries[0].id);await until(()=>queue.entries[0].phase==='complete')
})
test('manifest refuses traversal, duplicate files and missing hashes',()=>{
  for(const name of ['../Movie.mkv','file/movie.mkv','..','C:\\movie.mkv']){const value=structuredClone(manifest);value.files[0].name=name;assert.throws(()=>validateManifest(value))}
  const duplicate=structuredClone(manifest);duplicate.files.push(duplicate.files[0]);assert.throws(()=>validateManifest(duplicate))
  const missing=structuredClone(manifest);delete missing.files[0].md5;assert.throws(()=>validateManifest(missing))
})
