import * as FS from 'expo-file-system/legacy'
import { Directory, File } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'
import * as Sharing from 'expo-sharing'
import * as IntentLauncher from 'expo-intent-launcher'
import Storage from './storage'
import { Platform } from 'react-native'
import { DownloadQueue, safeFileName, type Connection, type DownloadEntry } from './queue'
import { localServer } from '../../src/shared/transfer'
import type { TransferItem } from '../../src/shared/transfer'
const root=FS.documentDirectory+'Movies/'
const directory=(id:string)=>{if(!/^download-[a-z0-9-]+$/.test(id))throw new Error('Invalid download.');return root+id+'/'}
export const fileURI=(entry:DownloadEntry,name:string)=>directory(entry.id)+safeFileName(name)
export async function request<T>(base:string,route:string,options:RequestInit={},timeout=15_000):Promise<T>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{const response=await fetch(localServer(base)+route,{...options,signal:controller.signal});if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error??`Connection failed (${response.status}).`)}return await response.json()}catch(error){if(controller.signal.aborted)throw new Error('Computer did not respond. Keep Reel open on the same Wi-Fi.');throw error}finally{clearTimeout(timer)}}
export async function connection(){const value=await SecureStore.getItemAsync('reel.connection');if(!value)return null;const saved=JSON.parse(value) as Connection;localServer(saved.baseURL);return saved}
export async function saveConnection(value:Connection|null){if(value)await SecureStore.setItemAsync('reel.connection',JSON.stringify(value));else await SecureStore.deleteItemAsync('reel.connection')}
const info=async(uri:string)=>{const value=await FS.getInfoAsync(uri,{md5:true});return value.exists&&!value.isDirectory?{size:value.size,md5:value.md5}:null}
export const queue=new DownloadQueue({
  save:entries=>Storage.setItemAsync('reel.downloads',JSON.stringify(entries)),
  manifest:(peer,id)=>request<TransferItem>(peer.baseURL,`/v1/items/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${peer.token}`}},180_000),
  info:(id,name,partial)=>info(directory(id)+safeFileName(name)+(partial?'.part':'')),
  remove:id=>FS.deleteAsync(directory(id),{idempotent:true}),
  removePartial:(id,name)=>FS.deleteAsync(directory(id)+safeFileName(name)+'.part',{idempotent:true}),
  commit:async(id,name)=>{const target=directory(id)+safeFileName(name);await FS.deleteAsync(target,{idempotent:true});await FS.moveAsync({from:target+'.part',to:target})},
  free:()=>FS.getFreeDiskStorageAsync(),
  task:(peer,entry,file,progress)=>{
    let task:FS.DownloadResumable|undefined,paused=false
    return{run:async()=>{await FS.makeDirectoryAsync(directory(entry.id),{intermediates:true});if(paused)return;task=FS.createDownloadResumable(`${peer.baseURL}/v1/files/${encodeURIComponent(entry.item.id)}/${encodeURIComponent(file.kind)}?version=${encodeURIComponent(file.version)}`,fileURI(entry,file.name)+'.part',{headers:{Authorization:`Bearer ${peer.token}`},sessionType:FS.FileSystemSessionType.BACKGROUND},value=>progress(value.totalBytesWritten),entry.resumeData);const result=entry.resumeData?await task.resumeAsync():await task.downloadAsync();return result?.status},pause:async()=>{paused=true;const saved=await task?.pauseAsync();return saved?.resumeData}}
  }
})
export async function restoreQueue(){try{const saved=await Storage.getItemAsync('reel.downloads');if(saved)queue.restore(JSON.parse(saved))}catch{throw new Error('Could not restore the download list. Local movie files were kept.')}}
export const mime=(name:string)=>name.toLowerCase().endsWith('.srt')?'application/x-subrip':name.toLowerCase().endsWith('.mkv')?'video/x-matroska':name.toLowerCase().endsWith('.webm')?'video/webm':name.toLowerCase().endsWith('.avi')?'video/x-msvideo':'video/mp4'
export async function openFile(entry:DownloadEntry,name:string){const uri=fileURI(entry,name);if(Platform.OS==='android'){await IntentLauncher.startActivityAsync('android.intent.action.VIEW',{data:await FS.getContentUriAsync(uri),flags:1,type:mime(name)})}else{if(!await Sharing.isAvailableAsync())throw new Error('File sharing is not available. Open the Reel folder in Files.');await Sharing.shareAsync(uri,{mimeType:mime(name),dialogTitle:'Open with another app'})}}
export async function exportFiles(entry:DownloadEntry){
  if(Platform.OS!=='android')throw new Error('Open Files > On My iPhone > Reel > Movies to access video and subtitle files together.')
  const permission=await FS.StorageAccessFramework.requestDirectoryPermissionsAsync();if(!permission.granted)return
  for(const file of entry.item.files){const target=new Directory(permission.directoryUri).createFile(file.name,mime(file.name));await new File(fileURI(entry,file.name)).copy(target,{overwrite:true})}
}
