import {createConnectionMonitor,connectionSettings} from './wearable-connection.js';
import {createMonitoringHub} from './monitoring-events.js';
import { createHmac } from 'node:crypto';
import { SessionService } from './admin-session-service.js';
import { adminSessionRepository } from './admin-session-repository.js';
import { adminCookieTransport } from './admin-session-http.js';
import { prepareAdminSessionCutover } from './admin-session-cutover.js';
import { resetEnabled } from './attendance-reset.js';
import { PrismaClient } from '@prisma/client';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadDevelopmentEnvironment } from './development-environment.js';
import { withDatabaseAdmission } from './database-admission.js';

let db,connectionMonitor;
export let server;
try {
 const environment = loadDevelopmentEnvironment();
 // Pin Prisma to the validated URL, irrespective of implicit .env discovery.
 db = new PrismaClient({datasources:{db:{url:environment.DATABASE_URL}}, log:[]});
 await withDatabaseAdmission(db, environment.DATABASE_URL, 'development', environment, () => {
  // Existing modules use optional process settings; apply only after admission.
  for (const [name,value] of Object.entries(environment)) process.env[name] = value;
  // WP02-D owner-approved: 300-second genuine idle, eight-hour absolute ceiling.
  const absoluteAdminPolicy = 'OWNER_ACCEPTED_ADMIN_8H_CEILING';
  const csrfKey=createHmac('sha256',environment.JWT_SECRET).update('childguard-admin-csrf-key-v1').digest();
  const service=new SessionService({repository:adminSessionRepository(db),csrfKey});
  const prepared=prepareAdminSessionCutover({db,service,jwtSecret:environment.JWT_SECRET,
   transport:adminCookieTransport({mode:'local-development',environment:environment.NODE_ENV,origin:'http://localhost:5174'}),
   devAttendanceResetEnabled:resetEnabled(environment.NODE_ENV,environment.ENABLE_DEV_ATTENDANCE_RESET),absoluteAdminPolicy});
  const monitoringHub=createMonitoringHub();
  const settings=connectionSettings(environment);
  connectionMonitor=createConnectionMonitor({db,hub:monitoringHub,settings});
  server = createServer(createApp({monitoringHub,connectionMonitor, db:prepared.database,adminAuthRouter:prepared.router,jwtSecret:environment.JWT_SECRET,
   corsOrigins:(environment.CORS_ORIGINS || 'http://localhost:5174').split(',')}));
  server.on('error', async () => {
   connectionMonitor?.stop();
   console.error('V2 API listener failed; details withheld');
   await db.$disconnect().catch(() => {});
   process.exitCode = 1;
  });
  server.listen(Number(environment.PORT || 3100), environment.CHILDGUARD_LAN_HOST || environment.HOST || '127.0.0.1',
   () => {connectionMonitor.start();console.info('ChildGuard V2 API listening');});
 });
} catch {
 connectionMonitor?.stop();
 console.error('V2 API startup refused; verify V2 configuration and database admission privately. Details withheld.');
 await db?.$disconnect().catch(() => {});
 process.exitCode = 1;
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => {
 connectionMonitor?.stop();
 if (server?.listening) server.close(async () => { await db.$disconnect().catch(() => {}); process.exit(0); });
});
