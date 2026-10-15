import { search1337x } from './1337x'
import path from 'node:path'
import fs from 'node:fs/promises'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import yauzl from 'yauzl'
import type { Movie, Release, TorrentSource, SubtitleSource, SubtitleMatch, Language } from '../shared/types'
import { episodeCode, episodeIdentity, seasonIdentity } from '../shared/series'
import { confidence, normalize, parseSRT } from '../shared/matching'
import { endpoint, json, request } from './network'
const list = <T>(value: T | T[] | undefined):T[] => value === undefined ? [] : Array.isArray(value) ? value : [value]
export function parsePirateBay(data: unknown, source: TorrentSource): Release[] {
  if (!Array.isArray(data)) throw new Error('The source returned invalid data.')
  return data.flatMap(item => {
    const hash = String(item.info_hash??'')
    if (!/^[a-f0-9]{40}$/i.test(hash)||/^0+$/.test(hash)||!item.name) return []
    const magnet = new URL('magnet:'); magnet.searchParams.set('xt',`urn:btih:${hash}`);magnet.searchParams.set('dn',item.name)
    return [{id:source.id+hash.toLowerCase(),title:String(item.name),uri:magnet.toString(),size:Number(item.size)||0,seeds:Number(item.seeders)||0,source:source.name}]
  })
}
export function parseTorznab(data: string, source: TorrentSource): Release[] {
  if (/<!doctype/i.test(data)||XMLValidator.validate(data)!==true) throw new Error('Could not read Torznab results.')
  const xml = new XMLParser({ignoreAttributes:false,attributeNamePrefix:'',removeNSPrefix:true,processEntities:true}).parse(data)
  if (xml.error) throw new Error(String(xml.error.description??'The source denied access.'))
  return list<any>(xml.rss?.channel?.item).flatMap(item => {
    const attrs = Object.fromEntries(list<any>(item.attr).map(attr=>[attr.name,attr.value]))
    const uri=String(attrs.magneturl??item.enclosure?.url??item.link??'')
    if (!/^(magnet:|https?:\/\/)/i.test(uri)) return []
    return [{id:source.id+String(item.guid?.['#text']??item.guid??uri),title:String(item.title??'Torrent'),uri,size:Number(attrs.size??item.size??item.enclosure?.length)||0,seeds:attrs.seeders===undefined?undefined:Number(attrs.seeders),source:source.name}]
  })
}
export async function searchTorrent(source:TorrentSource,key:string,movie:Movie):Promise<Release[]> {
  const tv=movie.mediaType==='tv',query=tv?`${movie.searchTitle} ${episodeCode(movie.season!,movie.episode)}`:`${movie.searchTitle} ${movie.year}`.trim()
  if(source.kind==='x1337')return search1337x(source,query,tv)
  if(tv&&source.kind==='archive')return []
  if (source.kind==='pirateBay') return parsePirateBay(await json(endpoint(source.endpoint.replace(/\/$/,'')+'/q.php',{q:query,cat:tv?'205':'200'}),{networkGroup:'sources'}),source)
  if (source.kind==='torznab') return parseTorznab((await request(endpoint(source.endpoint,{t:'search',q:query,cat:tv?'5000':'2000',apikey:key}),{networkGroup:'sources'})).toString('utf8'),source)
  const title=movie.searchTitle.replace(/[^\p{L}\p{N} ]/gu,' ')
  const url=endpoint(source.endpoint.replace(/\/$/,'')+'/advancedsearch.php',{q:`mediatype:movies AND format:"Archive BitTorrent" AND title:"${title}"`,output:'json',rows:'25'})
  url.searchParams.append('fl[]','identifier');url.searchParams.append('fl[]','title')
  const result=await json(url,{networkGroup:'sources'})
  if (!Array.isArray(result.response?.docs)) throw new Error('Internet Archive returned invalid data.')
  return result.response.docs.filter((item:any)=>/^[A-Za-z0-9_.-]+$/.test(item.identifier)).map((item:any)=>({id:source.id+item.identifier,title:String(item.title??item.identifier),uri:`${source.endpoint.replace(/\/$/,'')}/download/${item.identifier}/${item.identifier}_archive.torrent`,size:0,source:source.name}))
}
export function parseSubDL(data:any,source:SubtitleSource,filename:string,languages:Language[]):SubtitleMatch[] {
  if (data?.status!==true||!Array.isArray(data.subtitles)) throw new Error('Could not read subtitle results.')
  const files=data.subtitles.flatMap((item:any)=> {const unpacked=list<any>(item.unpack_files).filter(file=>String(file.format).toLowerCase()==='srt');return unpacked.length?unpacked.map(file=>({...item,...file,unpack_files:undefined})):[item]})
  return files.flatMap((item:any,index:number)=>{
    const raw=String(item.language??'').toLowerCase(),language=({english:'en',vietnamese:'vi'} as Record<string,string>)[raw]??raw
    if (!languages.includes(language as Language)||typeof item.url!=='string') return []
    let url:URL;try{url=new URL(item.url,'https://dl.subdl.com')}catch{return []}
    if (url.protocol!=='https:'||url.hostname!=='dl.subdl.com'||!url.pathname.startsWith('/subtitle/')) return []
    const release=String(item.release_name??item.name??'')
    return [{id:source.id+url.pathname,fileID:index,sourceID:source.id,source:source.name,language:language as Language,release,fileName:String(item.name??release),hashMatch:false,confidence:confidence(release,filename),downloadURL:url.href}]
  })
}
export function subSourceMovie(data:any,title:string,year:string):number|null {
  const entries=subSourceEntries(data).filter(item=>[item.title,item.alternateTitle].filter(Boolean).some(name=>normalize(String(name))===normalize(title))&&(!year||String(item.releaseYear)===year))
  return entries.length===1&&Number.isSafeInteger(entries[0].movieId)?entries[0].movieId:null
}
function subSourceEntries(data:any):any[]{if(data?.success===false||!Array.isArray(data?.data))throw new Error('Could not read subtitle results.');return data.data}
export function parseSubSource(data:any,source:SubtitleSource,filename:string,languages:Language[]):SubtitleMatch[] {
  return subSourceEntries(data).flatMap(item=>{
    const raw=String(item.language??'').toLowerCase(),language=({english:'en',vietnamese:'vi'} as Record<string,string>)[raw]??raw
    if(!Number.isSafeInteger(item.subtitleId)||item.subtitleId<=0||!languages.includes(language as Language))return []
    const releases=list<string>(item.releaseInfo).map(value=>({release:String(value),score:confidence(String(value),filename)})).sort((a,b)=>b.score-a.score)
    return [{id:`${source.id}-${item.subtitleId}`,fileID:item.subtitleId,sourceID:source.id,source:source.name,language:language as Language,release:releases[0]?.release??'',fileName:releases[0]?.release??`${item.subtitleId}.srt`,hashMatch:false,confidence:releases[0]?.score??0}]
  })
}
export async function searchSubtitle(source:SubtitleSource,key:string,title:string,year:string,filename:string,languages:Language[],selection?:{season:number;episode:number}):Promise<SubtitleMatch[]> {
  if(!key)throw new Error(`Add your ${source.name} API key in Settings.`)
  if(new URL(source.endpoint).protocol!=='https:')throw new Error('Subtitle sources require HTTPS.')
  const base=source.endpoint.replace(/\/$/,'')
  if(source.kind==='subdl'){
    const params:Record<string,string>={api_key:key,film_name:title,year,type:selection?'tv':'movie',languages:languages.join(',').toUpperCase(),subs_per_page:'30',releases:'1',unpack:'1',client:'custom_integration'}
    if(selection){params.season_number=String(selection.season);params.episode_number=String(selection.episode)}
    const data=await json(endpoint(base+'/subtitles',params),{networkGroup:'subtitles'})
    if(selection&&Array.isArray(data.subtitles))data.subtitles=data.subtitles.flatMap((item:any)=>{const unpacked=list<any>(item.unpack_files);const valid=(value:any)=>{const identity=episodeIdentity(String(value.release_name??value.name??''));return identity?identity.season===selection.season&&identity.episodes.includes(selection.episode):Number(value.season)===selection.season&&Number(value.episode)===selection.episode};if(unpacked.length)return[{...item,unpack_files:unpacked.filter(valid)}].filter(item=>item.unpack_files.length);return valid(item)||item.full_season&&Number(item.season)===selection.season?[item]:[]})
    return parseSubDL(data,source,filename,languages).filter(match=>!selection||subtitleEpisodeMatch(match.release+' '+match.fileName,selection))
  }
  const headers={'X-API-Key':key,Accept:'application/json'}
  const id=subSourceMovie(await json(endpoint(base+'/movies/search',{searchType:'text',q:title}),{headers,networkGroup:'subtitles'}),title,year)
  if(id===null)return []
  const matches:SubtitleMatch[]=[]
  for(const language of languages){const name=language==='vi'?'vietnamese':'english';matches.push(...parseSubSource(await json(endpoint(base+'/subtitles',{movieId:String(id),language:name,limit:'100'}),{headers,networkGroup:'subtitles'}),source,filename,languages))}
  return [...new Map(matches.map(match=>[match.id,match])).values()].filter(match=>!selection||subtitleEpisodeMatch(match.release+' '+match.fileName,selection))
}
function subtitleEpisodeMatch(value:string,selection:{season:number;episode:number}){const identity=episodeIdentity(value);return identity?identity.season===selection.season&&identity.episodes.includes(selection.episode):seasonIdentity(value)===selection.season}
export function validateSubtitle(data:Buffer):Buffer {
  if(data.length>5_000_000)throw new Error('The subtitle is too large.')
  let text:string
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(data)}catch{text=new TextDecoder(data[0]===0xff&&data[1]===0xfe?'utf-16le':data[0]===0xfe&&data[1]===0xff?'utf-16be':'windows-1252').decode(data)}
  if(!parseSRT(text).length)throw new Error('This file is not a valid SRT subtitle.')
  return Buffer.from(text.replace(/^\uFEFF/,''),'utf8')
}
export async function subtitleArchive(data:Buffer,filename?:string):Promise<Buffer> {
  if(data[0]!==0x50||data[1]!==0x4b)return validateSubtitle(data)
  return new Promise((resolve,reject)=>yauzl.fromBuffer(data,{lazyEntries:true,autoClose:false,validateEntrySizes:true,strictFileNames:true},(error,zip)=>{
    if(error||!zip){reject(new Error('Could not open the subtitle archive.'));return}
    const candidates:yauzl.Entry[]=[]
    zip.on('error',reject)
    zip.on('entry',(entry:yauzl.Entry)=>{if(/\.srt$/i.test(entry.fileName))candidates.push(entry);zip.readEntry()})
    zip.on('end',()=>{
      if(filename){const target=episodeIdentity(filename);if(target){const multiple=candidates.length>1,matching=candidates.filter(entry=>{const item=episodeIdentity(entry.fileName);return item?item.season===target.season&&item.episodes.join(',')===target.episodes.join(','):!multiple});candidates.splice(0,candidates.length,...matching)}}
      if(candidates.length!==1){zip.close();reject(new Error('This archive contains multiple subtitles. Import the matching SRT manually.'));return}
      const entry=candidates[0]
      if(entry.uncompressedSize>5_000_000){zip.close();reject(new Error('The subtitle is too large.'));return}
      zip.openReadStream(entry,(error,stream)=>{
        if(error||!stream){zip.close();reject(error??new Error('Could not read the subtitle archive.'));return}
        const chunks:Buffer[]=[];let size=0
        stream.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>5_000_000){stream.destroy(new Error('The subtitle is too large.'));return}chunks.push(chunk)})
        stream.on('error',error=>{zip.close();reject(error)})
        stream.on('end',()=>{zip.close();try{resolve(validateSubtitle(Buffer.concat(chunks)))}catch(error){reject(error)}})
      })
    })
    zip.readEntry()
  }))
}
export async function downloadSubtitle(source:SubtitleSource,key:string,match:SubtitleMatch,filename?:string):Promise<Buffer> {
  let url:URL,headers:Record<string,string>={}
  if(source.kind==='subdl'){
    url=new URL(match.downloadURL??'')
    if(url.protocol!=='https:'||url.hostname!=='dl.subdl.com'||!url.pathname.startsWith('/subtitle/'))throw new Error('Invalid subtitle link.')
  }else{
    if(!Number.isSafeInteger(match.fileID)||match.fileID<=0)throw new Error('Invalid subtitle identifier.')
    url=endpoint(source.endpoint.replace(/\/$/,'')+`/subtitles/${match.fileID}/download`);headers={'X-API-Key':key}
  }
  return subtitleArchive(await request(url,{headers,networkGroup:'subtitles'},5_000_000),filename)
}
export async function testSource(source:TorrentSource|SubtitleSource,key:string):Promise<string>{
  if(source.kind==='subdl'){const data=await json(endpoint(source.endpoint.replace(/\/$/,'')+'/me',{api_key:key}),{networkGroup:'subtitles'});if(data.status!==true)throw new Error('Could not verify the API key.');return 'Connected successfully.'}
  if(source.kind==='subsource'){subSourceEntries(await json(endpoint(source.endpoint.replace(/\/$/,'')+'/movies/search',{searchType:'text',q:'Big Buck Bunny'}),{headers:{'X-API-Key':key},networkGroup:'subtitles'}));return 'Connected successfully.'}
  if(source.kind==='torznab'){
    const data=(await request(endpoint(source.endpoint,{t:'caps',apikey:key}),{networkGroup:'sources'})).toString('utf8')
    if(XMLValidator.validate(data)!==true||!/<caps(?:\s|>)/.test(data))throw new Error('The endpoint did not return Torznab capabilities.')
  }else await searchTorrent(source as TorrentSource,key,{id:'test',title:'Big Buck Bunny',searchTitle:'Big Buck Bunny',year:'',genre:'',overview:''})
  return 'Connected successfully.'
}
