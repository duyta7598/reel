import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from '../src/main/network'
test('download redirects work without forwarding credentials to another host',async()=>{
  const original=globalThis.fetch,calls:{url:string;headers:Headers}[]=[]
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),headers:new Headers(options?.headers)});return calls.length===1?new Response(null,{status:302,headers:{Location:'https://download.example/file?api_key=secret'}}):new Response('torrent')}
  try{assert.equal((await request('https://source.example/file',{headers:{'X-API-Key':'secret',Authorization:'secret'}})).toString(),'torrent');assert.equal(calls.length,2);assert.equal(calls[1].headers.has('X-API-Key'),false);assert.equal(calls[1].headers.has('Authorization'),false);assert.equal(new URL(calls[1].url).searchParams.has('api_key'),false)}finally{globalThis.fetch=original}
})
