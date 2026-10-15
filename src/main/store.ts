import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { Alignment, AppState, EngineSnapshot, Job, Language, Movie, Release, SavedState, Settings, SubtitleMatch, SubtitleSource, TorrentSource } from '../shared/types'
import { quality, releaseKey, retryDelay, safeName } from '../shared/matching'
import { StateDatabase, defaults } from './database'
import { Vault } from './vault'
import { Engine } from './engine'
import { Timing, TimingRejected } from './timing'
import { downloadSubtitle, searchSubtitle, searchTorrent, testSource, validateSubtitle } from './providers'
import { request } from './network'
import { stopProcesses } from './process'
export const videoFile=(job:Job):string=>{
  if(!job.videoPath)throw new Error('No video file found in this torrent.')
  const file=path.resolve(job.directory,job.videoPath),base=path.resolve(job.directory)+path.sep
  if(!file.startsWith(base))throw new Error('Invalid video path.')
  return file
}
export const subtitleFile=(video:string,language:Language,original=false)=>path.join(path.dirname(video),path.parse(video).name+`.${language}${original?'.original':''}.srt`)
const errorText=(error:unknown)=>error instanceof Error?error.message:'The operation failed.'
async function readOptional(file:string){try{return await fs.readFile(file)}catch{return undefined}}
export class Store extends EventEmitter {
  state:SavedState
  syncing=false
  closing=false
  engineReady=false
  notice?:string
  readonly busy=new Map<string,Promise<unknown>>()
  readonly aligning=new Set<string>()
  readonly matches=new Map<string,SubtitleMatch[]>()
  readonly sourceTests:Record<string,string>={}
  readonly timing:Timing
  private timers:ReturnType<typeof setInterval>[]=[]
  private pollBusy=false
  private ticks=0
  private syncTask?:Promise<void>
  constructor(readonly db:StateDatabase,readonly vault:Vault,readonly engine:Engine,tools:string){
    super();this.state=db.load()??{version:2,settings:defaults(),jobs:[]}
    this.timing=new Timing(tools,db.root)
    for(const job of this.state.jobs)if(job.subtitlePhase==='searching')job.subtitlePhase='pending'
  }
  get settings(){return this.state.settings}
  get jobs(){return this.state.jobs}
  snapshot():AppState{
    const credentialStatus:Record<string,boolean>={'catalog.tmdb':this.vault.has('catalog.tmdb')}
    for(const source of this.settings.subtitleSources)credentialStatus[source.id]=this.vault.has('subtitle.key.'+source.id)
    for(const source of this.settings.torrentSources)credentialStatus[source.id]=this.vault.has('torrent.'+source.id)
    return {...structuredClone(this.state),syncing:this.syncing,subtitleBusy:[...this.busy.keys()],aligning:[...this.aligning],credentialStatus,sourceTests:{...this.sourceTests},engineReady:this.engineReady,notice:this.notice}
  }
  publish(){this.emit('change',this.snapshot())}
  persist(){if(!this.closing)this.db.save(this.state)}
  async start(){
    try{
      await fs.mkdir(path.join(this.db.root,'Resume'),{recursive:true});await this.engine.call('create',path.join(this.db.root,'Resume'),false);this.engineReady=true
      for(const job of this.jobs.filter(job=>!job.completed))try{await this.engine.call('add',job.id,job.uri,job.directory,true);if(job.paused)await this.engine.call('pause',job.id,true)}catch(error){job.engineError=errorText(error)}
      this.timers.push(setInterval(()=>void this.poll(),2000))
    }catch(error){this.notice=errorText(error)}
    this.timers.push(setInterval(()=>void this.scan(),30_000));this.publish();void this.scan()
  }
  private async poll(){
    if(this.pollBusy||this.closing)return;this.pollBusy=true
    try{
      const snapshots=await this.engine.call<EngineSnapshot[]>('snapshot');let changed=false
      for(const snapshot of snapshots){const job=this.jobs.find(job=>job.id===snapshot.id);if(!job)continue
        if(JSON.stringify(job.engine)!==JSON.stringify(snapshot)){job.engine=snapshot;job.paused=snapshot.paused;changed=true}
        if(snapshot.videoPath)job.videoPath=snapshot.videoPath
        if(snapshot.finished&&!job.completed){job.completed=true;job.paused=true;await this.engine.call('pause',job.id,true);this.persist();void this.scan()}
      }
      this.ticks++;if(this.ticks%8===0){await this.engine.call('save');this.persist()}
      if(changed)this.publish()
    }catch(error){this.notice=errorText(error);this.publish()}finally{this.pollBusy=false}
  }
  saveSettings(input:Partial<Settings>){
    const previous=JSON.stringify([this.settings.autoSubtitles,this.settings.autoAlignSubtitles,this.settings.languages,this.settings.subtitleSources])
    this.state.settings={...this.settings,...input}
    this.persist();this.publish()
    if(previous!==JSON.stringify([this.settings.autoSubtitles,this.settings.autoAlignSubtitles,this.settings.languages,this.settings.subtitleSources]))this.retry()
    return this.snapshot()
  }
  saveSource(source:TorrentSource|SubtitleSource,key?:string){
    const subtitle=['subdl','subsource'].includes(source.kind)
    const list=subtitle?this.settings.subtitleSources:this.settings.torrentSources
    const index=list.findIndex(item=>item.id===source.id)
    if(index>=0)(list as (TorrentSource|SubtitleSource)[])[index]=source;else(list as (TorrentSource|SubtitleSource)[]).push(source)
    if(key!==undefined)this.vault.set((subtitle?'subtitle.key.':'torrent.')+source.id,key)
    delete this.sourceTests[source.id];this.persist();this.publish();if(subtitle)this.retry();return this.snapshot()
  }
  deleteSource(id:string){this.settings.subtitleSources=this.settings.subtitleSources.filter(source=>source.id!==id);this.settings.torrentSources=this.settings.torrentSources.filter(source=>source.id!==id);this.persist();this.publish();return this.snapshot()}
  async testSource(source:TorrentSource|SubtitleSource,key?:string){
    const secret=key??this.vault.get((['subdl','subsource'].includes(source.kind)?'subtitle.key.':'torrent.')+source.id)
    try{const result=await testSource(source,secret);this.sourceTests[source.id]=result;this.publish();return result}catch(error){this.sourceTests[source.id]=errorText(error);this.publish();throw error}
  }
  async releases(movie:Movie){
    if(movie.mediaType==='tv')throw new Error('Season and episode downloads are not supported yet.')
    const results=await Promise.all(this.settings.torrentSources.filter(source=>source.enabled).map(async source=>{try{return {releases:await searchTorrent(source,this.vault.get('torrent.'+source.id),movie),error:''}}catch(error){return{releases:[],error:source.name+': '+errorText(error)}}}))
    const seen=new Set<string>(),releases=results.flatMap(result=>result.releases).filter(release=>{const key=releaseKey(release.uri);if(seen.has(key))return false;seen.add(key);return true})
    releases.sort((a,b)=>Number(quality(b.title)===this.settings.quality)-Number(quality(a.title)===this.settings.quality)||(b.seeds??0)-(a.seeds??0))
    return{releases,errors:results.map(result=>result.error).filter(Boolean)}
  }
  async add(release:Release,movie?:Movie,title?:string){
    if(!this.engineReady)throw new Error('The torrent engine is not ready.')
    if(!this.settings.downloadDirectory)throw new Error('Choose a download folder in Settings first.')
    if(this.jobs.some(job=>releaseKey(job.sourceURI||job.uri)===releaseKey(release.uri)))throw new Error('This torrent is already in your library.')
    const id=crypto.randomUUID(),name=movie?.title||title?.trim()||release.title
    let directory=path.join(this.settings.downloadDirectory,safeName(name+(movie?.year?` (${movie.year})`:'')))
    try{await fs.access(directory);directory=path.join(directory,id.slice(0,8))}catch{}
    await fs.mkdir(directory,{recursive:true})
    let uri=release.uri
    if(/^https?:\/\//.test(uri)){const data=await request(uri,{},8_000_000);await fs.mkdir(path.join(this.db.root,'Torrents'),{recursive:true});uri=path.join(this.db.root,'Torrents',id+'.torrent');await fs.writeFile(uri,data)}
    else if(uri.startsWith('file:')){const url=new URL(uri);if(path.extname(url.pathname).toLowerCase()!=='.torrent')throw new Error('Choose a torrent file.');await fs.mkdir(path.join(this.db.root,'Torrents'),{recursive:true});uri=path.join(this.db.root,'Torrents',id+'.torrent');await fs.copyFile(url,uri)}
    else if(!uri.startsWith('magnet:?'))throw new Error('Paste a magnet or torrent URL, or choose a torrent file.')
    await this.engine.call('add',id,uri,directory,false)
    this.jobs.unshift({id,title:name,year:movie?.year??'',uri,sourceURI:release.uri,directory,createdAt:Date.now(),paused:false,completed:false,videoPath:'',subtitlePhase:'pending',subtitleLanguages:[],subtitleError:'',engineError:'',subtitleSearchTitle:movie?.searchTitle})
    this.persist();this.publish();return this.snapshot()
  }
  job(id:string){const job=this.jobs.find(job=>job.id===id);if(!job)throw new Error('The movie is no longer in your library.');return job}
  async pause(id:string){const job=this.job(id);if(job.completed)return this.snapshot();await this.engine.call('pause',id,!job.paused);job.paused=!job.paused;this.persist();this.publish();return this.snapshot()}
  async remove(id:string){const job=this.job(id);if(this.busy.has(id))throw new Error('Wait for subtitle processing to finish before removing this movie.');if(!job.completed&&!job.engineError)await this.engine.call('remove',id);this.state.jobs=this.jobs.filter(job=>job.id!==id);this.matches.delete(id);this.persist();this.publish();return this.snapshot()}
  retry(){for(const job of this.jobs)if(job.completed)job.subtitleNextAttempt=undefined;this.persist();this.publish();void this.scan()}
  private async scan(){if(this.closing||!this.settings.autoSubtitles||this.syncing||this.busy.size)return;const job=this.jobs.find(job=>job.completed&&(!job.subtitleNextAttempt||job.subtitleNextAttempt<=Date.now()));if(job)await this.fetchSubtitles(job.id,true)}
  sync(){
    if(this.syncing||this.closing)return this.snapshot();this.syncing=true;this.publish()
    this.syncTask=(async()=>{try{for(const job of [...this.jobs].filter(job=>job.completed)){if(this.closing)break;if(this.busy.has(job.id)){await this.busy.get(job.id);continue}await this.fetchSubtitles(job.id,true)}}finally{this.syncing=false;this.persist();this.publish()}})()
    return this.snapshot()
  }
  private task<T>(id:string,operation:()=>Promise<T>):Promise<T>{
    const existing=this.busy.get(id);if(existing)return existing as Promise<T>
    const work=Promise.resolve().then(operation).finally(()=>{this.busy.delete(id);this.aligning.delete(id);this.persist();this.publish()})
    this.busy.set(id,work);this.publish();return work
  }
  async fetchSubtitles(id:string,automatic:boolean):Promise<SubtitleMatch[]>{
    if(this.busy.has(id)){await this.busy.get(id);return this.matches.get(id)??[]}
    return this.task(id,async()=>{
      const job=this.job(id);if(!job.completed)return []
      job.subtitleError='';job.subtitleNextAttempt=Date.now()+300_000
      try{
        const video=videoFile(job);await fs.access(video)
        job.subtitleLanguages=[]
        for(const language of ['vi','en'] as Language[]){const data=await readOptional(subtitleFile(video,language));if(data){try{validateSubtitle(data);job.subtitleLanguages.push(language)}catch{}}}
        const missing=this.settings.languages.filter(language=>!job.subtitleLanguages.includes(language))
        if(automatic&&this.settings.languages.length&&!missing.length){job.subtitlePhase='complete';return []}
        const sources=this.settings.subtitleSources.filter(source=>source.enabled&&this.vault.has('subtitle.key.'+source.id))
        if(!sources.length||!this.settings.languages.length){job.subtitlePhase='needsConfiguration';job.subtitleError='Enable a subtitle source and add its API key in Settings.';return []}
        job.subtitlePhase='searching';this.publish()
        const matches:SubtitleMatch[]=[],failures:string[]=[]
        for(const source of sources){if(this.closing)return [];try{matches.push(...await searchSubtitle(source,this.vault.get('subtitle.key.'+source.id),job.subtitleSearchTitle??job.title,job.year,path.basename(video),automatic?missing:this.settings.languages));this.sourceTests[source.id]='Connected successfully.'}catch(error){failures.push(source.name+': '+errorText(error))}}
        matches.sort((a,b)=>b.confidence-a.confidence);this.matches.set(id,matches)
        if(automatic){
          for(const language of missing){
            for(const match of matches.filter(match=>match.language===language&&match.confidence>=(this.settings.autoAlignSubtitles?0.85:0.95)).slice(0,3)){
              if(this.closing)return matches
              try{await this.acquire(job,match,match.confidence<0.95);if(!job.subtitleLanguages.includes(language))job.subtitleLanguages.push(language);break}catch(error){if(!(error instanceof TimingRejected))failures.push(errorText(error))}
            }
          }
        }
        const complete=this.settings.languages.every(language=>job.subtitleLanguages.includes(language))
        job.subtitlePhase=complete?'complete':failures.length?'failed':matches.length?'needsSelection':'notFound'
        job.subtitleError=complete?'':failures.join('\n')
        return matches
      }catch(error){job.subtitlePhase='failed';job.subtitleError=errorText(error);return []}
      finally{job.subtitleNextAttempt=Date.now()+retryDelay(job.subtitlePhase);this.persist();this.publish()}
    })
  }
  private async acquire(job:Job,match:SubtitleMatch,requireVerified:boolean){
    const source=this.settings.subtitleSources.find(source=>source.id===match.sourceID);if(!source)throw new Error('The subtitle source was removed.')
    const video=videoFile(job),destination=subtitleFile(video,match.language),previous=await readOptional(destination)
    const scratch=path.join(this.db.root,'SubtitleWork',crypto.randomUUID());await fs.mkdir(scratch,{recursive:true})
    try{
      const original=await downloadSubtitle(source,this.vault.get('subtitle.key.'+source.id),match),staged=path.join(scratch,'input.srt');await fs.writeFile(staged,original)
      let alignment:Alignment|undefined,warning:string|undefined
      if(this.settings.autoAlignSubtitles){this.aligning.add(job.id);this.publish();try{alignment=await this.timing.align(video,staged)}catch(error){if(requireVerified)throw error;warning=errorText(error)}finally{this.aligning.delete(job.id);this.publish()}}
      else if(requireVerified)throw new TimingRejected()
      if(this.closing||!this.jobs.some(item=>item.id===job.id))throw new Error('Subtitle processing was cancelled.')
      const current=await readOptional(destination)
      if(!sameBuffer(current,previous))throw new Error('The subtitle changed during alignment. Please try again.')
      const output=validateSubtitle(await fs.readFile(staged))
      await atomicWrite(subtitleFile(video,match.language,true),original);await atomicWrite(destination,output)
      job.subtitleAlignment??={};if(alignment)job.subtitleAlignment[match.language]=alignment;else delete job.subtitleAlignment[match.language]
      job.subtitleTimingError=warning
    }finally{await fs.rm(scratch,{recursive:true,force:true})}
  }
  async useSubtitle(id:string,matchID:string){
    if(this.busy.has(id))throw new Error('Wait for subtitle processing to finish.')
    const match=this.matches.get(id)?.find(match=>match.id===matchID);if(!match)throw new Error('Search subtitles again before choosing a release.')
    await this.task(id,async()=>{const job=this.job(id);await this.acquire(job,match,false);if(!job.subtitleLanguages.includes(match.language))job.subtitleLanguages.push(match.language);job.subtitlePhase=this.settings.languages.every(language=>job.subtitleLanguages.includes(language))?'complete':'needsSelection';job.subtitleError=''})
    return this.snapshot()
  }
  async importSubtitle(id:string,language:Language,file:string){if(this.busy.has(id))throw new Error('Wait for subtitle processing to finish.');const job=this.job(id);await atomicWrite(subtitleFile(videoFile(job),language),validateSubtitle(await fs.readFile(file)));if(!job.subtitleLanguages.includes(language))job.subtitleLanguages.push(language);delete job.subtitleAlignment?.[language];job.subtitleError='';job.subtitlePhase=this.settings.languages.every(value=>job.subtitleLanguages.includes(value))?'complete':'needsSelection';this.persist();this.publish();return this.snapshot()}
  async alignExisting(id:string){
    if(this.busy.has(id))throw new Error('Wait for subtitle processing to finish.')
    await this.task(id,async()=>{const job=this.job(id),video=videoFile(job);this.aligning.add(id);this.publish()
      for(const language of job.subtitleLanguages){const subtitle=subtitleFile(video,language),scratch=path.join(this.db.root,'SubtitleWork',crypto.randomUUID());await fs.mkdir(scratch,{recursive:true})
        try{const original=validateSubtitle(await fs.readFile(subtitle)),staged=path.join(scratch,'input.srt');await fs.writeFile(staged,original);const result=await this.timing.align(video,staged);if(this.closing)break;if(!sameBuffer(await readOptional(subtitle),original))throw new Error('The subtitle changed during alignment. Please try again.');if(!await readOptional(subtitleFile(video,language,true)))await atomicWrite(subtitleFile(video,language,true),original);await atomicWrite(subtitle,validateSubtitle(await fs.readFile(staged)));job.subtitleAlignment??={};job.subtitleAlignment[language]=result;job.subtitleTimingError=undefined}catch(error){job.subtitleTimingError=errorText(error)}finally{await fs.rm(scratch,{recursive:true,force:true})}}
    });return this.snapshot()
  }
  async restore(id:string,language:Language){if(this.busy.has(id))throw new Error('Wait for subtitle processing to finish.');const job=this.job(id),video=videoFile(job);await atomicWrite(subtitleFile(video,language),validateSubtitle(await fs.readFile(subtitleFile(video,language,true))));delete job.subtitleAlignment?.[language];job.subtitleTimingError=undefined;this.persist();this.publish();return this.snapshot()}
  async close(){this.closing=true;for(const timer of this.timers)clearInterval(timer);stopProcesses();await Promise.allSettled([...this.busy.values(),this.syncTask]);try{await this.engine.close()}finally{this.db.save(this.state);this.db.close()}}
}
function sameBuffer(a:Buffer|undefined,b:Buffer|undefined){return a===undefined?b===undefined:b!==undefined&&a.equals(b)}
export async function atomicWrite(file:string,data:Buffer){const temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,data);await fs.rename(temp,file)}
