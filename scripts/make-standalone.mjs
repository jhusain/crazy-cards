import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const output = new URL("../dist/", import.meta.url);
const index = new URL("index.html", output);
let page = await readFile(index, "utf8");
const javascript = page.match(/<script type="module"[^>]* src="([^"]+)"><\/script>/);
const css = page.match(/<link rel="stylesheet"[^>]* href="([^"]+)">/);
if (!javascript || !css) throw new Error("Vite did not emit the expected static assets");
const bundle = await readFile(new URL(javascript[1], output), "utf8");
const stylesheet = await readFile(new URL(css[1], output), "utf8");
page = page.replace(javascript[0], () => `<script type="module">${bundle.replaceAll(/<\/script/gi, "<\\/script")}</script>`);
page = page.replace(css[0], () => `<style>${stylesheet}</style>`);
await writeFile(index, page);
const assets = new URL("assets/", output);
for (const filename of await readdir(assets)) {
  if (filename === javascript[1].split("/").at(-1) || filename === css[1].split("/").at(-1)) {
    await rm(new URL(filename, assets));
  }
}
if ((await readdir(assets)).length) throw new Error(`Standalone HTML still has external assets in ${join(output.pathname, "assets")}`);
await rm(assets, { recursive: true });

// A versioned application shell is generated after inlining, so offline installs
// always cache the exact same bundle that was published.
const { createHash } = await import("node:crypto");
const version = createHash("sha256").update(page).digest("hex").slice(0,16);
const sw = `const CACHE="crazy-eights-${version}";
const SHELL=["./","./index.html","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png"];
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
});`;
await writeFile(new URL("sw.js",output),sw);
