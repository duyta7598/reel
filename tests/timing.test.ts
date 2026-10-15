import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Timing } from '../src/main/timing'
import { parseSRT } from '../src/shared/matching'
const fixtures=path.resolve(import.meta.dirname,'../../Tests/Fixtures'),tools=path.resolve(import.meta.dirname,'../../Vendor/SubtitleTools')
function shifted(cues:ReturnType<typeof parseSRT>,offset:number){const stamp=(seconds:number)=>{const ms=Math.round(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`};return cues.map((cue,index)=>`${index+1}\n${stamp(cue.start+offset)} --> ${stamp(cue.end+offset)}\n${cue.text}\n`).join('\n')}
test('Electron timing uses the bundled tool to fix actual speech audio',{timeout:20_000,skip:process.platform!=='darwin'},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'reel-timing-'))
  try{const cues=parseSRT(await fs.readFile(path.join(fixtures,'TimingSpeech.srt'),'utf8')),input=path.join(root,'input.srt');await fs.writeFile(input,shifted(cues,2));const result=await new Timing(tools,root).align(path.join(fixtures,'TimingSpeech.flac'),input);assert.equal(result.accepted,true);assert.ok(Math.abs(result.offset+2)<0.2);assert.ok(result.score>0.5);const output=parseSRT(await fs.readFile(input,'utf8'));assert.ok(Math.abs(output[0].start-cues[0].start)<0.2)}finally{await fs.rm(root,{recursive:true,force:true})}
})
