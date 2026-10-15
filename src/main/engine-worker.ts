import { parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'
const require=createRequire(__filename)
const native=require(workerData.addon)
let engine:any
parentPort!.on('message',(message:{id:number;method:string;args:any[]})=>{
  try{
    let result:any
    if(message.method==='create'){engine=native.create(...message.args);result=true}
    else if(message.method==='destroy'){if(engine){native.destroy(engine);engine=null}result=true}
    else if(message.method==='snapshot')result=JSON.parse(native.snapshot(engine))
    else result=native[message.method](engine,...message.args)
    parentPort!.postMessage({id:message.id,result})
  }catch(error){parentPort!.postMessage({id:message.id,error:error instanceof Error?error.message:'Torrent engine failed.'})}
})
