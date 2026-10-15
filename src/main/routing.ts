import { ProxyAgent, Socks5ProxyAgent, fetch as proxyFetch, type Dispatcher } from 'undici'
import type { NetworkGroup, NetworkSettings, NetworkStatus } from '../shared/network'
import { defaultNetwork } from '../shared/network'
import { prepareWarp, proxyReady, warpStatus } from './warp'
export type NetworkRequestInit=RequestInit&{networkGroup?:NetworkGroup}
export function localTarget(host:string){const value=host.replace(/^\[|\]$/g,'').toLowerCase();if(value.startsWith('::ffff:'))return localTarget(value.slice(7));if(value.includes(':'))return value==='::'||value==='::1'||/^(fc|fd|fe[89ab])/i.test(value);return !value.includes('.')||value.endsWith('.localhost')||value.endsWith('.local')||/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value)}
export function networkGroup(url:URL):NetworkGroup|undefined{
  if(['api.themoviedb.org','image.tmdb.org'].includes(url.hostname))return'tmdb'
  if(['api.subdl.com','dl.subdl.com','api.subsource.net'].includes(url.hostname))return'subtitles'
  return undefined
}
export class NetworkRouter {
  private dispatcher?:Dispatcher
  private proxied=new Map<string,number>()
  private routes=new Map<string,'direct'|'proxy'>()
  constructor(readonly settings:NetworkSettings,private dependencies:{directFetch?:typeof fetch;proxyFetch?:typeof fetch;prepareWarp?:typeof prepareWarp;directTimeout?:number}={}){}
  private async throughProxy(url:URL,options:RequestInit):Promise<Response>{
    if(options.signal?.aborted)throw options.signal.reason
    if(this.settings.manageWarp)await(this.dependencies.prepareWarp??prepareWarp)(this.settings.proxyURL)
    if(options.signal?.aborted)throw options.signal.reason
    this.dispatcher??=this.settings.proxyURL.startsWith('socks5:')?new Socks5ProxyAgent(this.settings.proxyURL):new ProxyAgent({uri:this.settings.proxyURL,proxyTunnel:true})
    const init={...options,dispatcher:this.dispatcher}
    return this.dependencies.proxyFetch?this.dependencies.proxyFetch(url,init):await proxyFetch(url,init as Parameters<typeof proxyFetch>[1]) as unknown as Response
  }
  async fetch(url:URL,options:NetworkRequestInit={}):Promise<Response>{
    if(options.signal?.aborted)throw options.signal.reason
    const {networkGroup:explicit,...init}=options,group=explicit??networkGroup(url),enabled=group&&this.settings[group]&&!localTarget(url.hostname),direct=this.dependencies.directFetch??globalThis.fetch
    if(!enabled||this.settings.mode==='direct')return direct(url,init)
    const cached=(this.proxied.get(url.origin)??0)>Date.now(),proxyFirst=this.settings.mode==='proxy'||cached
    if(proxyFirst){try{const response=await this.throughProxy(url,init);this.routes.set(url.hostname,'proxy');return response}catch(error){if(this.settings.mode==='proxy'||init.signal?.aborted)throw error;this.proxied.delete(url.origin)}}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.dependencies.directTimeout??5000)
    let response:Response|undefined
    try{
      response=await direct(url,{...init,signal:init.signal?AbortSignal.any([init.signal,controller.signal]):controller.signal})
      if(![403,451,502,503,504].includes(response.status)){this.routes.set(url.hostname,'direct');return response}
    }catch(error){if(init.signal?.aborted||!['GET','HEAD'].includes((init.method??'GET').toUpperCase()))throw error}finally{clearTimeout(timer)}
    if(!['GET','HEAD'].includes((init.method??'GET').toUpperCase()))return response!
    await response?.body?.cancel()
    const proxied=await this.throughProxy(url,init);this.proxied.set(url.origin,Date.now()+600000);this.routes.set(url.hostname,'proxy');return proxied
  }
  async initialize(){if(this.settings.mode!=='direct'&&this.settings.manageWarp&&(this.settings.tmdb||this.settings.sources||this.settings.subtitles))await(this.dependencies.prepareWarp??prepareWarp)(this.settings.proxyURL)}
  async status():Promise<NetworkStatus>{return{...await warpStatus(),proxyReady:await proxyReady(this.settings.proxyURL),routes:[...this.routes].map(([host,route])=>({host,route}))}}
  async close(){await this.dispatcher?.close()}
}
let router=new NetworkRouter({...defaultNetwork(),mode:'direct'})
export function configureNetwork(value?:NetworkSettings){const previous=router;router=new NetworkRouter(value??defaultNetwork());void previous.close().catch(()=>{})}
export const routedFetch=(url:URL,options:NetworkRequestInit)=>router.fetch(url,options)
export const initializeNetwork=()=>router.initialize()
export const networkStatus=()=>router.status()
export async function testNetwork():Promise<NetworkStatus>{
  try{const response=await router.fetch(new URL('https://api.themoviedb.org/3/configuration'),{networkGroup:'tmdb',signal:AbortSignal.timeout(30000)});await response.body?.cancel();if(!response.ok&&response.status!==401)throw new Error(`TMDB returned HTTP ${response.status}.`);return router.status()}catch(error){return{...await router.status(),error:(error as Error).message}}
}
export const closeNetwork=()=>router.close()
