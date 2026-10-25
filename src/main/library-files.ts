import fs from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Job } from '../shared/types'
const inside=(base:string,file:string)=>{const relative=path.relative(base,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)}
function candidates(job:Job){
  const base=path.resolve(job.directory),videos=new Set([job.videoPath,...(job.episodes??[]).map(item=>item.videoPath),...(job.engine?.videos??[]).map(item=>item.path)].filter(Boolean))
  return [...videos].flatMap(video=>{
    const file=path.resolve(base,video)
    if(!inside(base,file))throw new Error('Cannot delete files outside this movie folder.')
    const stem=path.join(path.dirname(file),path.parse(file).name)
    return[file,...['vi','en'].flatMap(language=>[stem+'.'+language+'.srt',stem+'.'+language+'.original.srt'])]
  })
}
export async function movieFiles(job:Job,jobs:Job[]){
  const paths=[...new Set(candidates(job))],base=await fs.realpath(job.directory).catch(error=>{if(error.code==='ENOENT')return undefined;throw error})
  if(!base)return[]
  const result:string[]=[],shared=new Set<string>()
  for(const other of jobs.filter(item=>item.id!==job.id))for(const file of candidates(other))try{shared.add(await fs.realpath(file))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  for(const file of paths){
    let real:string
    try{real=await fs.realpath(file)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error}
    if(!inside(base,real))throw new Error('Cannot delete files outside this movie folder.')
    if(shared.has(real))throw new Error('These files are also used by another library item.')
    if(!(await fs.lstat(file)).isFile())throw new Error('Cannot delete a folder or symbolic link as a movie file.')
    result.push(file)
  }
  return result
}
export async function deleteMovieFiles(files:string[]){
  for(const file of files)for(let attempt=0;;attempt++)try{await fs.unlink(file);break}catch(error){const code=(error as NodeJS.ErrnoException).code;if(code==='ENOENT')break;if(!['EBUSY','EPERM','EACCES'].includes(code??'')||attempt>=20)throw new Error('Could not delete movie files. Close apps using them, check folder permissions and try again.');await delay(100)}
}
