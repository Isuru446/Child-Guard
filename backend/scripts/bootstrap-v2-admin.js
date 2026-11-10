import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { bootstrapFirstAdmin, confirmationPhrase } from '../src/first-admin-bootstrap.js';

function question(label) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolveAnswer, reject) => {
    let answered = false;
    rl.once('close', () => { if (!answered) reject(Error()); });
    rl.question(label, value => { answered = true; rl.close(); resolveAnswer(value); });
  });
}
function hiddenPassword(label) {
  const stdin = process.stdin;
  return new Promise((resolveAnswer, reject) => {
    let value = '';
    const wasRaw = stdin.isRaw;
    const cleanup = () => {
      stdin.off('keypress', keypress); stdin.off('end', abort); stdin.off('error', abort);
      stdin.setRawMode(Boolean(wasRaw)); stdin.pause(); process.stdout.write('\n');
    };
    const abort = () => { value = ''; cleanup(); reject(Error()); };
    const keypress = (text, key = {}) => {
      if ((key.ctrl && ['c', 'd'].includes(key.name)) || key.name === 'escape') return abort();
      if (key.name === 'return' || key.name === 'enter') {
        const answer = value; value = ''; cleanup(); resolveAnswer(answer); return;
      }
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) {
        value += text;
        if (value.length > 200 || Buffer.byteLength(value, 'utf8') > 200) abort();
      }
    };
    process.stdout.write(label);
    emitKeypressEvents(stdin); stdin.setRawMode(true);
    stdin.on('keypress', keypress); stdin.once('end', abort); stdin.once('error', abort); stdin.resume();
  });
}

let input;
try {
  // Reject arguments, pipes, copies and other workspaces before loading private
  // configuration, Prisma or prompting for any credentials.
  const backend = 'D:\\ChildGuard-V2\\backend';
  if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY ||
      typeof process.stdin.setRawMode !== 'function' || realpathSync.native(process.cwd()) !== backend ||
      realpathSync.native(fileURLToPath(import.meta.url)) !== resolve(backend, 'scripts/bootstrap-v2-admin.js')) throw Error();
  const { loadDevelopmentEnvironment } = await import('../src/development-environment.js');
  const environment = loadDevelopmentEnvironment();
  input = { centerName: (await question('Center name: ')).trim(), username: (await question('Admin username: ')).trim() };
  input.password = await hiddenPassword('Password (12+ characters, at most 72 UTF-8 bytes): ');
  input.repeatPassword = await hiddenPassword('Repeat password: ');
  input.confirmation = await question(`Type ${confirmationPhrase}: `);
  const { PrismaClient } = await import('@prisma/client');
  const { default: bcrypt } = await import('bcryptjs');
  const result = await bootstrapFirstAdmin({ environment, input, hash: bcrypt.hash,
    createClient: url => new PrismaClient({ datasources: { db: { url } }, log: [] }) });
  console.log(JSON.stringify(result));
} catch {
  console.error('V2 first-admin bootstrap refused; no automatic retry. Details withheld.');
  process.exitCode = 1;
} finally {
  if (input) { input.password = ''; input.repeatPassword = ''; }
}
