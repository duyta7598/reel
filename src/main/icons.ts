import { nativeImage } from 'electron'
import path from 'node:path'
export function trayImage(root:string,platform=process.platform){
  const icon=nativeImage.createFromPath(path.join(root,'assets',platform==='win32'?'icon.ico':'icon.png'))
  if(icon.isEmpty())throw new Error('The Reel tray icon is unavailable.')
  return platform==='darwin'?icon.resize({width:18,height:18,quality:'best'}):icon
}
