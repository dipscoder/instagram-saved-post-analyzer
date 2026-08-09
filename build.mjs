import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const watch = process.argv.includes('--watch');

// Four separate bundles: MV3 service workers and content scripts each get their own
// isolated global scope, so there is nothing to share and code splitting would only
// produce imports none of them can resolve.
const entries = {
  'capture-main': 'src/capture/main-world.ts',
  content: 'src/content.ts',
  background: 'src/background/index.ts',
  popup: 'src/popup/popup.ts',
};

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });

const ctx = await esbuild.context({
  entryPoints: entries,
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome111', // content_scripts[].world:"MAIN" landed in Chrome 111
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
});

// Chrome loads the built folder, not the repo root — the repo root has no manifest.
// Print the exact path so it can be pasted straight into the Load unpacked dialog.
const loadPath = resolve('dist');

if (watch) {
  await ctx.watch();
  console.log(`\nwatching… load unpacked from:\n  ${loadPath}\n`);
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log(`\nBuilt. In chrome://extensions → Load unpacked, select:\n  ${loadPath}\n`);
}

