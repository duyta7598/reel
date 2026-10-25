import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite'
import * as FS from 'expo-file-system/legacy'
import { Platform } from 'react-native'
let pending:Promise<SQLiteDatabase>|undefined
function database(){
  if(!pending)pending=(async()=>{
    const directory=Platform.OS==='ios'?new URL('../Library/Application%20Support/Reel/',FS.documentDirectory!).href:undefined
    if(directory)await FS.makeDirectoryAsync(directory,{intermediates:true})
    const db=await openDatabaseAsync('ReelMobile.db',{},directory)
    await db.execAsync('CREATE TABLE IF NOT EXISTS storage (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)')
    return db
  })().catch(error=>{pending=undefined;throw error})
  return pending
}
export default {
  async getItemAsync(key:string){return(await(await database()).getFirstAsync<{value:string}>('SELECT value FROM storage WHERE key = ?',key))?.value??null},
  async setItemAsync(key:string,value:string){await(await database()).runAsync('INSERT INTO storage(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,value)},
  async removeItemAsync(key:string){await(await database()).runAsync('DELETE FROM storage WHERE key = ?',key)}
}
