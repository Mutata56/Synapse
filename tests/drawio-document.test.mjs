import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const temporary = await mkdtemp(join(tmpdir(), "synapse-drawio-document-"));
const entry = join(temporary, "document.mjs");
await build({ entryPoints: ["src/editor2026/blocks/whiteboard/drawioDocument.ts"], bundle: true, platform: "node", format: "esm", outfile: entry });
after(() => rm(temporary, { recursive: true, force: true }));
const { readDrawioDocument, serializeDrawioDocument, legacyBoardToDrawioXml, emptyDrawioXml } = await import(pathToFileURL(entry).href);

// Read XML attributes as an independent consumer would. The tests run without a browser or target JS.
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => entity[0] === "#" ? String.fromCodePoint(Number.parseInt(entity.slice(entity[1] === "x" ? 2 : 1), entity[1] === "x" ? 16 : 10)) : ({ amp:"&", lt:"<", gt:">", quot:'"', apos:"'" })[entity]);
const attributes = value => Object.fromEntries([...value.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])]));
const objects = xml => [...xml.matchAll(/<UserObject\b([^>]*)>([\s\S]*?)<\/UserObject>/g)].map(match => ({ ...attributes(match[1]), cell: attributes(/<mxCell\b([^>]*)/.exec(match[2])[1]), body: match[2] }));
const styles = value => Object.fromEntries(value.split(";").filter(Boolean).map(entry => { const i = entry.indexOf("="); return [entry.slice(0, i), entry.slice(i + 1)]; }));
const geometry = object => attributes(/<mxGeometry\b([^>]*)/.exec(object.body)[1]);
const byLegacy = (xml, id) => objects(xml).find(object => object.synapseLegacyId === id);
const points = object => [...object.body.matchAll(/<mxPoint\b([^>]*)\/>/g)].map(match => attributes(match[1]));
const base = { color:"#112233", sw:2.5, x:-40.25, y:17.5, w:90, h:50, fill:"rgba(120,20,40,0.5)" };
const fixture = () => ({
  shapes:[
    { ...base, id:"0", type:"rect", locked:true, opacity:0.25, custom:{ untouched:[1,"<&"] } },
    { ...base, id:"1", type:"ellipse", opacity:0 },
    { id:"arrow", type:"arrow", color:"#ff0066", sw:3, x1:-3, y1:9, x2:205.5, y2:-10 },
    { id:"pen", type:"pen", color:"#44aacc", sw:4, points:[{x:-10,y:1},{x:7,y:8},{x:7,y:8},{x:20,y:-1}] },
    { id:"text", type:"text", color:"#abcdef", sw:1, x:11, y:-5, text:'<foo> & "quoted"\nВторая строка', size:22 },
    { ...base, id:'db<&"', type:"db", title:'Таблица <orders> & "данные"', query:`SELECT "a" FROM t WHERE value < 7 AND name = 'A&B';\r\n-- второй ряд\t<xml/>`, textColor:"#fefefe" },
    { ...base, id:"process", type:"action", variant:"process", label:"Обработка" },
    { ...base, id:"decision", type:"action", variant:"decision", label:"Да < 7?" },
    { ...base, id:"process-alias", type:"process", label:"Архивный процесс" },
    { ...base, id:"decision-alias", type:"decision", text:"Архивная ветка" },
    { ...base, id:"note", type:"note", text:"Заметка", textColor:"#fff" },
    { id:"sticky", type:"sticky", x:2, y:4, w:200, h:120, fill:"#fde68a", text:"Старая карточка", locked:true, opacity:0.6 },
  ],
  edges:[
    { id:"edge-ortho", from:'db<&"', fromSide:"right", to:"process", toSide:"left", color:"#ddee11", routing:"orthogonal", label:'x < y & "да"', labelT:0.25 },
    { id:"edge-bezier", from:"process", fromSide:"bottom", to:"decision", toSide:"top", color:"#00ccaa", routing:"bezier", label:"ветка", labelT:0.9 },
  ],
  camera:{ x:125, y:-80, zoom:2.5 },
  version:99,
  unknownBoardMetadata:{ retain:"\u0000" },
});

