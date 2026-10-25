import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { TransferServer } from '../src/main/transfer'
import { readPairing } from '../src/shared/transfer'
import type { Job } from '../src/shared/types'
test('mobile pairing exposes completed files only, validates resume versions and revokes access',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reel-transfer-')),directory=path.join(root,'movies');await fs.mkdir(directory)
  const video=crypto.randomBytes(65000);await fs.writeFile(path.join(directory,'Movie.mkv'),video);await fs.writeFile(path.join(directory,'Movie.vi.srt'),'1\n00:00:00,000 --> 00:00:01,000\nHello\n')
  const movie={id:'movie',title:'Movie',year:'2026',directory,videoPath:'Movie.mkv',completed:true,subtitleLanguages:['vi']} as Job
  const episode={...movie,id:'episode',title:'Show S01E01',mediaType:'tv',season:1,episode:1} as Job
  const jobs=[movie,{...movie,id:'pending',completed:false},{...movie,id:'season',mediaType:'tv',episodes:[episode]},{...movie,id:'escape',videoPath:'../private'}] as Job[]
  const server=new TransferServer({root,jobs:()=>jobs},{port:0,host:'127.0.0.1'})
  try{
    const status=await server.start(),base=status.addresses.find(value=>value.includes('127.0.0.1'))!,code=status.pairing!.code
    assert.equal((await fetch(base+'/v1/library')).status,401)
    const pair=async(value:string)=>fetch(base+'/v1/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:value,name:'Test phone'})})
    assert.equal((await pair('wrong')).status,403)
    const response=await pair(code);assert.equal(response.status,200);const credentials=await response.json() as any
    assert.equal((await pair(code)).status,403)
    const headers={Authorization:`Bearer ${credentials.token}`}
    const list=await(await fetch(base+'/v1/library',{headers})).json() as any
    assert.deepEqual(list.items.map((item:any)=>item.id),['movie','episode']);assert.equal(JSON.stringify(list).includes(directory),false)
    const manifest=await(await fetch(base+'/v1/items/movie',{headers})).json() as any
    assert.equal(manifest.files.length,2);assert.equal(manifest.files[0].md5,crypto.createHash('md5').update(video).digest('hex'))
    const route=base+'/v1/files/movie/video?version='+encodeURIComponent(manifest.files[0].version)
    const range=await fetch(route,{headers:{...headers,Range:'bytes=123-456'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),video.subarray(123,457))
    assert.equal((await fetch(route,{method:'HEAD',headers})).headers.get('content-length'),String(video.length))
    assert.equal((await fetch(route,{headers:{...headers,Origin:'https://untrusted.example'}})).status,403)
    assert.equal((await fetch(base+'/v1/files/movie/video?version=old',{headers})).status,409)
    await fs.writeFile(path.join(directory,'Movie.mkv'),Buffer.alloc(10));assert.equal((await fetch(route,{headers})).status,409)
    server.revoke(credentials.deviceID);assert.equal((await fetch(base+'/v1/library',{headers})).status,401)
    assert.equal((await fs.readFile(path.join(root,'mobile-devices.json'),'utf8')).includes(credentials.token),false)
    await server.stop();assert.equal(server.status().running,false)
  }finally{await server.stop();await fs.rm(root,{recursive:true,force:true})}
})
test('mobile pairing codes expire and QR links reject external hosts',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reel-pairing-'));let now=1
  const server=new TransferServer({root,jobs:()=>[]},{port:0,host:'127.0.0.1',now:()=>now})
  try{
    const status=await server.start(),base=status.addresses.find(value=>value.includes('127.0.0.1'))!,code=status.pairing!.code
    const link=`reel-mobile://pair?url=${encodeURIComponent(base)}&code=${code}`;assert.equal(readPairing(link).baseURL,base)
    assert.throws(()=>readPairing(link.replace(encodeURIComponent(base),encodeURIComponent('http://example.com:80'))))
    now+=300_001
    assert.equal((await fetch(base+'/v1/pair',{method:'POST',body:JSON.stringify({code,name:'Phone'})})).status,403)
    assert.equal(server.status().pairing,undefined)
  }finally{await server.stop();await fs.rm(root,{recursive:true,force:true})}
})
