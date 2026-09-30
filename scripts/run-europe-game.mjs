import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'apps/game-server/src/main.ts'], {
  stdio: 'inherit', windowsHide: true, env: { ...process.env, MAP_KIND: 'europe' },
});
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
