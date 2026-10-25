import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DesktopUpdates, updateDisabledReason } from './updates'
import type { UpdateStatus } from '../shared/update'
export function createUpdates(changed:(value:UpdateStatus)=>void,busy:()=>boolean){
  let signed=process.platform!=='darwin'
  if(app.isPackaged&&process.platform==='darwin')try{
    const result=spawnSync('/usr/bin/codesign',['-dv','--verbose=4',path.resolve(process.execPath,'../../..')],{encoding:'utf8'})
    signed=result.status===0&&/Authority=Developer ID Application:/.test(result.stderr)
  }catch{}
  autoUpdater.logger=null
  return new DesktopUpdates(autoUpdater,app.getVersion(),changed,busy,updateDisabledReason(app.isPackaged,process.platform,fs.existsSync(path.join(process.resourcesPath,'app-update.yml')),signed))
}
