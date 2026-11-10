import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { mergeDevelopmentEnvironment, validateDevelopmentEnvironmentText } from './database-admission.js';

// Read exactly backend/.env, never a cwd-selected or .env.windows file.
export function loadDevelopmentEnvironment(inherited = process.env) {
 try {
  const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (realpathSync(process.cwd()) !== realpathSync(backend) ||
      existsSync(resolve(backend, '../.env')) ||
      existsSync(resolve(backend, '../.env.windows')) ||
      existsSync(resolve(backend, '.env.windows')) ||
      existsSync(resolve(backend, 'prisma/.env'))) throw new Error();
  const path = resolve(backend, '.env');
  let file = {};
  if (existsSync(path)) {
   if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) throw new Error();
   const text = readFileSync(path, 'utf8');
   validateDevelopmentEnvironmentText(text);
   file = dotenv.parse(text);
  }
  return mergeDevelopmentEnvironment(inherited, file);
 } catch {
  throw new Error('V2 development configuration refused; details withheld');
 }
}