test("all legacy shape types and variants become editable cells without ID collisions", () => {
  const board = fixture(), raw = JSON.stringify(board), doc = readDrawioDocument(raw);
  assert.equal(doc.engine,"drawio"); assert.equal(doc.version,1); assert.equal(doc.legacySnapshot,raw);
  const all = objects(doc.xml), migrated = all.filter(object => object.id !== "0");
  assert.equal(migrated.length,board.shapes.length + board.edges.length);
  assert.equal(new Set(all.map(object => object.id)).size,all.length);
  assert(!migrated.some(object => object.id === "0" || object.id === "1"));
  const expected = { "0":"rectangle", "1":"ellipse", "text":"text", 'db<&"':"cylinder3", "process":"rectangle", "decision":"rhombus", "process-alias":"rectangle", "decision-alias":"rhombus", "note":"note", "sticky":"note" };
  for (const [id, shape] of Object.entries(expected)) {
    const object = byLegacy(doc.xml,id);
    assert.equal(styles(object.cell.style).shape,shape,`legacy ${id} is represented`);
    assert.equal(object.cell.vertex,"1");
    assert.deepEqual(JSON.parse(object.synapseLegacyData),board.shapes.find(shape => shape.id === id));
  }
  assert.equal(byLegacy(doc.xml,"arrow").cell.edge,"1");
  assert.equal(byLegacy(doc.xml,"pen").cell.edge,"1");
  assert(!doc.xml.includes("<image"),"legacy vectors were not flattened into an image");
});

test("coordinates, styles, opacity and locks survive independently from camera zoom", () => {
  const xml = legacyBoardToDrawioXml(JSON.stringify(fixture()));
  const rect = byLegacy(xml,"0"), g = geometry(rect), style = styles(rect.cell.style);
  assert.deepEqual({ x:g.x,y:g.y,width:g.width,height:g.height },{x:"-40.25",y:"17.5",width:"90",height:"50"});
  assert.equal(style.strokeColor,"#112233"); assert.equal(style.strokeWidth,"2.5"); assert.equal(style.fillColor,base.fill); assert.equal(style.opacity,"25");
  for (const property of ["movable","resizable","rotatable","deletable","editable"]) assert.equal(style[property],"0");
  assert.equal(style.locked,"1"); assert.equal(styles(byLegacy(xml,"1").cell.style).opacity,"0");
  const sticky = styles(byLegacy(xml,"sticky").cell.style);
  assert.equal(sticky.opacity,"60"); assert.equal(sticky.locked,"1"); assert.equal(sticky.fillColor,"#fde68a");
  const root = objects(xml).find(object => object.id === "0");
  assert.deepEqual(JSON.parse(root.synapseCamera),fixture().camera);
  const model = attributes(/<mxGraphModel([^>]*)>/.exec(xml)[1]);
  assert.equal(model.dx,"50"); assert.equal(model.dy,"-32"); assert.equal(model.page,"0");
});

test("attached terminals, all four anchor sides and edge labels remain model links", () => {
  const board = fixture();
  board.edges.push({id:"edge-other-sides",from:"note",fromSide:"top",to:"sticky",toSide:"bottom",color:"#777",routing:"orthogonal"});
  const xml = legacyBoardToDrawioXml(JSON.stringify(board));
  const edge = byLegacy(xml,"edge-ortho"), style = styles(edge.cell.style);
  assert.equal(edge.cell.source,byLegacy(xml,'db<&"').id); assert.equal(edge.cell.target,byLegacy(xml,"process").id);
  assert.equal(edge.label,board.edges[0].label); assert.equal(geometry(edge).x,"-0.5");
  assert.deepEqual([style.exitX,style.exitY,style.entryX,style.entryY],["1","0.5","0","0.5"]);
  const curved = byLegacy(xml,"edge-bezier"), cs = styles(curved.cell.style);
  assert.equal(cs.curved,"1"); assert.deepEqual([cs.exitX,cs.exitY,cs.entryX,cs.entryY],["0.5","1","0.5","0"]);
  assert.equal(Number(geometry(curved).x),0.8);
  assert.equal(geometry(byLegacy(xml,"edge-other-sides")).x,"0");
});

