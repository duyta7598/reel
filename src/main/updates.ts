import { EventEmitter } from 'node:events'
import type { UpdateStatus } from '../shared/update'
export interface UpdateDriver extends EventEmitter {
  autoDownload:boolean
  autoInstallOnAppQuit:boolean
  allowPrerelease:boolean
  allowDowngrade:boolean
  checkForUpdates():Promise<unknown>
  downloadUpdate():Promise<unknown>
  quitAndInstall(silent?:boolean,forceRunAfter?:boolean):void
}
export function updateDisabledReason(packaged:boolean,platform:string,configured:boolean,signed:boolean){
  if(!packaged)return 'Updates are available in installed builds only.'
  if(!['darwin','win32'].includes(platform))return 'Automatic updates are not supported on this platform.'
  if(platform==='darwin'&&!signed)return 'This macOS build is not signed for automatic updates.'
  if(!configured)return 'This build has no update source configured.'
}
export class DesktopUpdates {
  private state:UpdateStatus
  private checking?:Promise<UpdateStatus>
  private downloading?:Promise<UpdateStatus>
  constructor(readonly driver:UpdateDriver,version:string,readonly changed:(value:UpdateStatus)=>void,readonly busy:()=>boolean,reason?:string){
    this.state={currentVersion:version,phase:reason?'disabled':'idle',reason}
    driver.autoDownload=false;driver.autoInstallOnAppQuit=false;driver.allowPrerelease=false;driver.allowDowngrade=false
    driver.on('error',(error:Error)=>this.fail(error))
    driver.on('update-available',(info:{version:string;releaseNotes?:string|{version:string;note:string}[]})=>{
      const notes=typeof info.releaseNotes==='string'?info.releaseNotes:info.releaseNotes?.map(item=>item.version+'\n'+item.note).join('\n\n')
      this.set({phase:'downloading',version:info.version,notes:notes?.slice(0,12_000),percent:0,error:undefined})
      void this.download()
    })
    driver.on('update-not-available',()=>this.set({phase:'idle',checkedAt:Date.now(),error:undefined,version:undefined,notes:undefined,percent:undefined}))
    driver.on('download-progress',(progress:{percent:number;transferred:number;total:number})=>this.set({phase:'downloading',percent:Math.max(0,Math.min(100,progress.percent)),transferred:progress.transferred,total:progress.total}))
    driver.on('update-downloaded',(info:{version:string})=>this.set({phase:'ready',version:info.version,percent:100,error:undefined}))
  }
  status(){return{...this.state}}
  private set(value:Partial<UpdateStatus>){this.state={...this.state,...value};this.changed(this.status())}
  private fail(error:unknown){this.set({phase:'error',error:error instanceof Error?error.message:'Could not update Reel.'})}
  check():Promise<UpdateStatus>{
    if(['disabled','ready','installing'].includes(this.state.phase))return Promise.resolve(this.status())
    if(this.downloading)return this.downloading
    if(this.checking)return this.checking
    this.set({phase:'checking',error:undefined,version:undefined,notes:undefined,percent:undefined,transferred:undefined,total:undefined})
    this.checking=Promise.resolve().then(()=>this.driver.checkForUpdates()).catch(error=>this.fail(error)).then(()=>this.status()).finally(()=>{this.checking=undefined})
    return this.checking
  }
  private download(){
    if(!this.downloading)this.downloading=Promise.resolve().then(()=>this.driver.downloadUpdate()).catch(error=>this.fail(error)).then(()=>this.status()).finally(()=>{this.downloading=undefined})
    return this.downloading
  }
  async install(prepare:()=>Promise<void>){
    if(this.state.phase!=='ready')throw new Error('Download an update before restarting.')
    if(this.busy())throw new Error('Pause downloads and wait for mobile transfers and subtitle tasks before updating.')
    this.set({phase:'installing',error:undefined})
    try{await prepare();this.driver.quitAndInstall(false,true)}catch(error){this.set({phase:'ready',error:error instanceof Error?error.message:'Could not install the update.'});throw error}
    return this.status()
  }
}
