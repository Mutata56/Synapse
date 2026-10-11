import { defineConfig, mergeConfig } from 'vite';
import base from '../../vite.config.ts';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
const root='/private/tmp/synapse-images-review';
const stats={previews:0,originals:0};
export default defineConfig(async()=>mergeConfig(await base({}),{
 server:{port:1424,host:'127.0.0.1',strictPort:true},
 plugins:[{name:'read-only-image-review',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(!req.url?.startsWith('/__images-'))return next();
  try{
   const url=new URL(req.url,'http://127.0.0.1');
   res.setHeader('Cache-Control','no-cache');
   if(url.pathname==='/__images-stats'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(stats));}
   const library=JSON.parse(await fs.readFile(path.join(root,'library.json'),'utf8'));
   if(url.pathname==='/__images-library'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(library));}
   const previews=JSON.parse(await fs.readFile(path.join(root,'preview-map.json'),'utf8'));
   if(url.pathname==='/__images-preview-map'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(previews));}
   const id=url.searchParams.get('id'); if(!library.images.some(image=>image.id===id)){res.statusCode=404;return res.end();}
   const original=path.resolve(root,'notes',id);
   if(!original.startsWith(path.join(root,'notes')+path.sep))throw Error('Invalid image path');
   const preview=url.pathname==='/__images-preview';
   const file=preview?previews[id]?.path:original;
   if(!file||(!file.startsWith(path.join(root,'previews')+path.sep)&&file!==original)){res.statusCode=404;return res.end();}
   if(preview)stats.previews++;else stats.originals++;
   const extension=path.extname(file).toLowerCase();
   res.setHeader('Content-Type',({'.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.gif':'image/gif'})[extension]||'application/octet-stream');
   const stream=createReadStream(file);stream.on('error',()=>{res.statusCode=404;res.end();});stream.pipe(res);
  }catch{res.statusCode=500;res.end();}
 });}}]
}));
