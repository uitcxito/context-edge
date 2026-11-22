import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const stage = await mkdtemp(path.join(root, '.build-'));
try {
  await cp(path.join(root, 'public'), stage, { recursive: true });
  await mkdir(path.join(stage, 'js'), { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: {
      worker: 'src/background/worker.ts',
      content: 'src/content/main.ts',
      options: 'src/ui/options.ts',
      popup: 'src/ui/popup.ts'
    },
    outdir: path.join(stage, 'js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    charset: 'utf8',
    legalComments: 'none',
    loader: { '.css': 'text', '.txt': 'text' }
  });
  await rm(path.join(root, 'dist'), { recursive: true, force: true });
  await rename(stage, path.join(root, 'dist'));
} finally {
  await rm(stage, { recursive: true, force: true });
}
