#!/usr/bin/env node
// Copies what the viewer reads into next/data, so the folder works on its own (published as-is,
// or opened from disk): every file is a classic script that sets one global.
//
//   node lab/next/tools/sync-data.mjs      (from MyAtlas-lab, or anywhere)
//
// data/atlas.js        window.ATLAS          ← lab/data/atlas.js (python3 lab/export.py writes it)
// data/code.js         window.ATLAS_CODE     ← lab/data/code.js
// data/sources.js      window.ATLAS_SRC      ← lab/data/src/<path> for every file code.json lists
// data/trace-full.js   window.TRACE_FULL     ← lab/trace-timeline/data/trace-full.js (the whole record,
//                                              exits and irets kept; node lab/trace-timeline/tools/build-trace.mjs)
// data/metro-layout.js window.METRO_LAYOUT   ← lab/metro/layout.data.js (node lab/metro/tools/precompute.mjs --warm)
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const NEXT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const LAB = resolve(NEXT, "..");
const out = (name) => join(NEXT, "data", name);

copyFileSync(join(LAB, "data/atlas.js"), out("atlas.js"));
copyFileSync(join(LAB, "data/code.js"), out("code.js"));

const code = JSON.parse(readFileSync(join(LAB, "data/code.json"), "utf8"));
const src = {};
for (const path of Object.keys(code.files).sort()) {
  const f = join(LAB, "data/src", path);
  if (existsSync(f)) src[path] = readFileSync(f, "utf8");
  else console.warn("missing source:", path);
}
writeFileSync(out("sources.js"), "// Written by tools/sync-data.mjs from lab/data/src. Do not edit.\nwindow.ATLAS_SRC = " + JSON.stringify(src).replace(/<\//g, "<\\/") + ";\n");

copyFileSync(join(LAB, "trace-timeline/data/trace-full.js"), out("trace-full.js"));
copyFileSync(join(LAB, "metro/layout.data.js"), out("metro-layout.js"));
console.log("data synced:", Object.keys(src).length, "source files");
