const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const envPath = path.join(root, 'backend', '.env');
const settings = fs.existsSync(envPath) ? require('../backend/node_modules/dotenv').parse(fs.readFileSync(envPath)) : {};
const apiPort = process.env.PORT || settings.PORT || '5000';
const apiHost = process.env.HOST || settings.HOST || '127.0.0.1';
const apiUrl = `http://${apiHost === '0.0.0.0' ? '127.0.0.1' : apiHost}:${apiPort}`;
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
function launch(args, directory, env = process.env) {
  const child = spawn(process.execPath, args, { cwd: path.join(root, directory), stdio: 'inherit', env });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
  return child;
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
async function apiReady() {
  try {
    const response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
    const data = await response.json();
    return response.ok && data.status === 'ok' && typeof data.emailConfigured === 'boolean' && typeof data.smsConfigured === 'boolean';
  } catch { return false; }
}
async function main() {
  if (await apiReady()) {
    console.log(`Using the running Haven API at ${apiUrl}.`);
  } else {
    console.log('Starting the Haven API. Waiting for the database and API before opening the frontend...');
    launch(['--watch', 'server.js'], 'backend');
    const deadline = Date.now() + 15000;
    while (!stopping && !await apiReady()) {
      if (Date.now() >= deadline) throw new Error('The API could not start. Check that MariaDB is running and backend/.env has the correct database settings.');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  if (!stopping) launch(['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], 'frontend',
    { ...process.env, HAVEN_API_TARGET: apiUrl });
}
main().catch(error => { console.error(error.message); stop(1); });
