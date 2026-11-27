import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {captionIssue, projectSchema} from '../src/project.ts';
import {downloadAsset} from '../src/providers/asset-download.ts';
import {paidProviders} from '../src/providers/config.ts';
import {readProviderBytes} from '../src/providers/http.ts';
import {generateClip} from '../src/providers/video.ts';
import {exportSceneTiming, newRecording} from '../web/scene-state.ts';

const scene = {
  name: 'Opening shot',
  narration: 'Hello world.',
  kokoroVoice: 'af_heart',
  sources: 'Reference notes',
  image: 'scene-1.jpg',
  audio: 'scene-1.wav',
  frames: 60,
  captions: [{text: 'Hello world.', start: 0, end: 2}],
} as const;

test('unversioned prepared projects preserve editable metadata when saved again', () => {
  const input = {title: 'Demo', scenes: [scene], music: 'music.wav', musicVolume: 0.21};
  const prepared = projectSchema.parse(input);
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(prepared))), {...input, version: 1});
});

test('captions must be ordered, non-overlapping, and within the scene', () => {
  const cues = [
    {text: 'First', start: 0, end: 1},
    {text: 'Second', start: 1, end: 2},
  ];
  assert.equal(captionIssue(cues, 1, 60), undefined);
  for (const invalid of [
    {start: 0.5, end: 2},
    {start: 1, end: 3},
    {start: 2, end: 1},
  ]) {
    const captions = [cues[0], {...cues[1], ...invalid}];
    assert.ok(captionIssue(captions, 1, 60));
    assert.equal(projectSchema.safeParse({title: 'Demo', scenes: [{...scene, captions}]}).success, false);
  }
});

test('replacing narration clears timing from the previous recording', () => {
  const voice = {name: 'new.wav', kind: 'audio' as const, source: new Blob(['fixture'])};
  const regenerated = {...scene, voiceOutdated: true, ...newRecording(voice, 4)};
  assert.equal(regenerated.voice, voice);
  assert.equal(regenerated.seconds, 4);
  assert.equal(regenerated.frames, undefined);
  assert.equal(regenerated.captions, undefined);
  assert.equal(regenerated.voiceOutdated, false);
});

test('export discards the imported frame count and captions after a narration edit', () => {
  const voice = {name: 'old.wav', kind: 'audio' as const, source: new Blob(['fixture'])};
  const imported = {id: 'imported', ...scene, captions: [...scene.captions], voice};
  assert.deepEqual(exportSceneTiming(imported), {frames: scene.frames, captions: scene.captions});
  const edited = {...imported, narration: 'A much longer replacement narration.', voiceOutdated: true};
  assert.deepEqual(exportSceneTiming(edited), {});
});

test('provider endpoints require HTTPS outside loopback', () => {
  const script = {provider: 'compatible', model: 'demo', apiKey: 'test'};
  assert.throws(() => paidProviders(true, {script: {...script, baseUrl: 'http://example.com'}}), /HTTPS/);
  assert.equal(
    paidProviders(true, {script: {...script, baseUrl: 'http://127.0.0.1:8080'}}).script?.endpoint,
    'http://127.0.0.1:8080',
  );
});

test('provider asset downloads reject non-public destinations and oversized bodies', async () => {
  await assert.rejects(downloadAsset('https://127.0.0.1/image.jpg'), /public HTTPS/);
  await assert.rejects(readProviderBytes(new Response('large'), 2), /size limit/);
});

test('an expired fal checkpoint is cleared without automatically submitting another paid request', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'fal-checkpoint-test-'));
  try {
    const checkpoint = join(directory, 'request');
    const id = '3cb2bfd4-a47d-4da9-853a-f6bd96bfe000';
    await writeFile(checkpoint, id);
    const fetchMock = context.mock.method(globalThis, 'fetch', async (url: string) => {
      assert.ok(url.endsWith(`/requests/${id}/status`));
      return new Response(null, {status: 410});
    });
    await assert.rejects(
      generateClip('test-key', 'A scene', checkpoint, {
        beforeSubmit: async () => assert.fail('Unexpected new paid request'),
      }),
      /no longer available/,
    );
    assert.equal(fetchMock.mock.callCount(), 1);
    await assert.rejects(readFile(checkpoint), {code: 'ENOENT'});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('an interrupted fal submission is not resubmitted automatically', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'fal-pending-test-'));
  try {
    const checkpoint = join(directory, 'request');
    const fetchMock = context.mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await assert.rejects(generateClip('test-key', 'A scene', checkpoint, {}), /Could not reach fal/);
    assert.equal((await readFile(checkpoint)).toString(), 'pending');
    await assert.rejects(
      generateClip('test-key', 'A scene', checkpoint, {
        beforeSubmit: async () => assert.fail('Unexpected new paid request'),
      }),
      /may still be billed/,
    );
    assert.equal(fetchMock.mock.callCount(), 1);
    await assert.rejects(readFile(checkpoint), {code: 'ENOENT'});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('a rejected fal submission clears its pending marker', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'fal-rejected-test-'));
  try {
    const checkpoint = join(directory, 'request');
    context.mock.method(globalThis, 'fetch', async () => new Response(null, {status: 401}));
    await assert.rejects(generateClip('test-key', 'A scene', checkpoint, {}), /HTTP 401/);
    await assert.rejects(readFile(checkpoint), {code: 'ENOENT'});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
