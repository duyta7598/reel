import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import type { Job } from '../shared/types'
import type { TransferDevice, TransferFile, TransferItem, TransferStatus } from '../shared/transfer'
import { playableJobs } from '../shared/series'
import { videoFile, subtitleFile } from './store'
import { byteRange } from './media'
type Device=TransferDevice&{hash:string}
type Library={root:string;jobs:()=>Job[]}
const digest=(value:string)=>crypto.createHash('sha256').update(value).digest('hex')
const version=(stat:fs.Stats)=>`${stat.size}-${stat.mtimeMs}`
export class TransferServer {
  private server:http.Server|null=null
  private port=0
  private devices:Device[]=[]
  private pairing?:{code:string;expiresAt:number}
  private failures=new Map<string,{count:number;until:number}>()
  private hashes=new Map<string,Promise<string>>()
  private streams=new Map<string,Set<http.ServerResponse>>()
  constructor(readonly library:Library,readonly options:{port?:number;host?:string;now?:()=>number}={}){
    try{const saved=JSON.parse(fs.readFileSync(this.devicePath,'utf8'));if(Array.isArray(saved))this.devices=saved.filter((item:any)=>typeof item.id==='string'&&typeof item.name==='string'&&Number.isFinite(item.createdAt)&&/^[a-f0-9]{64}$/.test(item.hash)).slice(0,20)}catch{}
  }
  private get devicePath(){return path.join(this.library.root,'mobile-devices.json')}
  private get now(){return this.options.now?.()??Date.now()}
  private persist(){fs.mkdirSync(this.library.root,{recursive:true});const temp=this.devicePath+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.devices),{mode:0o600});fs.renameSync(temp,this.devicePath)}
  get activeTransfers(){return [...this.streams.values()].reduce((total,streams)=>total+streams.size,0)}
  status():TransferStatus{
    const hosts=new Set<string>()
    if(this.options.host!=='127.0.0.1')for(const values of Object.values(os.networkInterfaces()))for(const item of values??[])if(item.family==='IPv4'&&!item.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address))hosts.add(item.address)
    if(this.options.host==='127.0.0.1')hosts.add('127.0.0.1')
    return{running:!!this.server,addresses:this.server?[...hosts].map(host=>`http://${host}:${this.port}`):[],devices:this.devices.map(({id,name,createdAt})=>({id,name,createdAt})),pairing:this.pairing&&this.pairing.expiresAt>this.now?this.pairing:undefined}
  }
  async start(){
    if(this.server)return this.newPairing()
    const server=http.createServer((req,res)=>void this.handle(req,res));server.requestTimeout=30_000;server.headersTimeout=10_000
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(this.options.port??47653,this.options.host??'0.0.0.0',()=>{server.removeListener('error',reject);resolve()})})
    this.server=server;this.port=(server.address() as import('node:net').AddressInfo).port
    return this.newPairing()
  }
  newPairing(){if(!this.server)throw new Error('Start mobile transfer first.');this.pairing={code:crypto.randomBytes(24).toString('hex'),expiresAt:this.now+5*60_000};return this.status()}
  revoke(id:string){this.devices=this.devices.filter(item=>item.id!==id);this.persist();for(const response of this.streams.get(id)??[])response.destroy();this.streams.delete(id);return this.status()}
  async stop(){const server=this.server;this.server=null;this.pairing=undefined;this.hashes.clear();if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}return this.status()}
  private json(res:http.ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))}
  private async body(req:http.IncomingMessage){let bytes=0;const chunks:Buffer[]=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)throw new Error('Request too large.');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
  private jobs(){return playableJobs(this.library.jobs()).filter(job=>job.completed&&job.videoPath)}
  private async file(job:Job,kind:string){
    const video=videoFile(job),target=kind==='video'?video:kind==='subtitle-vi'?subtitleFile(video,'vi'):kind==='subtitle-en'?subtitleFile(video,'en'):null
    if(!target)throw new Error('Unknown file.')
    const [base,file]=await Promise.all([fsp.realpath(job.directory),fsp.realpath(target)])
    if(!file.startsWith(base+path.sep))throw new Error('Invalid file.')
    const stat=await fsp.stat(file);if(!stat.isFile()||stat.size<=0)throw new Error('File unavailable.')
    return{file,stat,descriptor:{kind,name:path.basename(file),size:stat.size,version:version(stat)} as TransferFile}
  }
  private async item(job:Job):Promise<TransferItem>{
    const files:TransferFile[]=[]
    for(const kind of ['video','subtitle-vi','subtitle-en'])try{files.push((await this.file(job,kind)).descriptor)}catch{if(kind==='video')throw new Error('Video unavailable.')}
    return{id:job.id,title:job.title,year:job.year,mediaType:job.mediaType??'movie',season:job.season,episode:job.episode,files}
  }
  private hash(file:string,stat:fs.Stats){
    const key=file+':'+version(stat)
    if(!this.hashes.has(key)){
      if(this.hashes.size>=64)this.hashes.delete(this.hashes.keys().next().value!)
      const task=(async()=>{const hash=crypto.createHash('md5');await pipeline(fs.createReadStream(file),hash);const current=await fsp.stat(file);if(version(current)!==version(stat))throw new Error('File changed.');return hash.digest('hex')})()
      this.hashes.set(key,task);void task.catch(()=>this.hashes.delete(key))
    }
    return this.hashes.get(key)!
  }
  private async handle(req:http.IncomingMessage,res:http.ServerResponse){
    try{
      if(req.headers.origin){this.json(res,403,{error:'Browser access is disabled.'});return}
      const url=new URL(req.url??'/','http://localhost'),method=req.method??''
      if(url.pathname==='/v1/pair'&&method==='POST'){
        const address=req.socket.remoteAddress??'',attempt=this.failures.get(address)
        if(attempt&&attempt.until>this.now&&attempt.count>=10){this.json(res,429,{error:'Too many pairing attempts.'});return}
        const body=await this.body(req)
        if(!this.pairing||this.pairing.expiresAt<=this.now||typeof body.code!=='string'||body.code!==this.pairing.code){if(this.failures.size>=256)this.failures.clear();this.failures.set(address,{count:attempt&&attempt.until>this.now?attempt.count+1:1,until:this.now+60_000});this.json(res,403,{error:'Pairing expired or invalid.'});return}
        if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80||this.devices.length>=20){this.json(res,400,{error:'Invalid device name or device limit reached.'});return}
        const token=crypto.randomBytes(32).toString('hex'),device={id:crypto.randomUUID(),name:body.name.trim(),createdAt:this.now,hash:digest(token)}
        this.devices.push(device);try{this.persist()}catch(error){this.devices.pop();throw error}this.pairing=undefined
        this.json(res,200,{token,deviceID:device.id,computer:os.hostname()});return
      }
      const authorization=req.headers.authorization??'',token=authorization.startsWith('Bearer ')?authorization.slice(7):''
      const device=this.devices.find(device=>device.hash===digest(token))
      if(!token||!device){this.json(res,401,{error:'Pair this phone again in Reel desktop.'});return}
      if(!['GET','HEAD'].includes(method)){this.json(res,405,{error:'Method not allowed.'});return}
      if(url.pathname==='/v1/library'){
        const items:TransferItem[]=[];for(const job of this.jobs())try{items.push(await this.item(job))}catch{}
        this.json(res,200,{items});return
      }
      const match=url.pathname.match(/^\/v1\/(items|files)\/([^/]+)(?:\/([^/]+))?$/)
      const job=match?this.jobs().find(item=>item.id===decodeURIComponent(match[2])):undefined
      if(!match||!job){this.json(res,404,{error:'Movie unavailable.'});return}
      if(match[1]==='items'&&!match[3]){
        const item=await this.item(job)
        for(const descriptor of item.files){const {file,stat}=await this.file(job,descriptor.kind);descriptor.md5=await this.hash(file,stat)}
        this.json(res,200,item);return
      }
      if(match[1]!=='files'||!match[3]){this.json(res,404,{error:'File unavailable.'});return}
      const {file,stat,descriptor}=await this.file(job,decodeURIComponent(match[3]))
      if(url.searchParams.get('version')!==descriptor.version){this.json(res,409,{error:'File changed; restart this download.'});return}
      const range=byteRange(req.headers.range,stat.size)
      if(!range){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return}
      res.writeHead(req.headers.range?206:200,{'Content-Type':'application/octet-stream','Content-Length':range.end-range.start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store','ETag':`"${descriptor.version}"`,'X-Content-Type-Options':'nosniff',...(req.headers.range?{'Content-Range':`bytes ${range.start}-${range.end}/${stat.size}`}:{})})
      if(method==='HEAD'){res.end();return}
      const stream=fs.createReadStream(file,range);if(!this.streams.has(device.id))this.streams.set(device.id,new Set());this.streams.get(device.id)!.add(res);res.on('close',()=>{stream.destroy();this.streams.get(device.id)?.delete(res)});stream.on('error',()=>res.destroy());stream.pipe(res)
    }catch{if(!res.headersSent)this.json(res,400,{error:'Transfer request failed. Refresh the library and try again.'});else res.destroy()}
  }
}
