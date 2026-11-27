import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const root=new URL('../dist/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.webmanifest',root),'utf8'));
assert.equal(manifest.display,'standalone');
const monochrome=manifest.icons.find(icon=>icon.purpose.split(' ').includes('monochrome'));
assert(monochrome, 'Provide a monochrome icon for themed launchers');
const monochromePng=await readFile(new URL(monochrome.src,root));
assert.equal(monochromePng[25],6,'Monochrome PNG must have an alpha channel');
for(const icon of manifest.icons)assert((await readFile(new URL(icon.src,root))).length>100);
const html=await readFile(new URL('index.html',root),'utf8');
assert(html.includes('manifest.webmanifest'));
const sw=await readFile(new URL('sw.js',root),'utf8');
const base='https://game.test/crazy-cards/';
const key=value=>new URL(typeof value==='string'?value:value.url,base).href;

function fixture(){
 const handlers={}, stores=new Map(), timers=new Map();
 const writes=[], requests=[];
 let mode='online', cacheFails=false, nextTimer=0;
 const cache={
  put:async(k,v)=>{if(cacheFails)throw new Error('Storage full');stores.set(key(k),v);writes.push(key(k));},
  match:async k=>stores.get(key(k))?.clone(),
 };
 const self={location:{href:base+'sw.js',origin:new URL(base).origin},
  addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}};
 const fetch=async(value,options={})=>{
  requests.push({url:key(value),options});
  if(mode==='offline')throw new Error('Offline');
  if(mode==='error')return new Response('Server error',{status:503});
  if(mode==='invalid')return new Response('<html>Maintenance</html>');
  if(mode==='hanging')return new Promise((resolve,reject)=>options.signal?.addEventListener('abort',()=>reject(new Error('Aborted'))));
  if(mode==='body-hanging')return new Response(new ReadableStream({start(controller){
   options.signal?.addEventListener('abort',()=>controller.error(new Error('Aborted')));
  }}));
  if(mode==='updated')return new Response('<!doctype html><div id="board">Updated game</div>');
  const url=new URL(key(value));
  const name=url.pathname===new URL(base).pathname?'index.html':url.pathname.slice(new URL(base).pathname.length);
  return new Response(await readFile(new URL(name,root)));
 };
 runInNewContext(sw,{self,fetch,URL,Response,AbortController,
  setTimeout:(fn,ms)=>{assert.equal(ms,3000);timers.set(++nextTimer,fn);return nextTimer;},
  clearTimeout:id=>timers.delete(id),
  caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true}});
 async function install(){let pending;handlers.install({waitUntil:p=>pending=p});await pending;}
 function navigate(path='',method='GET'){
  let response;const background=[];
  handlers.fetch({request:{method,url:base+path,mode:'navigate'},
   respondWith:p=>response=p,waitUntil:p=>background.push(p)});
  return {response,background};
 }
 return {stores,timers,writes,requests,install,navigate,
  setMode:value=>{mode=value;},failWrites:()=>{cacheFails=true;},
  timeout:()=>{for(const fn of [...timers.values()])fn();}};
}

const app=fixture();await app.install();
assert.equal(app.stores.size,3+manifest.icons.length);
for(const mode of ['offline','error','invalid','hanging','body-hanging']){
 app.setMode(mode);
 const navigation=app.navigate('?fresh-link=1#network=playroom');
 if(mode.includes('hanging')){
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.timers.size,1);
  app.timeout();
 }
 assert.equal(await (await navigation.response).text(),html,mode+' should use the complete saved game');
 await Promise.all(navigation.background);
 assert.equal(app.timers.size,0,'Navigation must clean up its deadline');
}
app.setMode('updated');
let navigation=app.navigate('index.html');
assert((await (await navigation.response).text()).includes('Updated game'));
await Promise.all(navigation.background);
assert((await app.stores.get(base+'index.html').clone().text()).includes('Updated game'));
assert.equal(app.requests.at(-1).options.cache,'no-cache','Online launches revalidate the HTTP cache');
app.setMode('offline');navigation=app.navigate();
assert((await (await navigation.response).text()).includes('Updated game'),'The update must work offline on the next launch');
await Promise.all(navigation.background);

app.setMode('updated');app.failWrites();navigation=app.navigate();
assert.equal((await navigation.response).status,200,'A cache write failure must not break an online launch');
await Promise.all(navigation.background);
assert.equal(app.navigate('signin-with-chatgpt').response,undefined,'Do not intercept authentication');
assert.equal(app.navigate('../other-app/').response,undefined,'Do not intercept other applications');
assert.equal(app.navigate('', 'POST').response,undefined);

const empty=fixture();empty.setMode('hanging');navigation=empty.navigate();empty.timeout();
assert.equal((await navigation.response).status,503);
await Promise.all(navigation.background);
empty.setMode('offline');navigation=empty.navigate();
assert((await (await navigation.response).text()).includes('Retry'));
await Promise.all(navigation.background);
console.log('PWA manifest, full offline shell, stalled headers/body deadline, HTTP/invalid-page fallback, online updates, storage failure, retry page and scope isolation passed');
