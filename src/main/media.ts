import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Preview } from '../shared/types'
import { Store, videoFile } from './store'
import { run } from './process'
export function byteRange(header:string|undefined,size:number):{start:number;end:number}|null{
  if(!header)return {start:0,end:size-1}
  const match=header.match(/^bytes=(\d*)-(\d*)$/)
  if(!match||!size)return null
  let start:number,end:number
  if(!match[1]){const suffix=Number(match[2]);if(!suffix)return null;start=Math.max(0,size-suffix);end=size-1}
  else {start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1}
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start?{start,end}:null
}
export class MediaServer {
  private server:http.Server
  private port=0
  private token=crypto.randomBytes(32).toString('hex')
  private children=new Set<ChildProcess>()
  private durationCache=new Map<string,number>()
  private thumbnailJobs=new Map<string,Promise<string|null>>()
  private thumbnailTail:Promise<unknown>=Promise.resolve()
  constructor(readonly store:Store,readonly tools:string){this.server=http.createServer((req,res)=>void this.handle(req,res))}
  get ffmpeg(){return path.join(this.tools,process.platform==='win32'?'ffmpeg.exe':'ffmpeg')}
  async start(){await new Promise<void>((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',()=>{this.port=(this.server.address() as import('node:net').AddressInfo).port;resolve()})})}
  private url(route:string,id:string,params:Record<string,string>={}){const url=new URL(`http://127.0.0.1:${this.port}/${route}/${encodeURIComponent(id)}`);url.searchParams.set('token',this.token);for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);return url.href}
  async duration(id:string){const video=videoFile(this.store.job(id)),stat=await fsp.stat(video),key=video+stat.size+stat.mtimeMs;if(this.durationCache.has(key))return this.durationCache.get(key)!;const result=await run(this.ffmpeg,['-hide_banner','-i',video],{timeout:15_000});const match=result.stderr.toString().match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);if(!match)throw new Error('Could not read the video duration.');const duration=Number(match[1])*3600+Number(match[2])*60+Number(match[3]);this.durationCache.set(key,duration);return duration}
  async preview(id:string,start:number,transcode:boolean):Promise<Preview>{const duration=await this.duration(id),offset=Math.max(0,Math.min(start,duration-0.1));return{url:this.url(transcode?'preview':'video',id,{start:String(offset)}),duration,transcoded:transcode}}
  async thumbnail(id:string):Promise<string|null>{
    if(this.thumbnailJobs.has(id))return this.thumbnailJobs.get(id)!
    const work=this.thumbnailTail.then(async()=>{
      const job=this.store.job(id);if(!job.completed||!job.videoPath)return null
      const cache=path.join(this.store.db.root,'Thumbnails',id+'-electron.jpg');await fsp.mkdir(path.dirname(cache),{recursive:true})
      try{await fsp.access(cache)}catch{try{const duration=await this.duration(id);const result=await run(this.ffmpeg,['-nostdin','-y','-v','error','-ss',String(Math.min(90,duration*0.1)),'-i',videoFile(job),'-frames:v','1','-vf','scale=640:-2',cache],{timeout:45_000});if(result.code!==0)return null}catch{return null}}
      return this.url('thumbnail',id)
    })
    this.thumbnailTail=work.catch(()=>{});this.thumbnailJobs.set(id,work);return work
  }
  private async handle(req:http.IncomingMessage,res:http.ServerResponse){
    try{
      const url=new URL(req.url??'/','http://127.0.0.1'),match=url.pathname.match(/^\/(video|preview|thumbnail)\/([^/]+)$/)
      if(!match||url.searchParams.get('token')!==this.token||!['GET','HEAD'].includes(req.method??'')){res.writeHead(403);res.end();return}
      const id=decodeURIComponent(match[2]),job=this.store.job(id)
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff')
      if(match[1]==='preview'){
        if(this.children.size>=2){res.writeHead(429);res.end();return}
        const start=Math.max(0,Number(url.searchParams.get('start'))||0)
        res.writeHead(200,{'Content-Type':'video/mp4','Connection':'close'})
        if(req.method==='HEAD'){res.end();return}
        const child=spawn(this.ffmpeg,['-nostdin','-v','error','-ss',String(start),'-i',videoFile(job),'-map','0:v:0','-map','0:a:0?','-sn','-vf',"scale='min(1280,iw)':-2",'-c:v','libx264','-preset','ultrafast','-crf','24','-threads','2','-c:a','aac','-ac','2','-b:a','128k','-movflags','frag_keyframe+empty_moov+default_base_moof','-f','mp4','pipe:1'],{windowsHide:true,stdio:['ignore','pipe','ignore']})
        this.children.add(child);child.stdout.pipe(res)
        child.on('error',()=>res.destroy());child.on('close',()=>{this.children.delete(child);res.end()})
        res.on('close',()=>{child.kill('SIGTERM');this.children.delete(child)})
        return
      }
      const file=match[1]==='thumbnail'?path.join(this.store.db.root,'Thumbnails',id+'-electron.jpg'):videoFile(job)
      const stat=await fsp.stat(file),range=byteRange(req.headers.range,stat.size)
      if(!range){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return}
      const ext=path.extname(file).toLowerCase(),type=ext==='.jpg'?'image/jpeg':ext==='.webm'?'video/webm':ext==='.mkv'?'video/x-matroska':'video/mp4'
      res.writeHead(req.headers.range?206:200,{'Content-Type':type,'Accept-Ranges':'bytes','Content-Length':range.end-range.start+1,...(req.headers.range?{'Content-Range':`bytes ${range.start}-${range.end}/${stat.size}`}:{})})
      if(req.method==='HEAD'){res.end();return}
      const stream=fs.createReadStream(file,range);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res)
    }catch{if(!res.headersSent)res.writeHead(404);res.end()}
  }
  async close(){for(const child of this.children)child.kill('SIGTERM');this.children.clear();this.server.closeAllConnections();await new Promise<void>(resolve=>this.server.close(()=>resolve()))}
}
