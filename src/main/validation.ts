import type { Settings, TorrentSource, SubtitleSource } from '../shared/types'
export function text(value:unknown,max=2000):string{if(typeof value!=='string'||value.length>max)throw new Error('Invalid input.');return value}
export function id(value:unknown):string{const output=text(value,150);if(!/^[a-zA-Z0-9_.-]+$/.test(output))throw new Error('Invalid identifier.');return output}
export function language(value:unknown):'en'|'vi'{if(value!=='en'&&value!=='vi')throw new Error('Unsupported subtitle language.');return value}
export function source(value:any):TorrentSource|SubtitleSource{
  if(!value||!['archive','pirateBay','torznab','subdl','subsource'].includes(value.kind))throw new Error('Unsupported source connector.')
  id(value.id);text(value.name,150);const url=new URL(text(value.endpoint,3000));if(!['https:','http:'].includes(url.protocol))throw new Error('Use an HTTP or HTTPS endpoint.');if(['subdl','subsource'].includes(value.kind)&&url.protocol!=='https:')throw new Error('Subtitle sources require HTTPS.');if(typeof value.enabled!=='boolean')throw new Error('Invalid source settings.');return{id:value.id,name:value.name,kind:value.kind,endpoint:url.href.replace(/\/$/,''),enabled:value.enabled}
}
export function settings(value:any):Partial<Settings>{
  if(!value||typeof value!=='object')throw new Error('Invalid settings.')
  const output:Partial<Settings>={}
  if(value.interfaceLanguage!==undefined)output.interfaceLanguage=language(value.interfaceLanguage)
  if(value.appearance!==undefined){if(!['system','light','dark'].includes(value.appearance))throw new Error('Invalid theme.');output.appearance=value.appearance}
  if(value.downloadDirectory!==undefined)output.downloadDirectory=text(value.downloadDirectory,4000)
  if(value.quality!==undefined){if(!['720p','1080p','2160p'].includes(value.quality))throw new Error('Invalid quality.');output.quality=value.quality}
  if(value.languages!==undefined){if(!Array.isArray(value.languages)||value.languages.length>2)throw new Error('Invalid subtitle languages.');output.languages=[...new Set<'en'|'vi'>(value.languages.map((item:unknown)=>language(item)))]}
  for(const key of ['autoSubtitles','autoAlignSubtitles'] as const)if(value[key]!==undefined){if(typeof value[key]!=='boolean')throw new Error('Invalid settings.');output[key]=value[key]}
  if(value.catalogRegion!==undefined){if(!/^[A-Z]{2}$/.test(value.catalogRegion))throw new Error('Invalid region.');output.catalogRegion=value.catalogRegion}
  for(const key of ['subtitleSources','torrentSources'] as const)if(value[key]!==undefined){if(!Array.isArray(value[key])||value[key].length>50)throw new Error('Too many sources.');const sources=value[key].map(source);if(sources.some((item:TorrentSource|SubtitleSource)=>key==='subtitleSources'?!['subdl','subsource'].includes(item.kind):!['archive','pirateBay','torznab'].includes(item.kind)))throw new Error('Invalid source type.');(output as any)[key]=sources}
  return output
}
