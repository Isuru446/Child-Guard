import { vi } from 'vitest';

// Importing a real database client or development .env loader is a regression
// in these suites. Guard constructors as well as accidental source imports.
vi.mock('@prisma/client', () => {
  throw new Error('Isolated review refuses the real Prisma client');
});
vi.mock('../../src/development-environment.js', () => {
  throw new Error('Isolated review refuses private environment loading');
});
