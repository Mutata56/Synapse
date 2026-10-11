import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const folder = await mkdtemp(join(tmpdir(), 'synapse-text-tests-'));
after(() => rm(folder, { recursive: true, force: true }));
let sequence = 0;
async function fixture(reader) {
  globalThis.__synapseTextReader = reader;
  const file = join(folder, `text-${sequence++}.mjs`);
  await build({
    stdin: { contents: "export * from './src/lib/fullTextSearch.ts'", resolveDir: process.cwd() },
    bundle: true, platform: 'node', format: 'esm', outfile: file,
    plugins: [{ name: 'fake-storage', setup(builder) {
      builder.onResolve({ filter: /^\.\/storage$/ }, args => args.importer.endsWith('/fullTextSearch.ts') ? { path: 'storage', namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const readNote = id => globalThis.__synapseTextReader(id);' }));
    } }],
  });
  return import(pathToFileURL(file));
}
const note = (id, updatedAt = 1) => ({ id, title: id, updatedAt, createdAt: 1 });

test('startup warm-up, search and word statistics share one cold read per version', async () => {
  let reads = 0;
  const api = await fixture(async id => { reads++; await new Promise(resolve => setImmediate(resolve)); return { content: `${id} shared body` }; });
  const notes = Array.from({ length: 530 }, (_, index) => note(`note-${index}`));
  const [_, docs, words] = await Promise.all([api.warmIndex(notes), api.buildSearchDocs(notes), api.wordCountsFor(notes)]);
  assert.equal(docs.length, 530); assert.equal(words.length, 530);
  assert.equal(reads, 530);
  assert.equal(api.searchFullText(docs, 'shared body', 8).length, 8);
});

test('an older read completing last cannot overwrite a newer body version', async () => {
  let calls = 0, finishOld;
  const oldBody = new Promise(resolve => finishOld = resolve);
  const api = await fixture(async () => ++calls === 1 ? oldBody : { content: 'new body' });
  const old = api.buildSearchDocs([note('a', 1)]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await api.buildSearchDocs([note('a', 2), note('b', 2)]))[0].body, 'new body');
  finishOld({ content: 'old body' }); await old;
  assert.equal((await api.buildSearchDocs([note('a', 2), note('b', 2)]))[0].body, 'new body');
  assert.equal(calls, 3);
});

test('failed shared reads are retryable and changed versions read once again', async () => {
  let calls = 0;
  const api = await fixture(async () => { if (++calls === 1) throw new Error('unavailable'); return { content: 'restored body' }; });
  await assert.rejects(api.buildSearchDocs([note('a')]));
  assert.equal((await api.buildSearchDocs([note('a')]))[0].body, 'restored body');
  await Promise.all([api.buildSearchDocs([note('a', 2)]), api.wordCountsFor([note('a', 2)])]);
  assert.equal(calls, 3);
});
