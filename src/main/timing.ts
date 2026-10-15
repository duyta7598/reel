import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Alignment } from '../shared/types'
import { validateSubtitle } from './providers'
import { run } from './process'
export class TimingRejected extends Error {constructor(){super('Timing could not be verified. Original subtitle kept.')}}
export class Timing {
  private tail:Promise<unknown>=Promise.resolve()
  constructor(readonly tools:string,readonly root:string){}
  align(video:string,subtitle:string):Promise<Alignment>{
    const task=this.tail.then(()=>this.perform(video,subtitle));this.tail=task.catch(()=>{});return task
  }
  private async perform(video:string,subtitle:string):Promise<Alignment>{
    const scratch=path.join(this.root,'TimingWork',crypto.randomUUID());await fs.mkdir(scratch,{recursive:true})
    try{
      const exe=process.platform==='win32'?'reel-subtitle-align.exe':'reel-subtitle-align'
      const executable=path.join(this.tools,'reel-subtitle-align',exe),output=path.join(scratch,'aligned.srt'),status=path.join(scratch,'status.json')
      await fs.access(executable)
      const result=await run(executable,['--video',video,'--input',subtitle,'--output',output,'--status',status,'--ffmpeg',this.tools],{cwd:scratch})
      if(result.code!==0)throw new TimingRejected()
      const alignment:Alignment=JSON.parse(await fs.readFile(status,'utf8'))
      if(!alignment.accepted||!Number.isFinite(alignment.score)||alignment.score<0.12||!Number.isFinite(alignment.offset)||Math.abs(alignment.offset)>60||!Number.isFinite(alignment.scale)||Math.abs(alignment.scale-1)>0.05)throw new TimingRejected()
      await fs.writeFile(subtitle,validateSubtitle(await fs.readFile(output)))
      return alignment
    }finally{await fs.rm(scratch,{recursive:true,force:true})}
  }
}
