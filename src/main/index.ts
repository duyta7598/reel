import { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { CatalogRequest, CommandMap, Movie, Release } from '../shared/types'
import { parseSRT } from '../shared/matching'
import { StateDatabase } from './database'
import { Vault } from './vault'
import { Engine } from './engine'
import { Store, videoFile, subtitleFile } from './store'
import { MediaServer } from './media'
import { TransferServer } from './transfer'
import { catalog, providers, tvSeasons, tvEpisodes } from './catalog'
import * as validate from './validation'
import { configureNetwork, initializeNetwork, networkStatus, testNetwork, closeNetwork } from './routing'
import { trayImage } from './icons'
import { abortRequests } from './network'
import { createUpdates } from './update-runtime'
import type { DesktopUpdates } from './updates'
let win:BrowserWindow|null=null,store:Store,media:MediaServer,transfer:TransferServer,tray:Tray|null=null,quitting=false,installingUpdate=false,updates:DesktopUpdates,updateTimer:ReturnType<typeof setInterval>|undefined
const hidden=process.env.REEL_HEADLESS==='1'
const root=process.env.REEL_DATA_DIR??path.join(app.getPath('appData'),'Reel Electron')
app.setPath('userData',root)
app.setName('Reel')
const appIcon=path.join(app.getAppPath(),'assets',process.platform==='win32'?'icon.ico':'icon.png')
if(hidden&&process.platform==='darwin')app.setActivationPolicy('accessory')
const frontend=path.join(__dirname,'../renderer/index.html')
const devURL=process.env.REEL_DEV_URL
const allowedSender=(url:string)=>devURL?url.startsWith(devURL+'/'):url===pathToFileURL(frontend).href
function showWindow(){
  if(win&&!win.isDestroyed()){if(!hidden){win.show();win.focus()}return}
  win=new BrowserWindow({width:1180,height:790,minWidth:960,minHeight:650,show:false,icon:appIcon,title:'Reel',backgroundColor:'#18111f',titleBarStyle:process.platform==='darwin'?'hiddenInset':'default',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen:hidden}})
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(!allowedSender(url))event.preventDefault()})
  win.webContents.session.setPermissionRequestHandler((_,__,callback)=>callback(false))
  win.once('ready-to-show',()=>{if(!hidden)win?.show()})
  win.on('close',event=>{if(!quitting){event.preventDefault();win?.hide()}})
  if(devURL)void win.loadURL(devURL);else void win.loadFile(frontend)
}
async function command<K extends keyof CommandMap>(name:K,input:any):Promise<any>{
  if(quitting)throw new Error('Reel is restarting or shutting down.')
  switch(name){
    case 'updateStatus':return updates.status()
    case 'checkUpdates':return updates.check()
    case 'installUpdate':try{return await updates.install(async()=>{installingUpdate=true;quitting=true;await shutdown()})}catch(error){if(installingUpdate){app.relaunch();app.exit(1)}throw error}
    case 'state':return store.snapshot()
    case 'transferStatus':return transfer.status()
    case 'startTransfer':return transfer.start()
    case 'stopTransfer':return transfer.stop()
    case 'pairTransfer':return transfer.newPairing()
    case 'revokeTransfer':return transfer.revoke(validate.id(input?.id))
    case 'saveSettings':{const value=validate.settings(input),state=store.saveSettings(value);if(value.network){configureNetwork(value.network);if(!hidden)void initializeNetwork().catch(()=>{})}return state}
    case 'networkStatus':return networkStatus()
    case 'testNetwork':return testNetwork()
    case 'prepareNetwork':await initializeNetwork();return networkStatus()
    case 'tvSeasons':return tvSeasons(validate.id(input?.id),store.vault.get('catalog.tmdb'),store.settings.interfaceLanguage)
    case 'tvEpisodes':return tvEpisodes(validate.id(input?.id),validate.season(input?.season),store.vault.get('catalog.tmdb'),store.settings.interfaceLanguage)
    case 'saveTMDB':store.vault.set('catalog.tmdb',validate.text(input?.token,10_000));store.publish();return store.snapshot()
    case 'catalog':{const value=input as CatalogRequest;if(!['movie','tv'].includes(value?.type)||!Number.isInteger(value.page)||value.page<1||value.page>500||!Number.isInteger(value.provider)||value.provider<0)throw new Error('Invalid catalog request.');validate.text(value.query,300);if(!/^[A-Z]{2}$/.test(value.region))throw new Error('Invalid region.');const result=await catalog(value,store.vault.get('catalog.tmdb'),store.settings.interfaceLanguage);return{...result,movies:result.movies.map(movie=>({...movie,poster:movie.poster?.startsWith('https://image.tmdb.org/')?media.poster(movie.poster):movie.poster}))}}
    case 'providers':if(!['movie','tv'].includes(input?.type)||!/^[A-Z]{2}$/.test(input.region))throw new Error('Invalid service request.');return providers(store.vault.get('catalog.tmdb'),input.type,input.region,store.settings.interfaceLanguage)
    case 'chooseDirectory':{const result=await dialog.showOpenDialog({properties:['openDirectory','createDirectory']});if(result.canceled)return null;store.saveSettings({downloadDirectory:result.filePaths[0]});return result.filePaths[0]}
    case 'torrentFile':{const result=await dialog.showOpenDialog({filters:[{name:'Torrent',extensions:['torrent']}],properties:['openFile']});return result.canceled?null:pathToFileURL(result.filePaths[0]).href}
    case 'searchReleases':return store.releases(validate.movie(input))
    case 'addDownload':{const release=input?.release as Release;validate.text(release?.uri,10_000);validate.text(release?.title,1000);const movie=input.movie?validate.movie(input.movie):undefined;if(!store.settings.downloadDirectory){const result=await command('chooseDirectory',undefined);if(!result)throw new Error('Choose a download folder before downloading.')}return store.add(release,movie,input.title)}
    case 'pauseDownload':return store.pause(validate.id(input?.id))
    case 'removeDownload':if(input?.deleteFiles!==undefined&&typeof input.deleteFiles!=='boolean')throw new Error('Invalid file deletion option.');if(input?.deleteFiles&&transfer.activeTransfers)throw new Error('Wait for mobile transfers to finish before deleting files.');return store.remove(validate.id(input?.id),input?.deleteFiles??false)
    case 'reveal':{const job=store.job(validate.id(input?.id));shell.showItemInFolder(job.mediaType==='tv'&&!job.torrentID?job.directory:videoFile(job));return}
    case 'testSource':return store.testSource(validate.source(input?.source),input.key===undefined?undefined:validate.text(input.key,10_000))
    case 'saveSource':return store.saveSource(validate.source(input?.source),input.key===undefined?undefined:validate.text(input.key,10_000))
    case 'deleteSource':return store.deleteSource(validate.id(input?.id))
    case 'syncSubtitles':return store.sync()
    case 'searchSubtitles':return store.fetchSubtitles(validate.id(input?.id),false)
    case 'useSubtitle':return store.useSubtitle(validate.id(input?.id),validate.text(input?.matchID,2000))
    case 'importSubtitle':{const id=validate.id(input?.id),language=validate.language(input?.language);const result=await dialog.showOpenDialog({filters:[{name:'SRT subtitle',extensions:['srt']}],properties:['openFile']});return result.canceled?store.snapshot():store.importSubtitle(id,language,result.filePaths[0])}
    case 'alignSubtitles':return store.alignExisting(validate.id(input?.id))
    case 'restoreTiming':return store.restore(validate.id(input?.id),validate.language(input?.language))
    case 'subtitleCues':{const video=videoFile(store.job(validate.id(input?.id)));const file=subtitleFile(video,validate.language(input?.language));if(!fs.existsSync(file))return [];if(fs.statSync(file).size>5_000_000)throw new Error('The subtitle is too large.');return parseSRT(fs.readFileSync(file,'utf8'))}
    case 'preview':if(!Number.isFinite(input?.start)||input.start<0||typeof input.transcode!=='boolean')throw new Error('Invalid preview request.');return media.preview(validate.id(input.id),input.start,input.transcode)
    case 'thumbnail':return media.thumbnail(validate.id(input?.id))
    case 'openLink':{const url=new URL(validate.text(input?.url,3000));if(url.protocol!=='https:'||!['subdl.com','subsource.net','www.themoviedb.org','www.justwatch.com'].includes(url.hostname))throw new Error('Unsupported external link.');await shell.openExternal(url.href);return}
    default:throw new Error('Unsupported command.')
  }
}
async function shutdown(){
  if(updateTimer)clearInterval(updateTimer)
  abortRequests();if(transfer)await transfer.stop();if(media)await media.close();if(store)await store.close();await closeNetwork();tray?.destroy()
}
if(!app.requestSingleInstanceLock())app.quit()
else{
  app.on('second-instance',()=>showWindow())
  app.whenReady().then(async()=>{
    if(process.platform==='win32')app.setAppUserModelId('local.reel.electron')
    if(!hidden&&process.platform==='darwin')app.dock?.setIcon(appIcon)
    const addon=app.isPackaged?path.join(process.resourcesPath,'app.asar.unpacked/build/Release/reel_engine.node'):path.join(__dirname,'../../build/Release/reel_engine.node')
    const tools=app.isPackaged?path.join(process.resourcesPath,'SubtitleTools'):path.join(__dirname,'../../Vendor/SubtitleTools')
    const db=new StateDatabase(root),vault=new Vault(root),engine=new Engine(addon)
    store=new Store(db,vault,engine,tools)
    transfer=new TransferServer({root:db.root,jobs:()=>store.jobs},hidden?{port:0,host:'127.0.0.1'}:{})
    updates=createUpdates(value=>{if(value.phase==='error'&&installingUpdate){app.relaunch();app.exit(1);return}if(win&&!win.isDestroyed())win.webContents.send('reel:update',value)},()=>transfer.activeTransfers>0||store.jobs.some(job=>!job.completed&&!job.paused)||store.busy.size>0||store.aligning.size>0||store.syncing)
    configureNetwork(store.settings.network)
    media=new MediaServer(store,tools);await media.start()
    ipcMain.handle('reel:command',async(event,name,input)=>{if(event.sender!==win?.webContents||!allowedSender(event.senderFrame?.url??''))throw new Error('Untrusted IPC sender.');return command(name,input)})
    store.on('change',state=>{if(win&&!win.isDestroyed())win.webContents.send('reel:state',state)})
    const icon=trayImage(app.getAppPath())
    if(!hidden){tray=new Tray(icon);tray.setToolTip('Reel');tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Reel',click:showWindow},{label:'Sync subtitles',click:()=>store.sync()},{type:'separator'},{label:'Quit Reel',click:()=>app.quit()}]));tray.on('click',showWindow)}
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Reel',submenu:[{label:'Open Reel',click:showWindow},{role:'quit'}]},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]))
    showWindow();if(!hidden)void initializeNetwork().catch(()=>{});await store.start();if(!hidden){void updates.check();updateTimer=setInterval(()=>void updates.check(),6*60*60_000);updateTimer.unref()}
  }).catch(error=>{if(!hidden)dialog.showErrorBox('Reel',error instanceof Error?error.message:'Could not start Reel.');app.exit(1)})
  app.on('activate',()=>{if(store)showWindow()})
  app.on('window-all-closed',()=>{})
  app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;void shutdown().finally(()=>app.quit())})
}
