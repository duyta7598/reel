import test from 'node:test'
import assert from 'node:assert/strict'
import { MediaServer, posterURL } from '../src/main/media'
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')
test('TMDB posters use an authorized local relay with caching and reject arbitrary remote URLs',async()=>{
  const original=globalThis.fetch,media=new MediaServer({job:()=>{throw new Error('Poster must not access the library')}} as any,''),target='https://image.tmdb.org/t/p/w500/fixture.png';let requests=0
  globalThis.fetch=async input=>{requests++;assert.equal(String(input),target);return new Response(png)}
  await media.start()
  try{
    const url=media.poster(target),first=await original(url);assert.equal(first.status,200);assert.equal(first.headers.get('Content-Type'),'image/png');assert.deepEqual(Buffer.from(await first.arrayBuffer()),png)
    const second=await original(url);await second.arrayBuffer();assert.equal(requests,1)
    const denied=new URL(url);denied.searchParams.delete('token');assert.equal((await original(denied)).status,403)
    const forged=new URL(url);forged.searchParams.set('url','http://127.0.0.1/private');assert.equal((await original(forged)).status,404);assert.equal(requests,1)
    assert.throws(()=>posterURL('https://other.example/t/p/w500/fixture.png'))
    assert.throws(()=>posterURL('https://image.tmdb.org/not-an-image'))
  }finally{globalThis.fetch=original;await media.close()}
})
