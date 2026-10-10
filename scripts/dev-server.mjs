// Runs the API with tsx watch. On WSL's /mnt/* drives inotify doesn't fire, so poll there.
import { spawn } from 'node:child_process';

const env = { ...process.env };
if (process.cwd().startsWith('/mnt/')) {
  env.CHOKIDAR_USEPOLLING = '1';
  env.CHOKIDAR_INTERVAL = '600';
}
const child = spawn('npx', ['tsx', 'watch', '--clear-screen=false', 'server/index.ts'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
