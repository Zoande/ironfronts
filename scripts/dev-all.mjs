import { spawn } from 'node:child_process';

const services = [
  { label: 'client', script: 'dev' },
  { label: 'auth', script: 'auth:dev' },
  { label: 'game', script: 'game:dev' },
];

if (process.argv.includes('--help')) {
  console.log('Starts the complete Ironfronts local development stack:');
  for (const service of services) console.log(`  ${service.label}: npm run ${service.script}`);
  process.exit(0);
}

const npmExecPath = process.env.npm_execpath;
const children = new Set();
let shuttingDown = false;

function startService(script) {
  if (npmExecPath) {
    return spawn(process.execPath, [npmExecPath, 'run', script], {
      stdio: 'inherit', windowsHide: true, env: process.env,
    });
  }
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run ${script}`]
    : ['run', script];
  return spawn(command, args, { stdio: 'inherit', windowsHide: true, env: process.env });
}

function stopTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) stopTree(child);
  const fallback = setTimeout(() => process.exit(exitCode), 3_000);
  fallback.unref();
  Promise.all([...children].map((child) => new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once('exit', resolve);
  }))).then(() => process.exit(exitCode));
}

console.log(`Starting ${services.map((service) => service.label).join(', ')} development services...`);
for (const service of services) {
  let child;
  try {
    child = startService(service.script);
  } catch (error) {
    console.error(`[dev:all] Failed to start ${service.label}:`, error.message);
    shutdown(1);
    break;
  }
  children.add(child);
  child.on('error', (error) => {
    console.error(`[dev:all] Failed to start ${service.label}:`, error.message);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(`[dev:all] ${service.label} stopped${signal ? ` (${signal})` : ` with exit code ${code ?? 1}`}.`);
    shutdown(code ?? 1);
  });
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
