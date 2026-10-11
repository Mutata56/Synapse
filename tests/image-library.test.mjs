import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({ stdin: { contents: "export * from './src/lib/imageLibrary.ts'; export { windowRange } from './src/lib/tagExplorer.ts';", resolveDir: new URL('../',import.meta.url).pathname }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { extractImageReferences, createImageFilesIndex, resolveImageReferences, buildImageIndex, getImageIndex, queryImageIndex, windowRange, imageFormat } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const sha = 'a'.repeat(64) + '.png';

test('vault images resolve wiki, relative, encoded and HTML references without treating code as a rendered attachment', () => {
  const files = createImageFilesIndex(['Images/Рисунок 1.png','Work/local.jpg', 'Root.svg', '.assets/'+sha]);
  const source = `![[Images/Рисунок 1.png|400]]\n![relative](local.jpg)\n![encoded](../Images/Рисунок%201.png)\n<img src="../Root.svg">\n\n\`![not rendered](Root.svg)\`\n\n\`\`\`md\n![[not-found.png]]\n\`\`\`\n\n{"assetUrl":"asset://localhost/root/notes/.assets/${sha}"}`;
  assert.deepEqual([...resolveImageReferences(extractImageReferences(source), 'Work/note', files)].sort(), ['.assets/'+sha,'Images/Рисунок 1.png','Root.svg','Work/local.jpg'].sort());
  assert.equal(resolveImageReferences(extractImageReferences('`![[Root.svg]]`'), 'Work/note', files).size, 0);
});

test('ambiguous basenames, remote URLs and paths escaping the vault are not associations', () => {
  const files = createImageFilesIndex(['a/image.png','b/image.png']);
  const refs = extractImageReferences('![[image.png]]\n![remote](https://example.com/a/image.png)\n![escape](../../a/image.png)');
  assert.equal(resolveImageReferences(refs, 'root', files).size, 0);
  assert.deepEqual([...resolveImageReferences(extractImageReferences('![explicit](a/image.png)'), 'root', files)], ['a/image.png']);
});

test('library queries combine note context, folder, scope and format and preserve input data', () => {
  const make = (id, modifiedAt, usedBy=[]) => ({ id, name:id.split('/').at(-1), folder:id.includes('/')?id.slice(0,id.lastIndexOf('/')):'', modifiedAt, sizeBytes:modifiedAt*100, managed:false, url:id, usedBy });
  const images = [make('pics/photo2.JPEG',1,[{id:'n',title:'Опрос WTMS',folder:'Работа'}]),make('pics/photo10.png',3),make('diagram.svg',2,[{id:'__versions__',title:'История версий',folder:''}])];
  const before=structuredClone(images); const index=buildImageIndex([...images, images[0], make('not-image.pdf',4)]);
  const filter={query:'wtms работа',scope:'used',folder:'pics',format:'jpg',sort:'modified'};
  assert.deepEqual(queryImageIndex(index,filter).map(i=>i.id), ['pics/photo2.JPEG']);
  assert.deepEqual(queryImageIndex(index,{...filter,query:'',scope:'unused',format:''}).map(i=>i.id),['pics/photo10.png']);
  assert.equal(index.images.length,3); assert.equal(index.used,2); assert.equal(index.unused,1);
  assert.equal(imageFormat('picture.JPEG'),'jpg'); assert.equal(imageFormat('file.pdf'),'');
  assert.deepEqual(images,before);
});

test('50,000 image results require only visible rows and overscan, including a partial final row', () => {
  const range=windowRange(Math.ceil(50000/4),300000,800,220);
  assert((range.end-range.start)*4<=52); assert(range.start>0);
  const tail=windowRange(Math.ceil(7/3),220,400,220);
  assert.equal(Math.min(7,tail.end*3),7); assert.equal(tail.total,660);
});


test('returning to the library reuses its index while a new vault revision refreshes names, sizes and associations', () => {
  const image={id:'photo.png',name:'photo.png',folder:'',modifiedAt:1,sizeBytes:100,managed:false,url:'photo.png',usedBy:[]};
  const images=Object.freeze([Object.freeze(image)]);
  const before=getImageIndex(images);
  assert.equal(getImageIndex(images),before);
  const all={query:'',scope:'all',folder:null,format:'',sort:'modified'};
  assert.equal(queryImageIndex(before,all),before.sorted.modified);
  const after=getImageIndex([{...image,name:'renamed.png',sizeBytes:200,usedBy:[{id:'note',title:'Fresh context',folder:'Work'}]}]);
  assert.notEqual(after,before);
  assert.equal(after.totalBytes,200);
  assert.deepEqual(queryImageIndex(after,{...all,query:'fresh',scope:'used'}).map(i=>i.id),['photo.png']);
  assert.deepEqual(queryImageIndex(before,{...all,query:'fresh'}),[]);
  assert.deepEqual(queryImageIndex(after,{...all,scope:'unused'}),[]);
});
