// CPU-only metadata benchmark; no native renderer or battery claims.
import { build } from "esbuild";
import fs from "node:fs/promises";
const source = JSON.parse(await fs.readFile(process.argv[2] ?? "/private/tmp/synapse-images-review/library.json", "utf8")).images;
const compiled = await build({entryPoints:["src/lib/imageLibrary.ts"],bundle:true,write:false,platform:"node",format:"esm"});
const lib = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
const filter = {query:"",scope:"all",folder:null,format:"",sort:"modified"};
const results = [];
for (const count of [source.length,50000]) {
  const images = count === source.length ? source : Array.from({length:count},(_,i)=>({...source[i%source.length],id:`stress/${i}`,name:`Photo ${i}.png`,modifiedAt:i}));
  for (const [name,buildIndex] of [["rebuild",lib.buildImageIndex],["reuse",lib.getImageIndex]]) {
    const samples = [];
    const cpu = process.cpuUsage();
    for (let i=0;i<12;i++) {
      const begin=performance.now();
      if (lib.queryImageIndex(buildIndex(images),filter).length !== count) throw Error("Missing results");
      samples.push(performance.now()-begin);
    }
    const used = process.cpuUsage(cpu);
    results.push({count,mode:name,firstMs:samples[0],repeatMedianMs:samples.slice(1).sort((a,b)=>a-b)[5],cpuMs:(used.user+used.system)/1000});
  }
}
console.log(JSON.stringify({runtime:process.version,kind:"Node metadata helper",results},null,2));
