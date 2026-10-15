import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, CommandMap, Invoke } from '../shared/types'
const commands=new Set<keyof CommandMap>(['state','saveSettings','catalog','providers','saveTMDB','chooseDirectory','torrentFile','searchReleases','addDownload','pauseDownload','removeDownload','reveal','testSource','saveSource','deleteSource','syncSubtitles','searchSubtitles','useSubtitle','importSubtitle','alignSubtitles','restoreTiming','subtitleCues','preview','thumbnail','openLink'])
const invoke:Invoke=(command,input)=>{if(!commands.has(command))return Promise.reject(new Error('Unsupported command.'));return ipcRenderer.invoke('reel:command',command,input)}
contextBridge.exposeInMainWorld('reel',{invoke,subscribe:(callback:(state:AppState)=>void)=>{const listener=(_:unknown,state:AppState)=>callback(state);ipcRenderer.on('reel:state',listener);return()=>ipcRenderer.removeListener('reel:state',listener)}})
