import { parse } from 'node-html-parser'
import type { Release, TorrentSource } from '../shared/types'
import { request } from './network'
const blocked='1337x blocked the request. Try another endpoint or configure 1337x through Torznab.'
async function html(url:URL){
  try{const text=(await request(url,{headers:{Accept:'text/html'},networkGroup:'sources'},4_000_000)).toString('utf8');if(/cf-chl-|challenge-platform|verify you are human|just a moment/i.test(text))throw new Error(blocked);return text}catch(error){if(/HTTP (403|429|503)/.test((error as Error).message))throw new Error(blocked);throw error}
}
function detailsURL(value:string,source:TorrentSource){
  const base=new URL(source.endpoint),url=new URL(value,base)
  if(url.origin!==base.origin||url.username||url.password||!/^\/torrent\/\d+\/[^?#]+\/?$/.test(url.pathname))throw new Error('Invalid 1337x torrent page.')
  url.search='';url.hash='';return url
}
export function parse1337x(text:string,source:TorrentSource,tv:boolean):Release[]{
  if(/cf-chl-|challenge-platform|verify you are human|just a moment/i.test(text))throw new Error(blocked)
  const document=parse(text),table=document.querySelector('.table-list')
  if(!table){if(/no (?:results|torrents)(?: were returned| found)?/i.test(document.text))return [];throw new Error('Could not read 1337x results. Check the source endpoint.')}
  const seen=new Set<string>(),categories=tv?[5,6,7,41,71,74,75,9,28,78,79,80,81]:[1,2,3,4,42,54,55,66,70,73,76]
  return table.querySelectorAll('tr').flatMap(row=>{
    const link=row.querySelector('td[class*="coll-1"] a[href*="/torrent/"]');if(!link)return []
    let url:URL;try{url=detailsURL(link.getAttribute('href')??'',source)}catch{return []}
    const category=row.querySelector('a[href^="/sub/"]')?.getAttribute('href')?.match(/^\/sub\/(\d+)/)?.[1]
    if(category&&!categories.includes(Number(category)))return []
    const id=url.pathname.match(/^\/torrent\/(\d+)/)![1];if(seen.has(id))return [];seen.add(id)
    let title=(link.getAttribute('title')||link.text).trim();if(title.endsWith('...')){try{title=decodeURIComponent(url.pathname.split('/')[3]).replace(/-/g,' ')}catch{}}
    if(!title)return []
    const size=row.querySelector('td[class*="coll-4"]')?.text.match(/([\d,.]+)\s*([KMGT]?i?B)/i),units:Record<string,number>={B:1,KB:1024,KIB:1024,MB:1024**2,MIB:1024**2,GB:1024**3,GIB:1024**3,TB:1024**4,TIB:1024**4}
    const seeds=row.querySelector('td[class*="coll-2"]')?.text.trim().replace(/,/g,'')
    return[{id:source.id+'-'+id,title,uri:url.href,size:size?Number(size[1].replace(/,/g,''))*(units[size[2].toUpperCase()]??1):0,seeds:seeds&&/^\d+$/.test(seeds)?Number(seeds):undefined,source:source.name,sourceID:source.id}]
  })
}
export async function search1337x(source:TorrentSource,query:string,tv:boolean){
  const url=new URL(`/search/${encodeURIComponent(query.trim())}/1/`,source.endpoint)
  return parse1337x(await html(url),source,tv)
}
export async function resolve1337x(value:string,source:TorrentSource):Promise<string>{
  const document=parse(await html(detailsURL(value,source)))
  for(const link of document.querySelectorAll('a[href^="magnet:"]')){
    const uri=link.getAttribute('href')??''
    try{const url=new URL(uri);if(url.searchParams.getAll('xt').some(value=>/^urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(value)||/^urn:btmh:1220[a-f0-9]{64}$/i.test(value)))return uri}catch{}
  }
  throw new Error('1337x did not provide a magnet link. The site may require browser verification.')
}
