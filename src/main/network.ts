import { routedFetch, type NetworkRequestInit } from './routing'
const activeRequests=new Set<AbortController>()
export function abortRequests(){for(const controller of activeRequests)controller.abort();activeRequests.clear()}
export function endpoint(base: string, params: Record<string, string | undefined> = {}): URL {
  const url = new URL(base)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS endpoint.')
  for (const [key,value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(key,value)
  return url
}
export async function request(url: string | URL, options: NetworkRequestInit = {}, maxBytes = 16_000_000): Promise<Buffer> {
  const controller = new AbortController(); activeRequests.add(controller); let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, 30_000)
  try {
    let target=new URL(url),headers=new Headers(options.headers),response:Response
    headers.set('User-Agent','Reel/0.2')
    for(let redirects=0;;redirects++){
      response=await routedFetch(target,{...options,headers,redirect:'manual',signal:controller.signal})
      if(![301,302,303,307,308].includes(response.status))break
      const location=response.headers.get('location');await response.body?.cancel()
      if(!location||redirects>=5)throw new Error('The source returned too many redirects.')
      const next=new URL(location,target)
      if(!['https:','http:'].includes(next.protocol)||target.protocol==='https:'&&next.protocol!=='https:')throw new Error('The source returned an unsafe redirect.')
      if(next.origin!==target.origin){for(const key of ['Authorization','X-API-Key','Cookie'])headers.delete(key);for(const key of ['apikey','api_key','access_token'])next.searchParams.delete(key)}
      target=next
    }
    if (!response.ok) throw new Error(`The source returned HTTP ${response.status}. Check your connection or API key.`)
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new Error('The response is too large.')
    const chunks: Uint8Array[] = []
    let length = 0
    for await (const chunk of response.body ?? []) {
      length += chunk.length
      if (length > maxBytes) { controller.abort(); throw new Error('The response is too large.') }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  } catch (error) {
    if (timedOut) throw new Error('The connection timed out. Please try again.')
    throw error
  } finally { clearTimeout(timer); activeRequests.delete(controller) }
}
export async function json(url: string | URL, options?: NetworkRequestInit): Promise<any> { return JSON.parse((await request(url, options)).toString('utf8')) }
