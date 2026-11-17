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
