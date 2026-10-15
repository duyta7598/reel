import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { NetworkRouter, localTarget } from '../src/main/routing'
import { defaultNetwork } from '../src/shared/network'
import { network as validateNetwork } from '../src/main/validation'
const tmdb=new URL('https://api.themoviedb.org/3/configuration')
test('automatic routing keeps working connections direct and does not proxy invalid API keys',async()=>{
  let direct=0,proxy=0,prepared=0
  const router=new NetworkRouter(defaultNetwork(),{directFetch:async()=>{direct++;return new Response('',{status:401})},proxyFetch:async()=>{proxy++;return new Response('proxy')},prepareWarp:async()=>{prepared++}})
  try{assert.equal((await router.fetch(tmdb)).status,401);assert.equal(direct,1);assert.equal(proxy,0);assert.equal(prepared,0)}finally{await router.close()}
})
test('automatic routing falls back on network failures and remembers the working proxy per host',async()=>{
  let direct=0,proxy=0,prepared=0
  const router=new NetworkRouter(defaultNetwork(),{directFetch:async()=>{direct++;throw new TypeError('fetch failed')},proxyFetch:async()=>{proxy++;return new Response('proxy')},prepareWarp:async()=>{prepared++}})
  try{assert.equal(await(await router.fetch(tmdb)).text(),'proxy');assert.equal(await(await router.fetch(tmdb)).text(),'proxy');assert.equal(direct,1);assert.equal(proxy,2);assert.equal(prepared,2)}finally{await router.close()}
})
test('blocked responses and direct connection timeouts can use WARP but cancelled requests cannot',async()=>{
  let proxy=0
  const dependencies={proxyFetch:async()=>{proxy++;return new Response('proxy')},prepareWarp:async()=>{}}
  const blocked=new NetworkRouter(defaultNetwork(),{...dependencies,directFetch:async()=>new Response('blocked',{status:403})})
  const slow=new NetworkRouter(defaultNetwork(),{...dependencies,directTimeout:10,directFetch:async(_,options)=>new Promise((_,reject)=>options?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))})
  try{assert.equal(await(await blocked.fetch(tmdb)).text(),'proxy');assert.equal(await(await slow.fetch(tmdb)).text(),'proxy');const signal=AbortSignal.abort(new Error('cancelled'));await assert.rejects(()=>slow.fetch(tmdb,{signal}),/cancelled/);assert.equal(proxy,2)}finally{await blocked.close();await slow.close()}
})
test('private services and disabled groups stay direct even in proxy mode',async()=>{
  let direct=0,proxy=0
  const router=new NetworkRouter({...defaultNetwork(),mode:'proxy',tmdb:false},{directFetch:async()=>{direct++;return new Response('direct')},proxyFetch:async()=>{proxy++;return new Response('proxy')},prepareWarp:async()=>{}})
  try{await router.fetch(tmdb);await router.fetch(new URL('http://127.0.0.1:9117/api'),{networkGroup:'sources'});await router.fetch(new URL('http://192.168.1.20/api'),{networkGroup:'sources'});assert.equal(direct,3);assert.equal(proxy,0)}finally{await router.close()}
  for(const host of ['localhost','127.0.0.1','10.1.2.3','192.168.0.4','172.16.1.1','[::1]','[fd00::1]','[::ffff:127.0.0.1]'])assert.equal(localTarget(host),true)
  assert.equal(localTarget('api.themoviedb.org'),false);assert.equal(localTarget('[2606:4700:4700::1111]'),false)
})
test('proxy mode does not silently fall back to direct and automatic mode does not repeat POST requests',async()=>{
  let direct=0,proxy=0
  const router=new NetworkRouter({...defaultNetwork(),mode:'proxy',manageWarp:false},{directFetch:async()=>{direct++;return new Response('direct')},proxyFetch:async()=>{proxy++;throw new Error('proxy unavailable')}})
  const post=new NetworkRouter(defaultNetwork(),{directFetch:async()=>{direct++;return new Response('blocked',{status:403})},proxyFetch:async()=>{proxy++;return new Response('proxy')}})
  try{await assert.rejects(()=>router.fetch(tmdb),/proxy unavailable/);assert.equal(direct,0);assert.equal(proxy,1);assert.equal((await post.fetch(tmdb,{method:'POST'})).status,403);assert.equal(proxy,1)}finally{await router.close();await post.close()}
})
test('proxy settings allow HTTP and SOCKS5 and reject embedded secrets or non-local automatic WARP',()=>{
  assert.equal(validateNetwork(defaultNetwork()).mode,'auto')
  assert.equal(validateNetwork({...defaultNetwork(),proxyURL:'socks5://127.0.0.1:40000'}).proxyURL,'socks5://127.0.0.1:40000')
  assert.equal(validateNetwork({...defaultNetwork(),manageWarp:false,proxyURL:'https://proxy.example:8443'}).manageWarp,false)
  for(const value of [{...defaultNetwork(),proxyURL:'http://user:secret@127.0.0.1:40000'},{...defaultNetwork(),proxyURL:'http://proxy.example:40000'},{...defaultNetwork(),proxyURL:'file:///tmp/proxy'},{...defaultNetwork(),proxyURL:'http://127.0.0.1:40000/private'},{...defaultNetwork(),mode:'invalid'}])assert.throws(()=>validateNetwork(value))
})
test('proxy dispatcher sends a real HTTP request through CONNECT without using the direct route',async()=>{
  const target=http.createServer((req,res)=>{res.setHeader('Content-Type','text/plain');res.end('proxied '+req.url)})
  const sockets=new Set<Duplex>(),proxy=http.createServer()
  await new Promise<void>(resolve=>target.listen(0,'127.0.0.1',resolve))
  let connects=0
  proxy.on('connect',(req,client,head)=>{connects++;assert.equal(req.url,'remote.example:80');const upstream=net.connect((target.address() as net.AddressInfo).port,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client)});sockets.add(client);sockets.add(upstream);client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy())})
  await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve))
  const router=new NetworkRouter({...defaultNetwork(),mode:'proxy',manageWarp:false,proxyURL:`http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`},{directFetch:async()=>{throw new Error('Direct route must not be used')}})
  try{const response=await router.fetch(new URL('http://remote.example/fixture'),{networkGroup:'sources'});assert.equal(await response.text(),'proxied /fixture');assert.equal(connects,1)}finally{await router.close();for(const socket of sockets)socket.destroy();proxy.closeAllConnections();target.closeAllConnections();await Promise.all([new Promise<void>(resolve=>proxy.close(()=>resolve())),new Promise<void>(resolve=>target.close(()=>resolve()))])}
})
