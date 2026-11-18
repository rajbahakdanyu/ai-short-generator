import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {createServer as createHttpServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {setTimeout} from 'node:timers/promises';
import {createServer, type ViteDevServer} from 'vite';
import {studioApi} from '../server/studio-api.ts';
import {run} from '../src/media.ts';

const headers = {'X-Short-Studio': '1', 'Content-Type': 'application/json'};

function serverAddress(server: {address(): unknown}) {
  const address = server.address();
  assert.ok(address && typeof address === 'object' && 'port' in address);
  return `http://127.0.0.1:${address.port}`;
}

test('Studio resumes paid jobs across a restart and only retries missing assets', {
  timeout: 30_000,
}, async () => {
  const workspace = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'short-studio-test-'));
  let studio: ViteDevServer | undefined;
  let failVoice = true;
  const imageCalls = new Map<string, number>();
  const voiceCalls = new Map<string, number>();
  const board = {
    title: 'Mock educational Short',
    scenes: [
      {
        name: 'Opening',
        narration: 'First scene.',
        imagePrompt: 'First prompt',
        sources: 'Opening references',
      },
      {name: 'Conclusion', narration: 'Second scene.', imagePrompt: 'Second prompt'},
    ],
  };
  const image = await readFile(new URL('../demo/scene-1.jpg', import.meta.url));
  const wavPath = join(directory, 'fixture.wav');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', wavPath]);
  const wav = await readFile(wavPath);
  const provider = createHttpServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/chat/completions')
      return res.end(JSON.stringify({choices: [{message: {content: JSON.stringify(board)}}]}));
    if (req.url === '/images/generations') {
      const prompt = String(body.prompt);
      imageCalls.set(prompt, (imageCalls.get(prompt) ?? 0) + 1);
      return res.end(JSON.stringify({data: [{b64_json: image.toString('base64')}]}));
    }
    if (req.url === '/audio/speech') {
      const input = String(body.input);
      voiceCalls.set(input, (voiceCalls.get(input) ?? 0) + 1);
      if (input === 'Second scene.' && failVoice) {
        res.statusCode = 503;
        return res.end('{}');
      }
      res.setHeader('Content-Type', 'audio/wav');
      return res.end(wav);
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  try {
    const browserCache = join(workspace, 'node_modules', '.remotion');
    await mkdir(browserCache, {recursive: true});
    await symlink(browserCache, join(directory, '.remotion'), 'junction');
    process.chdir(directory);
    const openStudio = async () => {
      studio = await createServer({
        configFile: false,
        cacheDir: join(directory, 'vite-cache'),
        plugins: [studioApi()],
        server: {host: '127.0.0.1', port: 0, watch: null},
      });
      await studio.listen();
      assert.ok(studio.httpServer);
      return `${serverAddress(studio.httpServer)}/api/studio`;
    };
    let base = await openStudio();
    const config = {
      provider: 'compatible',
      apiKey: 'fake-test-key',
      baseUrl: serverAddress(provider),
      model: 'fixture',
    };
    const selection = {script: config, image: config, voice: {...config, voice: 'fixture'}};
    async function request(path: string, init?: RequestInit) {
      const res = await fetch(`${base}/${path}`, init);
      const value = await res.json();
      assert.ok(res.ok, JSON.stringify(value));
      return value;
    }
    async function waitFor(id: string, phase: string) {
      for (let attempt = 0; attempt < 600; attempt++) {
        const job = await request(`jobs/${id}`);
        if (job.phase === phase) return job;
        if (['Complete', 'Failed', 'Cancelled'].includes(job.phase)) assert.fail(JSON.stringify(job));
        await setTimeout(100);
      }
      assert.fail(`Job did not reach ${phase}`);
    }
    const plan = await request('paid', {
      method: 'POST',
      headers,
      body: JSON.stringify({mode: 'plan', topic: 'Test', selection}),
    });
    await waitFor(plan.id, 'Complete');
    assert.deepEqual((await request(`jobs/${plan.id}/draft`)).manifest, board);

    const form = new FormData();
    form.set(
      'request',
      JSON.stringify({
        mode: 'prepare',
        board,
        selection,
        estimate: {script: 0, visual: 1, voice: 1, limit: 4},
      }),
    );
    form.set('music', new Blob([wav], {type: 'audio/wav'}), 'music.wav');
    const job = await request('paid', {method: 'POST', headers: {'X-Short-Studio': '1'}, body: form});
    const failed = await waitFor(job.id, 'Failed');
    assert.equal(failed.resumable, true);
    assert.equal((await request(`jobs/${job.id}/draft`)).manifest.scenes[0].audio, 'scene-1.wav');

    await studio?.close();
    failVoice = false;
    base = await openStudio();
    assert.equal((await request(`jobs/${job.id}`)).phase, 'Failed');
    await request(`jobs/${job.id}/resume`, {
      method: 'POST',
      headers,
      body: JSON.stringify({mode: 'plan', selection}),
    });
    await setTimeout(125);
    const capped = await waitFor(job.id, 'Failed');
    assert.match(capped.error, /spending limit reached/);
    assert.equal(capped.estimatedSpend, 4);
    assert.deepEqual(capped.usage, {script: 0, visual: 2, voice: 2});
    assert.equal(voiceCalls.get('Second scene.'), 1);

    assert.equal(
      (
        await request(`jobs/${job.id}/resume`, {
          method: 'POST',
          headers,
          body: JSON.stringify({mode: 'plan', selection, resumeLimit: 5}),
        })
      ).id,
      job.id,
    );
    await waitFor(job.id, 'Complete');
    const {manifest} = await request(`jobs/${job.id}/draft`);
    assert.equal(manifest.version, 1);
    assert.equal(manifest.music, 'music.wav');
    assert.equal(manifest.scenes[0].name, 'Opening');
    assert.equal(manifest.scenes[0].sources, 'Opening references');
    assert.deepEqual([...imageCalls.values()], [1, 1]);
    assert.equal(voiceCalls.get('First scene.'), 1);
    assert.equal(voiceCalls.get('Second scene.'), 2);
    assert.equal(
      (await request('jobs')).some((entry: {id: string}) => entry.id === job.id),
      true,
    );
    const exportForm = new FormData();
    exportForm.set(
      'storyboard',
      JSON.stringify({
        title: 'Round trip',
        musicVolume: 0.25,
        scenes: [{...manifest.scenes[0], kind: 'image', frames: 36}],
      }),
    );
    exportForm.set('visual-0', new Blob([image], {type: 'image/jpeg'}), 'scene.jpg');
    exportForm.set('voice-0', new Blob([wav], {type: 'audio/wav'}), 'voice.wav');
    exportForm.set('music', new Blob([wav], {type: 'audio/wav'}), 'music.wav');
    const exported = await request('export', {
      method: 'POST',
      headers: {'X-Short-Studio': '1'},
      body: exportForm,
    });
    const result = await waitFor(exported.id, 'Complete');
    assert.equal(result.hasVideo, true);
    assert.equal(result.hasDraft, true);
    const draft = (await request(`jobs/${exported.id}/draft`)).manifest;
    assert.deepEqual(draft.scenes[0], {...manifest.scenes[0], frames: 36});
    assert.equal(draft.musicVolume, 0.25);
    const video = await fetch(`${base}/jobs/${exported.id}/video`, {headers: {Range: 'bytes=0-15'}});
    assert.equal(video.status, 206);
    assert.equal((await video.arrayBuffer()).byteLength, 16);

    await studio?.close();
    const exportManifest = join(directory, 'output', `studio-${exported.id}`, 'job.json');
    const interrupted = JSON.parse(await readFile(exportManifest, 'utf8'));
    await writeFile(
      exportManifest,
      JSON.stringify({...interrupted, phase: 'Rendering video', file: undefined}),
    );
    base = await openStudio();
    const local = await request(`jobs/${exported.id}`);
    assert.equal(local.resumable, true);
    assert.equal(local.resumeNeedsProviders, false);
    await request(`jobs/${exported.id}/resume`, {method: 'POST', headers: {'X-Short-Studio': '1'}});
    assert.equal((await waitFor(exported.id, 'Complete')).hasVideo, true);

    await request(`jobs/${job.id}`, {method: 'DELETE', headers});
    assert.equal((await fetch(`${base}/jobs/${job.id}`)).status, 404);
  } finally {
    await studio?.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    process.chdir(workspace);
    await rm(directory, {recursive: true, force: true});
  }
});
