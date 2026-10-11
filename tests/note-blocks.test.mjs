import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const compiled = await build({ stdin: { contents: "export * from './src/lib/noteBlockMarkdown.ts'; export * from './src/lib/noteBlockTypes.ts'; export * from './src/lib/remarkNoteBlocks.ts'; export * from './src/editor2026/importedMarkdown.ts';", resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, platform: "node", format: "esm" });
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const inline = value => typeof value === 'string' ? value : (value ?? []).map(part => part.text ?? '').join('');
const editor = {
  tryParseMarkdownToBlocks: raw => {
    const tasks = [...raw.matchAll(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/gm)];
    return tasks.length ? tasks.map(match => ({ id:crypto.randomUUID(),type:'checkListItem',props:{checked:match[1].toLowerCase()==='x'},content:match[2],children:[] })) : [{ id:crypto.randomUUID(),type:'paragraph',props:{},content:raw,children:[] }];
  },
  blocksToMarkdownLossy: blocks => blocks.map(block => block.type === 'checkListItem' ? `- [${block.props.checked?'x':' '}] ${inline(block.content)}` : inline(block.content)).join('\n\n')+'\n',
};
async function load(source) { const result = await api.loadImportedMarkdown(editor,source);return {...result,map:api.bindImportedMap(result.map,result.blocks)}; }

test('callouts become editable blocks, preserve titles, aliases and collapsed metadata, and open without rewriting source', async () => {
  const source='\uFEFF---\r\n# keep\r\ncustom: true\r\n---\r\n\r\n> [!FAQ]- **Question**\r\n> Body with [[Other|link]].\r\n\r\nAfter.\r\n';
  const {blocks,map}=await load(source);
  assert.equal(blocks[0].type,'callout');
  assert.deepEqual({...blocks[0].props},{variant:'question',calloutType:'FAQ',fold:'closed',title:'**Question**',emoji:''});
  assert.equal((await api.saveImportedMarkdown(editor,map,blocks)).source,source);
  blocks[0].props.variant='tip';blocks[0].props.calloutType='';
  assert.equal((await api.saveImportedMarkdown(editor,map,blocks)).source,source.replace('[!FAQ]','[!tip]'));
});
test('all nine statuses and an unknown marker round-trip; changing one preserves list spelling, YAML, CRLF and inline syntax',async()=>{
  const source='---\r\ncustom: {keep: true}\r\n---\r\n\r\n'+[' ','x','/','-','!','?','*','>','<','R'].map((status,index)=>`* [${status}] item ${index} **bold** [[Link]]`).join('\r\n')+'\r\n';
  const {blocks,map}=await load(source);
  assert.deepEqual(blocks.map(block=>block.props.taskStatus),[' ','x','/','-','!','?','*','>','<','R']);
  assert.equal((await api.saveImportedMarkdown(editor,map,blocks)).source,source);
  blocks[4].props.taskStatus='x';blocks[4].props.checked=true;
  assert.equal((await api.saveImportedMarkdown(editor,map,blocks)).source,source.replace('* [!] item 4','* [x] item 4'));
});
test('reader edits skip YAML, code fences, inline examples and ordinary links',()=>{
  const source='---\nitems:\n  - [ ] property\n---\n\n```md\n> [!tip] code\n- [!] code\n```\n\n`- [?] inline`\n\n> [!tip] real\n> - [/] real task\n';
  assert.deepEqual(api.noteMarkers(source).map(marker=>[marker.kind,marker.value]),[['callout','tip'],['task','/']]);
  assert.equal(api.changeNoteMarker(source,'task',0,'!'),source.replace('> - [/] real task','> - [!] real task'));
  assert.equal(api.changeNoteMarker(source,'callout',0,'warning'),source.replace('> [!tip] real','> [!warning] real'));
});
test('new rich blocks export Obsidian callouts and custom statuses without internal tokens',async()=>{
  const output=await api.blocksToNoteMarkdown(editor,[{id:'tip',type:'callout',props:{variant:'tip',title:'Title',fold:'closed'},content:'Body',children:[]},...api.TASK_STATES.map(state=>({id:state.id,type:'checkListItem',props:{taskStatus:state.marker,checked:state.marker==='x'},content:'Task',children:[]}))]);
  assert.match(output,/> \[!tip\]- Title\n> Body/);
  for(const state of api.TASK_STATES) assert(output.includes(`- [${state.marker}] Task`),state.label);
  assert(!output.includes('SYNAPSETASK'));
});
test('old pristine caches upgrade, while recovered dirty block drafts are retained',async()=>{
  const source='> [!tip] Title\n> Body\n';
  const oldBlock={id:'old',type:'sourceMarkdown',props:{markdown:source.trimEnd()},children:[]};
  const oldMap={version:1,source,prefix:'',suffix:'\n',chunks:[{ids:['old'],fingerprints:[api.importedFingerprint(oldBlock)],text:source.trimEnd(),gap:''}]};
  const upgraded=await api.loadImportedMarkdown(editor,source,JSON.stringify([oldBlock]),JSON.stringify(oldMap));
  assert.equal(upgraded.blocks[0].type,'callout');assert.equal(upgraded.cached,undefined);
  oldBlock.props.markdown='> [!tip] Draft\n> keep draft';
  const recovered=await api.loadImportedMarkdown(editor,source,JSON.stringify([oldBlock]),JSON.stringify(oldMap));
  assert.equal(recovered.cached,true);assert.match(recovered.blocks[0].props.markdown,/Draft/);
});
test('reading annotation removes only syntax markers and preserves nested callouts, links and task text',()=>{
  const source='> [!tip]+ Title\n> Body\n>\n> > [!question] Nested\n> > - [?] Ask **bold**\n\n- [x] Complete\n';
  const tree=api.parseNoteAst(source);api.remarkNoteBlocks()(tree,{value:source});
  const outer=tree.children[0];
  assert.equal(outer.data.hProperties['data-callout'],'tip');
  const task=tree.children.at(-1).children[0];
  assert.equal(task.data.hProperties['data-task-status'],'x');assert.equal(task.checked,null);
});
