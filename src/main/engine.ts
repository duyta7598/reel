import { Worker } from 'node:worker_threads'
import path from 'node:path'
import fs from 'node:fs'
export class Engine {
  private worker:Worker
  private nextID=0
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(reason:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  constructor(addon:string){
    if(!fs.existsSync(addon))throw new Error('The torrent engine is unavailable. Build the native module first.')
    this.worker=new Worker(path.join(__dirname,'engine-worker.js'),{workerData:{addon}})
    this.worker.on('message',message=>{const entry=this.pending.get(message.id);if(!entry)return;clearTimeout(entry.timer);this.pending.delete(message.id);message.error?entry.reject(new Error(message.error)):entry.resolve(message.result)})
    const rejectAll=(error:Error)=>{for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(error)}this.pending.clear()}
    this.worker.on('error',rejectAll)
    this.worker.on('exit',code=>{if(code)rejectAll(new Error('The torrent engine stopped unexpectedly.'))})
  }
  call<T=any>(method:string,...args:any[]):Promise<T>{
    return new Promise((resolve,reject)=>{const id=++this.nextID;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('The torrent engine timed out.'))},30_000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,method,args})})
  }
  async close(){try{await this.call('destroy')}finally{await this.worker.terminate()}}
}
