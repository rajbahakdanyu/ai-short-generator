import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {setTimeout} from 'node:timers/promises';
import {createServer, type ViteDevServer} from 'vite';
import {studioApi} from '../server/studio-api.ts';
import {localSettings} from '../src/local-settings.ts';
import {localStoryboardSchema} from '../src/local-storyboard.ts';

const headers = {'X-Short-Studio': '1', 'Content-Type': 'application/json'};

test('local storyboard validation follows the selected format and scene count', () => {
  const illustratedSettings = localSettings.parse({format: 'illustrated', scenes: 1});
  const illustrated = {
    title: 'Reviewed Short',
    scenes: [{narration: 'Explain the idea.', imagePrompt: 'A clear visual.'}],
  };
  assert.deepEqual(localStoryboardSchema(illustratedSettings).parse(illustrated), illustrated);
  assert.throws(() => localStoryboardSchema(illustratedSettings).parse({...illustrated, scenes: []}));
  const animatedSettings = localSettings.parse({format: 'animated', scenes: 1});
  const animated = {
    title: 'Reviewed diagram',
    scenes: [
      {
        narration: 'Show the request path.',
        diagram: {heading: 'Request path', layout: 'pipeline', labels: ['Browser', 'Proxy', 'Server']},
      },
    ],
  };
  assert.deepEqual(localStoryboardSchema(animatedSettings).parse(animated), animated);
  assert.throws(() => localStoryboardSchema(animatedSettings).parse(illustrated));
  assert.throws(() => localSettings.parse({targetDurationSeconds: 10}));
});

function serverAddress(server: {address(): unknown}) {
  const address = server.address();
  assert.ok(address && typeof address === 'object' && 'port' in address);
  return `http://127.0.0.1:${address.port}`;
}

test('local storyboards can be planned, reviewed, edited and validated before preparation', {
  timeout: 30_000,
}, async () => {
  const workspace = process.cwd();
  const originalPath = process.env.PATH;
  const originalPromptPath = process.env.PLAN_PROMPT_PATH;
  const directory = await mkdtemp(join(tmpdir(), 'short-studio-local-plan-'));
  const board = {
    title: 'A generated title',
    scenes: [{narration: 'Original narration.', imagePrompt: 'Original visual prompt.'}],
  };
  let studio: ViteDevServer | undefined;
  try {
    const models = join(directory, '.local-models');
    const bin = join(directory, 'bin');
    await mkdir(models, {recursive: true});
    await mkdir(bin, {recursive: true});
    await writeFile(join(models, 'script.gguf'), '');
    const executable = join(bin, 'llama-completion');
    await writeFile(
      executable,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv;
fs.writeFileSync(process.env.PLAN_PROMPT_PATH, args[args.indexOf('-p') + 1]);
process.stdout.write(${JSON.stringify(JSON.stringify(board))});
`,
    );
    await chmod(executable, 0o755);
    process.env.PATH = `${bin}:${originalPath ?? ''}`;
    process.env.PLAN_PROMPT_PATH = join(directory, 'prompt.txt');
    process.chdir(directory);

    studio = await createServer({
      configFile: false,
      cacheDir: join(directory, 'vite-cache'),
      plugins: [studioApi()],
      server: {host: '127.0.0.1', port: 0, watch: null},
    });
    await studio.listen();
    assert.ok(studio.httpServer);
    const base = `${serverAddress(studio.httpServer)}/api/studio`;
    async function request(path: string, value?: unknown) {
      const response = await fetch(`${base}/${path}`, {
        method: value === undefined ? 'GET' : 'POST',
        headers: value === undefined ? undefined : headers,
        body: value === undefined ? undefined : JSON.stringify(value),
      });
      return {response, body: await response.json()};
    }
    async function waitFor(id: string, phase: string) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const {body} = await request(`jobs/${id}`);
        if (body.phase === phase) return body;
        if (['Complete', 'Failed', 'Cancelled'].includes(body.phase))
          assert.fail(`Expected ${phase}, got ${JSON.stringify(body)}`);
        await setTimeout(50);
      }
      assert.fail(`Job did not reach ${phase}`);
    }

    const settings = localSettings.parse({
      scriptModel: '.local-models/script.gguf',
      scenes: 1,
      targetDurationSeconds: 60,
      audience: 'beginner',
    });
    const planned = await request('local', {
      ...settings,
      mode: 'plan',
      topic: 'How do rainbows form?',
    });
    assert.equal(planned.response.status, 202);
    const complete = await waitFor(planned.body.id, 'Complete');
    assert.equal(complete.hasStoryboard, true);
    const generated = await request(`jobs/${planned.body.id}/draft`);
    assert.equal(generated.body.kind, 'local-storyboard');
    assert.deepEqual(generated.body.manifest.scenes, board.scenes);
    assert.match(await readFile(join(directory, 'prompt.txt'), 'utf8'), /Target about 60 seconds/);
    assert.match(
      await readFile(join(directory, 'prompt.txt'), 'utf8'),
      /beginners with no assumed background knowledge/,
    );

    const invalid = await request('local', {
      mode: 'prepare',
      planId: planned.body.id,
      board: {title: 'Invalid', scenes: []},
    });
    assert.equal(invalid.response.status, 400);

    const editedBoard = {
      title: 'Reviewed title',
      scenes: [
        {
          narration: 'Reviewed narration.',
          imagePrompt: 'Reviewed visual prompt.',
          sources: 'Reference checked by the user.',
        },
      ],
    };
    const preparation = await request('local', {
      mode: 'prepare',
      planId: planned.body.id,
      board: editedBoard,
    });
    assert.equal(preparation.response.status, 202);
    const failed = await waitFor(planned.body.id, 'Failed');
    assert.match(failed.error, /Missing local model or runtime/);
    assert.equal(failed.hasStoryboard, true);
    assert.equal(failed.resumable, true);
    const persisted = await request(`jobs/${planned.body.id}/draft`);
    assert.deepEqual(persisted.body.manifest, {...editedBoard, settings});
    assert.equal(failed.localMode, 'prepare');

    const parsed = localStoryboardSchema(settings).parse(editedBoard);
    assert.deepEqual(parsed, editedBoard);

    const resumed = await request(`jobs/${planned.body.id}/resume`, {});
    assert.equal(resumed.response.status, 202);
    const retried = await waitFor(planned.body.id, 'Failed');
    assert.match(retried.error, /Missing local model or runtime/);
  } finally {
    await studio?.close();
    process.chdir(workspace);
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalPromptPath === undefined) delete process.env.PLAN_PROMPT_PATH;
    else process.env.PLAN_PROMPT_PATH = originalPromptPath;
    await rm(directory, {recursive: true, force: true});
  }
});