test("freehand points, repeated samples and arrow endpoints remain editable vector geometry", () => {
  const xml = legacyBoardToDrawioXml(JSON.stringify(fixture()));
  const stroke = byLegacy(xml,"pen"), p = points(stroke);
  const start = p.find(point => point.as === "sourcePoint"), end = p.find(point => point.as === "targetPoint"), bends = p.filter(point => !point.as);
  assert.deepEqual(start,{x:"-10",y:"1",as:"sourcePoint"}); assert.deepEqual(end,{x:"20",y:"-1",as:"targetPoint"});
  assert.deepEqual(bends,[{x:"7",y:"8"},{x:"7",y:"8"}]);
  assert.equal(styles(stroke.cell.style).endArrow,"none");
  assert.deepEqual(points(byLegacy(xml,"arrow")),[{x:"-3",y:"9",as:"sourcePoint"},{x:"205.5",y:"-10",as:"targetPoint"}]);
  const special = legacyBoardToDrawioXml(JSON.stringify({shapes:[{id:"point",type:"pen",color:"#000",sw:4,points:[{x:10,y:20}]},{id:"empty-stroke",type:"pen",color:"#000",sw:2,points:[]}]}));
  assert.equal(styles(byLegacy(special,"point").cell.style).shape,"ellipse");
  assert.deepEqual(geometry(byLegacy(special,"point")),{x:"8",y:"18",width:"4",height:"4",as:"geometry"});
  assert.deepEqual(JSON.parse(byLegacy(special,"empty-stroke").synapseLegacyData).points,[]);
  assert.equal(byLegacy(special,"empty-stroke").cell.edge,"1");
});

test("XML escaping keeps plain labels, SQL whitespace and original bytes exactly", () => {
  const original = ` \n${JSON.stringify(fixture(),null,2)}\r\n `;
  const doc = readDrawioDocument(original), saved = serializeDrawioDocument(doc), reopened = readDrawioDocument(saved);
  assert.equal(reopened.legacySnapshot,original);
  assert.equal(reopened.xml,doc.xml);
  const root = objects(doc.xml).find(object => object.id === "0");
  assert.equal(root.synapseLegacySnapshot,original);
  const db = byLegacy(doc.xml,'db<&"');
  assert.equal(db.query,fixture().shapes.find(shape => shape.type === "db").query);
  assert.equal(db.label,fixture().shapes.find(shape => shape.type === "db").title);
  assert(doc.xml.includes("&#13;&#10;")); assert(doc.xml.includes("&#9;"));
  assert.equal(styles(byLegacy(doc.xml,"text").cell.style).html,"0");
  assert.equal(byLegacy(doc.xml,"text").label,fixture().shapes.find(shape => shape.type === "text").text);
  assert.equal(styles(byLegacy(doc.xml,'db<&"').cell.style).html,"0");
});

test("empty, early legacy snapshots, native XML and envelopes round trip", () => {
  for (const raw of [""," \n\t "]) assert.equal(readDrawioDocument(raw).xml,emptyDrawioXml());
  assert.equal(legacyBoardToDrawioXml(""),emptyDrawioXml());
  const early = JSON.stringify({shapes:[{type:"sticky",text:"без id"}]});
  const doc = readDrawioDocument(early);
  assert.equal(doc.legacySnapshot,early); assert.equal(objects(doc.xml).filter(object => object.id !== "0").length,1);
  const direct = `\n${emptyDrawioXml()}\n`;
  assert.equal(readDrawioDocument(direct).xml,direct);
  const native = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
  assert.equal(readDrawioDocument(native).xml,native);
  for (const preview of ["data:image/svg+xml;base64,PHN2Zy8+","data:image/png;base64,AA=="]) {
    const data = {engine:"drawio",version:1,xml:direct,preview,legacySnapshot:early,viewport:{scale:1.7,scroll:{x:-20,y:30},pageId:"page-2"},futureMetadata:{retain:true}};
    assert.deepEqual(readDrawioDocument(serializeDrawioDocument(data)),data);
  }
});

