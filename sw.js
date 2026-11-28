const CACHE="crazy-eights-8ca9c5554c09c523";
const SHELL=["./","./index.html","./manifest.webmanifest","./icons/brand-192.png","./icons/brand-512.png","./icons/brand-monochrome.png"];
const NAVIGATION_TIMEOUT_MS=3000;
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
  if(event.request.mode==="navigate"){
    const controller=new AbortController();
    let timer;
    // Include the body download in the deadline: headers alone cannot start the game.
    const timeout=new Promise(resolve=>{timer=setTimeout(()=>{
      controller.abort();resolve(undefined);
    },NAVIGATION_TIMEOUT_MS);});
    const network=(async()=>{
      const response=await fetch(event.request,{cache:"no-cache",signal:controller.signal});
      if(!response.ok||!(await response.clone().text()).includes('id="board"'))return;
      return response;
    })().catch(()=>undefined).finally(()=>clearTimeout(timer));
    const fresh=Promise.race([network,timeout]);
    // Cache writes must not hold up rendering or turn a good response into an error.
    event.waitUntil(fresh.then(async response=>{
      if(response){const copy=response.clone();const cache=await caches.open(CACHE);await cache.put("./index.html",copy);}
    }).catch(()=>{}));
    event.respondWith((async()=>{
      const response=await fresh;if(response)return response;
      try{const cache=await caches.open(CACHE);const saved=await cache.match("./index.html");if(saved)return saved;}catch{}
      return new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Crazy Eights</title><h1>Could not load Crazy Eights</h1><p>Connect to the internet and reload to save the game for offline play.</p><button onclick="location.reload()">Retry</button>',{status:503,headers:{"Content-Type":"text/html; charset=utf-8"}});
    })());
    return;
  }
  event.respondWith((async()=>{const cache=await caches.open(CACHE);
    return (await cache.match(event.request))||fetch(event.request);
  })());
});