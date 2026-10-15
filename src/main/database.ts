import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { SavedState, Settings } from '../shared/types'
export function defaults():Settings{return {interfaceLanguage:'en',appearance:'system',downloadDirectory:'',quality:'1080p',languages:['vi','en'],autoSubtitles:true,autoAlignSubtitles:true,catalogRegion:'US',torrentSources:[{id:crypto.randomUUID(),name:'Internet Archive',kind:'archive',endpoint:'https://archive.org',enabled:true},{id:crypto.randomUUID(),name:'The Pirate Bay',kind:'pirateBay',endpoint:'https://apibay.org',enabled:true}],subtitleSources:[{id:crypto.randomUUID(),name:'SubDL',kind:'subdl',endpoint:'https://api.subdl.com/api/v1',enabled:true},{id:crypto.randomUUID(),name:'SubSource',kind:'subsource',endpoint:'https://api.subsource.net/api/v1',enabled:true}]}}
export class StateDatabase {
  readonly db:DatabaseSync
  constructor(readonly root:string){fs.mkdirSync(root,{recursive:true});this.db=new DatabaseSync(path.join(root,'reel-electron.sqlite'));this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL)')}
  load():SavedState|undefined{const row=this.db.prepare('SELECT data FROM state WHERE id=1').get() as {data:string}|undefined;return row?JSON.parse(row.data):undefined}
  save(state:SavedState){this.db.prepare('INSERT INTO state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(state))}
  close(){this.db.close()}
}
