import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTagIndex, normalizeTag, queryTagIndex, getTagRows, windowRange } from '../src/lib/tagExplorer.ts';

const note = (id, tags, extra = {}) => ({ id, tags, title: id, folder: '', preview: '', updatedAt: Number(id) || 1, createdAt: 1, icon: null, cover: null, favorite: false, links: [], ...extra });
const ids = (notes) => notes.map(n => n.id);

test('canonical paths deduplicate case, hashes and Unicode without changing source tags', () => {
  const source = note('1', [' #WMS / Picking ', 'wms/picking', '#', '']);
  const index = buildTagIndex([source]);
  assert.equal(normalizeTag('##WMS//Picking/'), 'wms/picking');
  assert.equal(index.explicitCount, 1);
  assert.equal(index.tags.get('wms').count, 1);
  assert.equal(index.tags.get('wms/picking').count, 1);
  assert.equal(source.tags[0], ' #WMS / Picking ');
  assert.equal(normalizeTag(42), '');
  assert.equal(normalizeTag(null), '');
});
test('ancestor counts include descendants once, while exact children remain distinct', () => {
  const index = buildTagIndex([note('1', ['wms', 'wms/picking', 'wms/receiving']), note('2', ['wms/picking']), note('3', ['wtms'])]);
  assert.equal(index.tags.get('wms').count, 2);
  assert.deepEqual(ids(queryTagIndex(index, { tags: ['wms'] })), ['2', '1']);
  assert.deepEqual(ids(queryTagIndex(index, { tags: ['wms/receiving'] })), ['1']);
});
test('all/any filters have intersection/union semantics and unique results', () => {
  const index = buildTagIndex([note('1', ['a', 'b']), note('2', ['a']), note('3', ['b']), note('4', [])]);
  assert.deepEqual(ids(queryTagIndex(index, { tags: ['a', 'b'] })), ['1']);
  assert.deepEqual(ids(queryTagIndex(index, { tags: ['a', 'b'], match: 'any' })), ['3', '2', '1']);
  assert.deepEqual(ids(queryTagIndex(index, { tags: ['a', 'missing'] })), []);
  assert.deepEqual(ids(queryTagIndex(index, { tags: ['a', 'missing'], match: 'any' })), ['2', '1']);
  assert.deepEqual(ids(queryTagIndex(index, { tags: ['a', '#A'] })), ['2', '1']);
});
test('reset returns all notes; untagged includes blank tag lists; duplicate ids stay unique', () => {
  const index = buildTagIndex([note('1', ['a']), note('2', ['#', '']), note('3', []), note('1', ['a'])]);
  assert.equal(queryTagIndex(index).length, 3);
  assert.deepEqual(ids(queryTagIndex(index, { untagged: true })), ['3', '2']);
});
test('search combines title/folder/preview/tag terms with selected tags', () => {
  const index = buildTagIndex([note('1', ['wms'], { title: 'Picking', folder: 'Коломна', preview: 'TASK_REPORT' }), note('2', ['wtms'], { title: 'Picking' })]);
  assert.deepEqual(ids(queryTagIndex(index, { tags: ['wms'], search: 'PICKING коломна task_report' })), ['1']);
  assert.deepEqual(ids(queryTagIndex(index, { search: '#WTMS' })), ['2']);
});
test('sorting never mutates the stable indexed order', () => {
  const index = buildTagIndex([note('1', [], { title: 'A', createdAt: 3 }), note('2', [], { title: 'Z', createdAt: 2 })]);
  assert.deepEqual(ids(queryTagIndex(index, { sort: 'title' })), ['1', '2']);
  assert.deepEqual(ids(queryTagIndex(index, { sort: 'created' })), ['1', '2']);
  assert.deepEqual(ids(queryTagIndex(index)), ['2', '1']);
});
test('tree expansion and search expose real ancestors without inventing groups', () => {
  const index = buildTagIndex([note('1', ['a/b/c']), note('2', ['z'])]);
  assert.deepEqual(getTagRows(index, new Set(), '', 'name').map(n => n.path), ['a', 'z']);
  assert.deepEqual(getTagRows(index, new Set(['a']), '', 'name').map(n => n.path), ['a', 'a/b', 'z']);
  assert.deepEqual(getTagRows(index, new Set(), 'c').map(n => [n.path, n.depth]), [['a', 0], ['a/b', 1], ['a/b/c', 2]]);
  assert.deepEqual(getTagRows(index, new Set(), 'missing'), []);
});
test('50,000 results mount only the viewport plus overscan', () => {
  const range = windowRange(50000, 12000, 700, 88);
  assert.ok(range.end - range.start <= 17);
  assert.ok(range.offset <= 12000);
  assert.equal(range.total, 4400000);
  assert.deepEqual(windowRange(0, 1000, 700, 88), { start: 0, end: 0, offset: 0, total: 0 });
  assert.deepEqual(windowRange(2, 12000, 700, 88), { start: 0, end: 2, offset: 0, total: 176 });
});
