import { spawn, type ChildProcess } from 'node:child_process'
const running=new Set<ChildProcess>()
export function run(executable:string,args:string[],options:{cwd?:string;timeout?:number;signal?:AbortSignal;maxOutput?:number}={}):Promise<{stdout:Buffer;stderr:Buffer;code:number}>{
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd:options.cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],signal:options.signal})
    running.add(child)
    const stdout:Buffer[]=[],stderr:Buffer[]=[];let size=0,settled=false
    const finish=(error?:Error,code=0)=>{if(settled)return;settled=true;clearTimeout(timer);running.delete(child);error?reject(error):resolve({stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr),code})}
    const stop=()=>{child.kill('SIGTERM');const kill=setTimeout(()=>child.kill('SIGKILL'),2000);kill.unref()}
    const timer=setTimeout(()=>{stop();finish(new Error('The operation timed out.'))},options.timeout??600_000)
    const consume=(target:Buffer[],data:Buffer)=>{size+=data.length;if(size>(options.maxOutput??2_000_000)){stop();finish(new Error('The tool returned too much data.'));return}target.push(data)}
    child.stdout.on('data',data=>consume(stdout,data));child.stderr.on('data',data=>consume(stderr,data))
    child.on('error',error=>finish(error));child.on('close',code=>finish(undefined,code??1))
  })
}
export function stopProcesses(){for(const child of running){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);timer.unref()}running.clear()}
