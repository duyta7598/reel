export interface TransferFile { kind: string; name: string; size: number; version: string; md5?: string }
export interface TransferItem { id: string; title: string; year: string; mediaType: 'movie'|'tv'; season?: number; episode?: number; files: TransferFile[] }
export interface TransferDevice { id: string; name: string; createdAt: number }
export interface TransferStatus { running: boolean; addresses: string[]; devices: TransferDevice[]; pairing?: { code: string; expiresAt: number } }
export interface TransferPair { token: string; deviceID: string; computer: string }
export function localServer(value:string){
  const url=new URL(value),host=url.hostname
  const privateIP=/^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(host)||/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)||host==='127.0.0.1'
  if(url.protocol!=='http:'||!privateIP||host.split('.').some(part=>Number(part)>255)||!url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Chỉ hỗ trợ địa chỉ IP trong mạng Wi-Fi nội bộ.')
  return url.origin
}
export function readPairing(value:string){const url=new URL(value.trim());if(url.protocol!=='reel-mobile:'||url.hostname!=='pair')throw new Error('Mã ghép nối Reel không hợp lệ.');const baseURL=localServer(url.searchParams.get('url')??''),code=url.searchParams.get('code')??'';if(!/^[a-f0-9]{48}$/.test(code))throw new Error('Mã ghép nối Reel không hợp lệ.');return{baseURL,code}}