test("corrupt or unsupported envelopes and legacy data cannot overwrite the original prop", () => {
  const valid = {engine:"drawio",version:1,xml:emptyDrawioXml()};
  const bad = ["broken", "null", "[]", "{}", JSON.stringify({shapes:null}), JSON.stringify({engine:"other",shapes:[]}), ...[
    {...valid,version:2}, {...valid,engine:"canvas"}, {...valid,xml:""}, {...valid,xml:4}, {...valid,preview:4}, {...valid,legacySnapshot:{}}, {...valid,viewport:{scale:0}}, {...valid,viewport:{scale:1,scroll:{x:0,y:"oops"}}},
  ].map(value => JSON.stringify(value))];
  for (const initial of bad) {
    let snapshot = initial;
    assert.throws(() => { snapshot = serializeDrawioDocument(readDrawioDocument(snapshot)); },/Cannot read canvas/);
    assert.equal(snapshot,initial,"failure did not return an empty replacement");
  }
  assert.throws(() => serializeDrawioDocument({...valid,preview:"x".repeat(16*1024*1024+1)}),/preview is too large/);
});

test("duplicate IDs, unsupported objects, missing terminals and invalid anchor names fail whole migration", () => {
  const scenarios = [
    board => board.shapes.push({...board.shapes[0]}),
    board => board.shapes.push({...board.shapes[0],id:"unknown",type:"image"}),
    board => board.edges.push({...board.edges[0]}),
    board => board.edges[0].id = board.shapes[0].id,
    board => board.edges[0].from = "missing-node",
    board => board.edges[0].fromSide = "__proto__",
    board => board.shapes[0].x = "100",
    board => board.shapes[0].opacity = 1.1,
    board => board.shapes[0].locked = "true",
    board => board.shapes[0].color = "red;opacity=0",
    board => board.shapes[4].text = "bad\u0000label",
    board => board.camera.zoom = 0,
    board => { board.camera.x = 1e308; board.camera.zoom = 1e-308; },
  ];
  for (const change of scenarios) {
    const board = fixture(); change(board);
    assert.throws(() => readDrawioDocument(JSON.stringify(board)),/Cannot read canvas/);
  }
});

test("native XML plausibility validation handles compressed pages without executing code", () => {
  for (const xml of ['<?xml version="1.0" encoding="UTF-8"?>'+emptyDrawioXml(),'<mxfile><diagram id="p">eJwLAA==</diagram></mxfile>','<mxfile><diagram><![CDATA[eJwLAA==]]></diagram></mxfile>','<mxfile><diagram>eJwL&#65;A==</diagram></mxfile>','<mxGraphModel><root><UserObject id="0" приоритет="высокий" 中文="数据"/></root></mxGraphModel>','<mxGraphModel><root><UserObject id="0" query="]]>"/><mxCell id="1" parent="0"/></root></mxGraphModel>']) assert.equal(readDrawioDocument(xml).xml,xml);
  for (const xml of ['<?xml arbitrary?>'+emptyDrawioXml(),'<mxfile>','<mxfile/>','<mxfile><diagram/></mxfile>','<mxfile><diagram>  </diagram></mxfile>','<mxfile><diagram>AAAA====</diagram></mxfile>','<svg/>','<mxGraphModel/>','<mxfile><diagram><mxGraphModel><root/></mxGraphModel></mxfile>','<mxGraphModel><root><mxCell id="0" id="1"/></root></mxGraphModel>','<mxGraphModel><root><mxCell value="&unknown;"/></root></mxGraphModel>','<mxGraphModel><root><mxCell value="&#0;"/></root></mxGraphModel>','<!DOCTYPE mxfile SYSTEM "file:///etc/passwd">'+emptyDrawioXml(),emptyDrawioXml()+"<other/>",'<mxfile x="a"y="b"/>']) assert.throws(() => readDrawioDocument(xml),/Cannot read canvas/);
});

test('a successful import recovery slot survives note serialization without discarding the previous model',()=>{const previous=readDrawioDocument('');const imported={engine:'drawio',version:1,xml:previous.xml.replace('name="Холст"','name="Импорт"'),importBackup:{...previous,viewport:{scale:1.5,scroll:{x:10,y:20}}}};const reopened=readDrawioDocument(serializeDrawioDocument(imported));assert.equal(reopened.xml,imported.xml);const recovery=readDrawioDocument(JSON.stringify(reopened.importBackup));assert.equal(recovery.xml,previous.xml);assert.deepEqual(recovery.viewport,{scale:1.5,scroll:{x:10,y:20}});});
