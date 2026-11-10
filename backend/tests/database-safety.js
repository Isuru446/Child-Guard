// Never load dotenv or Prisma here. Tests supply an explicit test-only URL.
import { validateDatabaseEnvironment, assertDatabaseIdentity } from '../src/database-admission.js';

export function validateTestDatabaseUrl(value, environment = process.env) {
 return validateDatabaseEnvironment(value, 'test', environment);
}

export async function assertTestDatabase(db, environment = process.env) {
 validateTestDatabaseUrl(environment.TEST_DATABASE_URL, environment);
 await assertDatabaseIdentity(db, 'test');
}
