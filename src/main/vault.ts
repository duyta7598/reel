import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
export class Vault {
  private entries:Record<string,string>={}
  private cache=new Map<string,string>()
  private file:string
  constructor(root:string){this.file=path.join(root,'credentials.json');if(fs.existsSync(this.file))this.entries=JSON.parse(fs.readFileSync(this.file,'utf8'))}
  has(key:string){return Boolean(this.entries[key])}
  get(key:string):string{
    if(this.cache.has(key))return this.cache.get(key)!
    if(!this.entries[key])return ''
    if(!safeStorage.isEncryptionAvailable())throw new Error('Unlock the system credential store before using API keys.')
    const value=safeStorage.decryptString(Buffer.from(this.entries[key],'base64'));this.cache.set(key,value);return value
  }
  set(key:string,value:string){
    if(!value.trim()){delete this.entries[key];this.cache.delete(key)}else{
      if(!safeStorage.isEncryptionAvailable())throw new Error('Secure credential storage is unavailable.')
      if(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text')throw new Error('Configure a system credential store before saving API keys.')
      this.entries[key]=safeStorage.encryptString(value.trim()).toString('base64');this.cache.set(key,value.trim())
    }
    const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.entries),{mode:0o600});fs.renameSync(temp,this.file)
  }
}
