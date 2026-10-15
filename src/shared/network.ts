export type NetworkMode='auto'|'direct'|'proxy'
export type NetworkGroup='tmdb'|'sources'|'subtitles'
export interface NetworkSettings { mode:NetworkMode; proxyURL:string; manageWarp:boolean; tmdb:boolean; sources:boolean; subtitles:boolean }
export interface NetworkStatus { warpInstalled:boolean; warpConnected:boolean; warpProxyMode:boolean; proxyReady:boolean; routes:{host:string;route:'direct'|'proxy'}[]; error?:string }
export const defaultNetwork=():NetworkSettings=>({mode:'auto',proxyURL:'http://127.0.0.1:40000',manageWarp:true,tmdb:true,sources:true,subtitles:true})
