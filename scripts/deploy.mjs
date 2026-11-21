/**
 * `npm run deploy`: installs dependencies, bundles every Edge Function and deploys them
 * all to the project in supabase/config.toml. One command for the whole server side.
 *
 * Migrations are not run here: paste new files from supabase/migrations into the SQL
 * Editor first (the newest are listed at the end). The first deploy on a computer asks
 * you to run `npx supabase login` once.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const config = readFileSync('supabase/config.toml', 'utf8');
const project = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
const functions = [...config.matchAll(/^\[functions\.([a-z0-9_-]+)\]/gm)].map((m) => m[1]);
if (!project || !functions.length) fail('supabase/config.toml names no project or functions.');

step('Installing dependencies', 'npm', ['install']);
step('Bundling functions', 'npm', ['run', 'build:functions']);
for (const name of functions) {
  step(`Deploying ${name}`, 'npx', ['--yes', 'supabase', 'functions', 'deploy', name, '--project-ref', project, '--use-api'], () =>
    'If it says you are not logged in, run `npx supabase login` once and try again.',
  );
}

const newest = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort().slice(-3);
console.log(`\n✓ Deployed ${functions.join(', ')} to ${project}.`);
console.log('\nMigrations are run by hand, before a deploy that needs them. The newest:');
for (const f of newest) console.log(`  supabase/migrations/${f}`);
console.log('Each one is safe to run again. Paste any you have not run into Dashboard → SQL Editor.\n');

function step(title, command, args, hint) {
  console.log(`\n→ ${title}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) fail(`${title} failed.${hint ? ` ${hint()}` : ''}`);
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}
