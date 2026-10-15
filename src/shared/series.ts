import type { Job } from './types'
export function episodeIdentity(value:string):{season:number;episodes:number[]}|undefined{
  const match=value.match(/\bS(\d{1,3})[ ._-]*E(\d{1,4})((?:[ ._-]*E\d{1,4})+|[-–]E?\d{1,4})?/i)??value.match(/\b(\d{1,3})x(\d{1,4})\b/i)
  if(!match)return
  const episodes=[Number(match[2])],tail=match[3]??''
  if(/^[-–]/.test(tail)){const end=Number(tail.replace(/[^0-9]/g,''));if(end>=episodes[0]&&end-episodes[0]<100)for(let n=episodes[0]+1;n<=end;n++)episodes.push(n)}
  else for(const item of tail.matchAll(/E(\d+)/gi))episodes.push(Number(item[1]))
  return{season:Number(match[1]),episodes}
}
export function seasonIdentity(value:string):number|undefined{const identity=episodeIdentity(value);if(identity)return identity.season;const number=value.match(/\bS(\d{1,3})\b|\bSeason[ ._-]*(\d{1,3})\b/i)?.slice(1).find(Boolean);return number===undefined?undefined:Number(number)}
export const episodeCode=(season:number,episode?:number)=>`S${String(season).padStart(2,'0')}${episode===undefined?'':`E${String(episode).padStart(2,'0')}`}`
export const playableJobs=(jobs:Job[])=>jobs.flatMap(job=>job.mediaType==='tv'?(job.episodes??[]):[job])
export const findJob=(jobs:Job[],id:string)=>jobs.find(job=>job.id===id)??jobs.flatMap(job=>job.episodes??[]).find(job=>job.id===id)
