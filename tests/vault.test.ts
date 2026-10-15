import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Vault } from '../src/main/vault'
import { StateDatabase, defaults } from '../src/main/database'
import { Store } from '../src/main/store'
const storage=()=>({isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'unknown' as const,encryptString:(value:string)=>Buffer.from('fixture:'+value),decryptString:(value:Buffer)=>{const text=value.toString();if(!text.startsWith('fixture:'))throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');return text.slice(8)}})
test('unreadable credentials do not block the app and remain recoverable on disk',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reel-vault-')),file=path.join(root,'credentials.json')
  const original=JSON.stringify({'catalog.tmdb':Buffer.from('old-key').toString('base64'),'subtitle.key.subdl':Buffer.from('fixture:working-key').toString('base64')})
  fs.writeFileSync(file,original)
  const db=new StateDatabase(root),settings=defaults();settings.subtitleSources=[{id:'subdl',name:'SubDL',kind:'subdl',endpoint:'https://api.subdl.com/api/v1',enabled:true}];db.save({version:2,settings,jobs:[]})
  const crypto=storage();let attempts=0;const decrypt=crypto.decryptString;crypto.decryptString=value=>{attempts++;return decrypt(value)}
  const vault=new Vault(root,crypto),store=new Store(db,vault,{} as any,'')
  try{
    const state=store.snapshot()
    assert.equal(state.credentialStatus['catalog.tmdb'],false)
    assert.equal(state.credentialStatus['subdl'],true)
    assert.equal(state.notice,'Some saved API keys could not be unlocked. Re-enter them in Settings.')
    assert.equal(vault.get('catalog.tmdb'),'');assert.equal(vault.get('catalog.tmdb'),'')
    assert.equal(vault.get('subtitle.key.subdl'),'working-key');assert.equal(attempts,2)
    assert.equal(fs.readFileSync(file,'utf8'),original)
    vault.set('catalog.tmdb',' replacement-key ')
    assert.equal(store.snapshot().notice,undefined);assert.equal(store.snapshot().credentialStatus['catalog.tmdb'],true)
    const reopened=new Vault(root,storage())
    assert.equal(reopened.get('catalog.tmdb'),'replacement-key');assert.equal(reopened.get('subtitle.key.subdl'),'working-key')
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8'))['catalog.tmdb'],Buffer.from('fixture:replacement-key').toString('base64'))
  }finally{db.close();fs.rmSync(root,{recursive:true,force:true})}
})
test('temporarily locked storage can be retried without invalidating saved credentials',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reel-vault-'))
  const crypto=storage(),vault=new Vault(root,crypto)
  try{
    vault.set('catalog.tmdb','token')
    const reopened=new Vault(root,crypto)
    crypto.isEncryptionAvailable=()=>false
    assert.equal(reopened.has('catalog.tmdb'),true)
    assert.throws(()=>reopened.get('catalog.tmdb'),/Unlock the system credential store/)
    assert.equal(reopened.needsReentry,false)
    crypto.isEncryptionAvailable=()=>true
    assert.equal(reopened.get('catalog.tmdb'),'token');assert.equal(reopened.needsReentry,false)
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
test('rejected encryption preserves the previous stored credential',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'reel-vault-')),file=path.join(root,'credentials.json')
  const crypto=storage(),vault=new Vault(root,crypto)
  try{
    vault.set('catalog.tmdb','token');const original=fs.readFileSync(file,'utf8')
    crypto.encryptString=()=>{throw new Error('Encryption failed')}
    assert.throws(()=>vault.set('catalog.tmdb','replacement'),/Encryption failed/)
    assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(vault.get('catalog.tmdb'),'token')
  }finally{fs.rmSync(root,{recursive:true,force:true})}
})
