import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Synthetic data only. Run from the repository root; reports model work, not UI FPS.
const temporary = await mkdtemp(join(tmpdir(), 'synapse-model-bench-'));
try {
  const modulePath = join(temporary, 'model.mjs');
  await build({ stdin: { contents: "export { buildOverviewModel } from './src/lib/overviewModel.ts'", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', outfile: modulePath });
  const { buildOverviewModel } = await import(pathToFileURL(modulePath));
  let notes = Array.from({ length: 50000 }, (_, index) => ({ id: `note-${index}`, title: `Note ${index}`, folder: `root-${index % 30}/nested`, createdAt: 1780800000000, updatedAt: 1780900000000 + index * 1000, tags: ['sql', 'dba', `tag-${index % 10}`], favorite: index % 100 === 0, links: [], preview: '', icon: null, cover: null, mood: null }));
  const samples = [];
  for (let index = 0; index < 22; index++) {
    notes = [{ ...notes[0], favorite: !notes[0].favorite, updatedAt: notes[0].updatedAt + 1 }, ...notes.slice(1)];
    const start = performance.now();
    const model = buildOverviewModel(notes);
    const elapsed = performance.now() - start;
    if (model.notes.length !== 50000) throw new Error('Missing notes');
    if (index > 1) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ count: 50000, samples, medianMs: samples[10], p95Ms: samples[19] }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
