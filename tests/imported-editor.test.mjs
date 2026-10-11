import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const compiled = await build({ entryPoints: [new URL('../src/editor2026/importedMarkdown.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm' });
const { loadImportedMarkdown, bindImportedMap, saveImportedMarkdown, decodeImportedMap } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
function editor() { return {
  tryParseMarkdownToBlocks: text => [{ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: text, children: [] }],
  blocksToMarkdownLossy: blocks => blocks.map(b => b.type === 'dataTable' ? '| A | B |\n| - | - |\n| 1 | 2 |' : b.content).join('\n\n') + '\n',
}; }
async function loaded(source) { const ed = editor(); const parsed = await loadImportedMarkdown(ed, source); return { ed, ...parsed, map: bindImportedMap(parsed.map, parsed.blocks) }; }
test('opening and unchanged saves retain exact BOM, commented YAML, CRLF, whitespace and every source construct', async () => {
  const source = '\uFEFF---\r\n# keep comment\r\ncustom: {a: 1}\r\n---\r\n\r\n# Heading\r\n\r\n#WMS #Коломна\r\n\r\nSee [[Other#Heading|Alias]].\r\n\r\n> [!info] Callout\r\n> text\r\n\r\n![[diagram.svg|300]]\r\n\r\n```mermaid\r\ngraph LR; A-->B\r\n```\r\n\r\n<div>html</div>\r\n';
  const {ed,blocks,map}=await loaded(source);
  assert.equal((await saveImportedMarkdown(ed,map,blocks)).source,source);
  assert.equal(decodeImportedMap(JSON.stringify(map)).source,source);
  assert.equal(blocks.filter(b=>b.type==='sourceMarkdown').length,3);
  assert.equal(blocks.find(b=>b.type==='callout').props.variant,'info');
});
test('editing one paragraph changes only that chunk and preserves unsupported Markdown and YAML', async () => {
  const source='---\ncustom: true # keep\n---\n\n# Heading\n\nOriginal paragraph.\n\n> [!tip] untouched\n> [[Target|label]]\n\n[^a]: a footnote\n';
  const {ed,blocks,map}=await loaded(source);
  blocks[1].content='Edited paragraph.';
  const result=await saveImportedMarkdown(ed,map,blocks);
  assert.equal(result.source,source.replace('Original paragraph.','Edited paragraph.'));
  assert.equal(decodeImportedMap(JSON.stringify(result.map)).source,result.source);
  assert.equal((await saveImportedMarkdown(ed,result.map,blocks)).source,result.source);
});
test('adding a rich table preserves its IDs and model when reopening alongside original source', async () => {
  const {ed,blocks,map}=await loaded('# Heading\n\nOriginal.\n');
  blocks.push({id:'rich-table',type:'dataTable',props:{data:'{"custom":true}'},children:[]});
  const result=await saveImportedMarkdown(ed,map,blocks);
  const reopened=await loadImportedMarkdown(ed,result.source,JSON.stringify(blocks),JSON.stringify(result.map));
  assert.deepEqual(reopened.blocks,blocks);
  assert.equal(reopened.cached,true);
  assert.match(result.source,/Original\.\n\n\| A \| B \|/);
});
test('external source edits invalidate rich cache and rebuild from current Markdown', async () => {
  const {ed,blocks,map}=await loaded('Original.\n');
  const reopened=await loadImportedMarkdown(ed,'External.\n',JSON.stringify(blocks),JSON.stringify(map));
  assert.equal(reopened.blocks[0].content,'External.');
  assert.equal(reopened.cached,undefined);
});
test('a recovered block draft keeps baseline fingerprints, so edited text is exported on first save', async () => {
  const {ed,blocks,map}=await loaded('Original.\n');
  blocks[0].content='Draft.';
  const draft=await loadImportedMarkdown(ed,map.source,JSON.stringify(blocks),JSON.stringify(map));
  assert.equal((await saveImportedMarkdown(ed,draft.map,draft.blocks)).source,'Draft.\n');
});
test('source blocks normalize edited newlines to the original CRLF convention', async () => {
  const {ed,blocks,map}=await loaded('> Original\r\n> text\r\n');
  blocks[0].props.markdown='> Changed\n> text';
  assert.equal((await saveImportedMarkdown(ed,map,blocks)).source,'> Changed\r\n> text\r\n');
});
test('moving and deleting chunks preserve syntax, do not duplicate source, and maintain valid mappings', async () => {
  const {ed,blocks,map}=await loaded('First.\n\n> [!info] Second\n\nThird.\n');
  const moved=[blocks[2],blocks[0],blocks[1]];
  const result=await saveImportedMarkdown(ed,map,moved);
  assert.equal(result.source,'Third.\n\nFirst.\n\n> [!info] Second\n');
  assert.equal(decodeImportedMap(JSON.stringify(result.map)).source,result.source);
  const removed=await saveImportedMarkdown(ed,result.map,[moved[0],moved[2]]);
  assert.equal(removed.source,'Third.\n\n> [!info] Second\n');
});
test('malformed source maps are rejected rather than trusted', () => {
  assert.equal(decodeImportedMap('{"version":1,"source":"A","prefix":"B","suffix":"","chunks":[]}'),null);
});
const tagBuild=await build({entryPoints:[new URL('../src/lib/remarkNoteTags.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm'});
const {remarkNoteTags}=await import(`data:text/javascript;base64,${Buffer.from(tagBuild.outputFiles[0].text).toString('base64')}`);
test('tag pills support Cyrillic/hierarchy while leaving code, image and link text alone',()=>{
 const tree={type:'root',children:[{type:'paragraph',children:[{type:'text',value:'#Коломна #wms/rp and C# code'},{type:'inlineCode',value:'#Code'},{type:'link',url:'https://example.com',children:[{type:'text',value:'#Link'}]}]}]};
 remarkNoteTags()(tree);
 const children=tree.children[0].children;
 assert.deepEqual(children.filter(n=>n.url?.startsWith('synapse-tag:')).map(n=>decodeURIComponent(n.url.slice(12))),['коломна','wms/rp']);
 assert.equal(children.find(n=>n.type==='inlineCode').value,'#Code');
 assert.equal(children.at(-1).children[0].type,'text');
});
