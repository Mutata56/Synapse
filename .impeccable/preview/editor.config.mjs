import {defineConfig,mergeConfig} from 'vite';
import base from '../../vite.config.ts';
import fs from 'node:fs/promises';import {realpathSync,createReadStream} from 'node:fs';import path from 'node:path';
const fixture='/private/tmp/synapse-imported-editor-review';
const bounded=p=>{const absolute=path.isAbsolute(p)?path.resolve(p):path.resolve(fixture,p);if(!absolute.startsWith(fixture+path.sep))throw Error('Escaped fixture');return absolute;};
const operations=[];
export default defineConfig(async()=>mergeConfig(await base({}),{
 resolve:{alias:Object.fromEntries([['@tauri-apps/plugin-fs','editor-fs.ts'],['@tauri-apps/api/core','editor-core.ts'],['@tauri-apps/api/path','editor-path.ts'],['@tauri-apps/plugin-opener','editor-opener.ts']].map(([key,file])=>[key,path.resolve('.impeccable/preview',file)]))},
 server:{port:1436,host:'127.0.0.1',strictPort:true,fs:{allow:[process.cwd(),realpathSync('node_modules')]}},
 plugins:[{name:'copy-only-editor-fixture',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  if(!req.url?.startsWith('/__editor-'))return next();
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/__editor-asset'){const file=bounded(url.searchParams.get('path'));res.setHeader('Content-Type',file.endsWith('.svg')?'image/svg+xml':'image/png');return createReadStream(file).pipe(res);}
   res.setHeader('Content-Type','application/json');
   if(url.pathname==='/__editor-operations')return res.end(JSON.stringify(operations));
   if(url.pathname==='/__editor-source')return res.end(JSON.stringify(await fs.readFile(bounded('notes/'+url.searchParams.get('id')+'.md'),'utf8')));
   if(url.pathname==='/__editor-fs'){
    let body='';for await(const chunk of req)body+=chunk;
    const {name,args:a}=JSON.parse(body);const p=bounded(a[0]);let value=null;
    if(['writeTextFile','writeFile','rename','remove','mkdir','copyFile'].includes(name))operations.push({name,path:a[0]});
    switch(name){
     case 'exists':try{await fs.access(p);value=true;}catch{value=false;}break;
     case 'mkdir':await fs.mkdir(p,{recursive:Boolean(a[1]?.recursive)});break;
     case 'readDir':value=(await fs.readdir(p,{withFileTypes:true})).map(e=>({name:e.name,isDirectory:e.isDirectory(),isFile:e.isFile(),isSymlink:e.isSymbolicLink()}));break;
     case 'readTextFile':value=await fs.readFile(p,'utf8');break;
     case 'readFile':value=Array.from(await fs.readFile(p));break;
     case 'stat':{const s=await fs.stat(p);value={size:s.size,mtime:s.mtime,birthtime:s.birthtime};break;}
     case 'writeTextFile':await fs.writeFile(p,a[1]);break;
     case 'writeFile':await fs.writeFile(p,Uint8Array.from(a[1]));break;
     case 'rename':await fs.rename(p,bounded(a[1]));break;
     case 'remove':await fs.rm(p,{recursive:Boolean(a[1]?.recursive),force:true});break;
     case 'copyFile':await fs.copyFile(p,bounded(a[1]));break;
     default:throw Error('Unknown FS '+name);
    }
    return res.end(JSON.stringify(value));
   }
   next();
  }catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}
 });}}]
}));
