import { mkdir, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = await realpath(path.resolve(scriptDirectory, '..'));
const dataDirectory = path.resolve(repositoryRoot, 'data');
const relativeTarget = path.relative(repositoryRoot, dataDirectory);

// Refuse to operate if path resolution ever stops pointing at this repository's
// direct data directory. This guard intentionally remains stricter than needed.
if (relativeTarget !== 'data' || dataDirectory === repositoryRoot) {
  throw new Error(`Refusing to reset unexpected path: ${dataDirectory}`);
}

async function countFiles(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })) {
    count += entry.isDirectory() ? await countFiles(path.join(directory, entry.name)) : 1;
  }
  return count;
}

const fileCount = await countFiles(dataDirectory);
console.log('Ironfronts data reset');
console.log(`Target: ${dataDirectory}`);
console.log(`Files found: ${fileCount}`);
console.log('This permanently removes local accounts, sessions, campaign saves, country seats, backups, and diagnostics.');
console.log('Stop the local development stack before continuing.');

const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await prompt.question('Reset all local game data? [y/N] ');
prompt.close();

if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
  console.log('Data reset cancelled. Nothing was removed.');
  process.exit(0);
}

await rm(dataDirectory, { recursive: true, force: true });
await mkdir(dataDirectory, { recursive: true });
console.log(`Reset complete. Removed ${fileCount} file${fileCount === 1 ? '' : 's'} and recreated the data directory.`);
