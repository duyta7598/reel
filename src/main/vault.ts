import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
type CredentialStorage=Pick<typeof safeStorage,'isEncryptionAvailable'|'decryptString'|'encryptString'|'getSelectedStorageBackend'>
export class Vault {
  private entries:Record<string,string>={}
  private cache=new Map<string,string>()
  private unreadable=new Set<string>()
  private file:string
  constructor(root:string,private storage:CredentialStorage=safeStorage){this.file=path.join(root,'credentials.json');if(fs.existsSync(this.file))this.entries=JSON.parse(fs.readFileSync(this.file,'utf8'))}
  get needsReentry(){return this.unreadable.size>0}
  has(key:string){
    if(!this.entries[key]||this.unreadable.has(key))return false
    if(!this.storage.isEncryptionAvailable())return true
    return Boolean(this.get(key))
  }
  get(key:string):string{
    if(this.cache.has(key))return this.cache.get(key)!
    if(!this.entries[key]||this.unreadable.has(key))return ''
    if(!this.storage.isEncryptionAvailable())throw new Error('Unlock the system credential store before using API keys.')
    try{
      const value=this.storage.decryptString(Buffer.from(this.entries[key],'base64'));this.cache.set(key,value);return value
    }catch{this.unreadable.add(key);return ''}
  }
  set(key:string,value:string){
    if(!value.trim()){delete this.entries[key];this.cache.delete(key)}else{
      if(!this.storage.isEncryptionAvailable())throw new Error('Secure credential storage is unavailable.')
      if(process.platform==='linux'&&this.storage.getSelectedStorageBackend()==='basic_text')throw new Error('Configure a system credential store before saving API keys.')
      this.entries[key]=this.storage.encryptString(value.trim()).toString('base64');this.cache.set(key,value.trim())
    }
    this.unreadable.delete(key)
    const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.entries),{mode:0o600});fs.renameSync(temp,this.file)
  }
}
