import type { TransferFile, TransferItem } from '../../src/shared/transfer'
export interface Connection { baseURL:string; token:string; deviceID:string; computer:string }
export interface DownloadEntry { id:string; item:TransferItem; source:string; phase:'queued'|'downloading'|'paused'|'failed'|'complete'; fileIndex:number; received:number; resumeData?:string; error?:string }
export interface DownloadTask { run:()=>Promise<number|undefined>; pause:()=>Promise<string|undefined> }
export interface DownloadDisk {
  save:(entries:DownloadEntry[])=>Promise<void>
  manifest:(connection:Connection,id:string)=>Promise<TransferItem>
  info:(id:string,name:string,partial:boolean)=>Promise<{size:number;md5?:string}|null>
  remove:(id:string)=>Promise<void>
  removePartial:(id:string,name:string)=>Promise<void>
  commit:(id:string,name:string)=>Promise<void>
  free:()=>Promise<number>
  task:(connection:Connection,entry:DownloadEntry,file:TransferFile,progress:(bytes:number)=>void)=>DownloadTask
}
export function safeFileName(value:string){if(!value||value==='.'||value==='..'||value.length>240||/[\\/\x00-\x1f:]/.test(value))throw new Error('Invalid file name.');return value}
export function validateManifest(value:any):TransferItem{
  if(!value||typeof value.id!=='string'||typeof value.title!=='string'||!Array.isArray(value.files)||value.files.length<1||value.files.length>3)throw new Error('Invalid movie manifest.')
  const kinds=new Set<string>(),names=new Set<string>()
  for(const file of value.files){if(!['video','subtitle-vi','subtitle-en'].includes(file.kind)||kinds.has(file.kind)||!Number.isSafeInteger(file.size)||file.size<=0||typeof file.version!=='string'||!/^[a-f0-9]{32}$/.test(file.md5))throw new Error('Invalid download file.');safeFileName(file.name);if(names.has(file.name.toLowerCase()))throw new Error('Duplicate file name.');names.add(file.name.toLowerCase());kinds.add(file.kind)}
  if(!kinds.has('video'))throw new Error('Video file missing.')
  return value
}
export class DownloadQueue {
  entries:DownloadEntry[]=[]
  private connection:Connection|null=null
  private active?:{entry:DownloadEntry;task?:DownloadTask}
  private listeners=new Set<()=>void>()
  private saving:Promise<void>=Promise.resolve()
  constructor(readonly disk:DownloadDisk){}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  private changed(persist=true){for(const listener of this.listeners)listener();if(persist){const snapshot=JSON.parse(JSON.stringify(this.entries));this.saving=this.saving.catch(()=>{}).then(()=>this.disk.save(snapshot));void this.saving.catch(()=>{})}}
  restore(entries:DownloadEntry[]){this.entries=entries.filter(entry=>/^download-[a-z0-9-]+$/.test(entry.id)&&entry.item&&Array.isArray(entry.item.files)&&Number.isInteger(entry.fileIndex)).map(entry=>({...entry,phase:entry.phase==='queued'||entry.phase==='downloading'?'paused':entry.phase,resumeData:entry.phase==='downloading'?undefined:entry.resumeData}));this.changed()}
  async connect(connection:Connection|null){if(this.active)await this.pause(this.active.entry.id);this.connection=connection}
  enqueue(item:TransferItem){if(!this.connection)throw new Error('Connect to your computer first.');if(this.entries.some(entry=>entry.item.id===item.id&&entry.source===this.connection!.deviceID&&entry.phase!=='failed'))throw new Error('This movie is already on your download list.');this.entries.unshift({id:`download-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`,item,source:this.connection.deviceID,phase:'queued',fileIndex:0,received:0});this.changed();void this.drain()}
  async resume(id:string){const entry=this.entries.find(item=>item.id===id);if(!entry||entry.phase==='complete'||entry.phase==='downloading')return;if(!this.connection||this.connection.deviceID!==entry.source)throw new Error('Reconnect to the computer used for this download.');entry.phase='queued';entry.error=undefined;this.changed();void this.drain()}
  async pause(id:string){const entry=this.entries.find(item=>item.id===id);if(!entry||entry.phase==='complete')return;entry.phase='paused';this.changed();if(this.active?.entry===entry&&this.active.task){try{entry.resumeData=await this.active.task.pause()}catch{entry.resumeData=undefined}this.changed()}}
  async remove(id:string){await this.pause(id);await this.disk.remove(id);this.entries=this.entries.filter(entry=>entry.id!==id);this.changed()}
  private async drain(){
    if(this.active||!this.connection)return
    const entry=this.entries.find(item=>item.phase==='queued'&&item.source===this.connection!.deviceID);if(!entry)return
    const connection=this.connection;this.active={entry};entry.phase='downloading';this.changed()
    try{
      const manifest=validateManifest(await this.disk.manifest(connection,entry.item.id))
      if(manifest.id!==entry.item.id)throw new Error('The computer returned a different movie.')
      const same=entry.item.files.length===manifest.files.length&&manifest.files.every((file,index)=>file.version===entry.item.files[index]?.version&&file.name===entry.item.files[index]?.name)
      if(!same){await this.disk.remove(entry.id);entry.fileIndex=0;entry.received=0;entry.resumeData=undefined}
      entry.item=manifest;this.changed()
      if((entry.phase as string)!=='downloading')return
      const required=manifest.files.slice(entry.fileIndex).reduce((sum,file)=>sum+file.size,0)
      if(await this.disk.free()<required+50*1024*1024)throw new Error('Not enough free space on this phone.')
      for(let index=entry.fileIndex;index<manifest.files.length;index++){
        if((entry.phase as string)!=='downloading')return
        const file=manifest.files[index],matches=(info:{size:number;md5?:string}|null)=>info?.size===file.size&&info.md5===file.md5
        if(!matches(await this.disk.info(entry.id,file.name,false))){
          if(!matches(await this.disk.info(entry.id,file.name,true))){
            if(!entry.resumeData)await this.disk.removePartial(entry.id,file.name)
            entry.received=0
            this.active!.task=this.disk.task(connection,entry,file,bytes=>{entry.received=bytes;this.changed(false)})
            const status=await this.active!.task.run();this.active!.task=undefined
            if((entry.phase as string)!=='downloading')return
            if(status===undefined){entry.phase='paused';this.changed();return}
            entry.resumeData=undefined
            if(status!==200&&status!==206)throw new Error(`Download failed (${status}). Refresh or pair this phone again.`)
            if(!matches(await this.disk.info(entry.id,file.name,true))){await this.disk.removePartial(entry.id,file.name);throw new Error('File checksum did not match. Retry this download.')}
          }
          await this.disk.commit(entry.id,file.name)
        }
        entry.fileIndex=index+1;entry.received=0;entry.resumeData=undefined;this.changed()
      }
      entry.phase='complete';entry.error=undefined;this.changed()
    }catch(error){if((entry.phase as string)!=='paused'){entry.phase='failed';entry.resumeData=undefined;entry.error=error instanceof Error?error.message:'Download failed.';this.changed()}}
    finally{this.active=undefined;void this.drain()}
  }
}
