import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createDemo } from './scenario.ts';

// Deliberately no .env loading and no real token/client-origin override.
await access(new URL('../dist/client/index.html', import.meta.url)).catch(() => {
  throw new Error('Build the UI first: npm run build');
});
const app = await createDemo(true);
try { await app.collect(); } catch (error) { await app.close(); throw error; }
app.setMode('denied');
console.log(`\nSYNTHETIC MOCK DEMO — no GitLab.com requests, no real token, temporary database.\nOpen ${app.base}\nProjects: 1 protected, 2 unprotected, 3 empty. A complete baseline is already saved.\nThe mock now denies project 1's protection-rules request with HTTP 403.\nIn the UI, click Start collection, then inspect project 1's partial result.\nType recover here, then collect again in the UI to demonstrate recovery.\nCommands: fail | recover | status | quit\nDatabase and history are deleted when this demo stops.\n`);
const input = createInterface({ input: process.stdin, output: process.stdout });
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  input.close(); process.stdin.pause();
  if (!process.stdin.isTTY) process.stdin.destroy();
  await app.close();
}
input.on('line', line => {
  const command = line.trim().toLowerCase();
  if (command === 'quit') { void stop(); return; }
  if (command !== 'status' && app.store.getActiveRun()) {
    console.log('Wait for the active collection to finish before changing the fixture.'); return;
  }
  if (command === 'fail') app.setMode('denied');
  else if (command === 'recover') app.setMode('healthy');
  else if (command !== 'status') { console.log('Use fail, recover, status, or quit.'); return; }
  console.log(`Mock mode: ${app.getMode()}. Changes apply to the next UI collection.`);
});
input.on('close', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
