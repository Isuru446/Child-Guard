// Explicit node --test entry: built-ins only, no dependency installation needed.
import test from 'node:test';
import { registerDatabaseSafetyTests } from './database-safety-cases.js';
registerDatabaseSafetyTests(test);
