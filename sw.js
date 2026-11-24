const CACHE="crazy-eights-beb811d50e67ce30";
const SHELL=["./","./index.html","./manifest.webmanifest","./icons/brand-192.png","./icons/brand-512.png","./icons/brand-monochrome.png"];
self.addEventListener("install",event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  for(const path of SHELL){const response=await fetch(path,{cache:"reload"});
    if(!response.ok)throw new Error("Offline shell unavailable");
    if(path==="./"||path==="./index.html"){
      const html=await response.clone().text();if(!html.includes('id="board"'))throw new Error("Sign in before installing offline");
    }await cache.put(path,response);
  }await self.skipWaiting();})()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith("crazy-eights-")&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();})()));
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET"||new URL(event.request.url).origin!==self.location.origin)return;
  const url=new URL(event.request.url), scope=new URL("./",self.location.href);
  if(event.request.mode==="navigate"&&url.pathname!==scope.pathname&&url.pathname!==scope.pathname+"index.html")return;
  event.respondWith((async()=>{const cache=await caches.open(CACHE);
    if(event.request.mode==="navigate"){
      try{const response=await fetch(event.request);if(response.ok&&(await response.clone().text()).includes('id="board"'))await cache.put("./index.html",response.clone());return response;}
      catch{return (await cache.match("./index.html"))||Response.error();}
    }return (await cache.match(event.request))||fetch(event.request);
  })());
});