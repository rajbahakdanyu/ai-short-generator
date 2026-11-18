import {readFile, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {projectSchema} from './project.js';

export async function renderShort(directory: string) {
  const inputProps = projectSchema.parse(JSON.parse(await readFile(join(directory, 'project.json'), 'utf8')));
  const serveUrl = await bundle({
    entryPoint: fileURLToPath(new URL('./video.tsx', import.meta.url)),
    publicDir: join(directory, 'assets'),
  });
  const output = join(directory, 'short.mp4');
  const temporaryOutput = join(directory, `short-${randomUUID()}.mp4`);

  try {
    const composition = await selectComposition({serveUrl, id: 'EducationalShort', inputProps});
    let lastProgress = -1;
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: 'h264',
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      outputLocation: temporaryOutput,
      concurrency: 3,
      onProgress: ({progress}) => {
        const milestone = Math.floor(progress * 4);
        if (milestone > lastProgress) {
          console.log(`Rendering ${milestone * 25}%`);
          lastProgress = milestone;
        }
      },
    });
    await rename(temporaryOutput, output);
    return output;
  } finally {
    await Promise.all([rm(temporaryOutput, {force: true}), rm(serveUrl, {recursive: true, force: true})]);
  }
}
