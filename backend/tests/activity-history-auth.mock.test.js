import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createAdminSessionRouter, adminCookieTransport } from '../src/admin-session-http.js';
import { sessionFixture } from './helpers/admin-session-memory.js';

// Entirely in-memory: no Prisma, environment loading, or database connection.
const secret = randomUUID() + randomUUID();
const users = ['PARENT', 'TEACHER', 'ADMIN'].map(role => ({ id: randomUUID(), role, centerId: 'a', active: true }));
const [parent, teacher, admin] = users;
const children = [
 { id: randomUUID(), name: 'Demo Child', centerId: 'a', guardians: [parent.id] },
 { id: randomUUID(), name: 'Other child', centerId: 'a', guardians: [] },
 { id: randomUUID(), name: 'Demo Child', centerId: 'b', guardians: [parent.id] },
];
const matches = (r, w) => (!w.id || r.id === w.id) && (!w.centerId || r.centerId === w.centerId)
 && (!w.guardians || r.guardians.includes(w.guardians.some.userId)) && (!w.name || r.name.toLowerCase() === w.name.equals.toLowerCase());
let app, db;
beforeEach(() => {
 vi.stubEnv('ENABLE_ACTIVITY_HISTORY_PREVIEW', 'true');
 vi.stubEnv('ACTIVITY_HISTORY_PREVIEW_DAY', '2026-10-28');
 vi.stubEnv('ACTIVITY_HISTORY_PREVIEW_CHILD_ID', children[0].id);
 const write = vi.fn(() => { throw new Error('No database writes'); });
 db = {
  user: { findUnique: vi.fn(async ({ where }) => users.find(u => u.id === where.id)) },
  child: { findFirst: vi.fn(async ({ where }) => children.find(c => matches(c, where)) ?? null),
   findMany: vi.fn(async ({ where, take }) => children.filter(c => matches(c, where)).slice(0, take)) },
  activityPolicy: { findUnique: vi.fn(async () => null) },
  assignment: { findFirst: vi.fn(async () => null) }, attendance: { findUnique: vi.fn(async () => null), create: write },
  activitySummary: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), create: write },
  activityInterval: { findMany: vi.fn(async () => []), upsert: write },
  activityAttendanceSession: { findMany: vi.fn(async () => []), upsert: write },
  activityDaily: { findMany: vi.fn(async () => []), upsert: write },
  alert: { findUnique: vi.fn(async () => null), create: write },
  $queryRaw: vi.fn(async () => [{ now: new Date('2026-10-28T06:30:00Z') }]), $transaction: write,
 };
 app = createApp({ db, jwtSecret: secret, environment: 'development', logger: { error() {} } });
});
afterEach(() => vi.unstubAllEnvs());
const get = (path, user = parent, target = app) => request(target).get(path).set('Authorization', `Bearer ${jwt.sign({}, secret, { subject: user.id, issuer: 'childguard', audience: 'childguard-app', expiresIn: '1h' })}`);
const mobile = id => `/api/v1/mobile/children/${id}/activity?source=sample`;

it('requires authentication and Guardian linkage before resolving any preview identity', async () => {
 expect((await request(app).get(mobile(children[0].id))).status).toBe(401);
 for (const child of children.slice(1)) expect((await get(mobile(child.id))).status).toBe(404);
 expect(db.child.findMany).not.toHaveBeenCalled();
 expect(db.activitySummary.findMany).not.toHaveBeenCalled();
});
it('serves the same shared values to linked Parent and center Teacher/Admin', async () => {
 const p = await get(mobile(children[0].id));
 const t = await get(mobile(children[0].id), teacher);
 const a = await get(`/api/v1/activity/children/${children[0].id}?source=sample`, admin);
 expect([p.status, t.status, a.status]).toEqual([200, 200, 200]);
 expect(p.body.data.dailyHistory).toEqual(t.body.data.dailyHistory);
 expect(p.body.data.dailyHistory).toEqual(a.body.data.dailyHistory);
 expect(a.body.data.dailyHistory.periods['7'].averageMg).toBe(9.26);
 expect(db.activitySummary.create).not.toHaveBeenCalled();
 expect(db.alert.create).not.toHaveBeenCalled();
 expect(db.attendance.create).not.toHaveBeenCalled();
});
it('keeps Teachers and Admin within their centers and other children genuine', async () => {
 expect((await get(mobile(children[2].id), teacher)).status).toBe(404);
 expect((await get(`/api/v1/activity/children/${children[2].id}?source=sample`, admin)).status).toBe(404);
 expect((await get(mobile(children[1].id), teacher)).status).toBe(404);
 const r = await get(`/api/v1/mobile/children/${children[1].id}/activity`, teacher);
 expect(r.status).toBe(200);
 expect(r.body.data.dailyHistory.provenance).toBe('recorded');
 expect(r.body.data.historyPreviewAvailable).toBe(false);
});
it('disables preview in production and returns to genuine records after disabling', async () => {
 const production = createApp({ db, jwtSecret: secret, environment: 'production', logger: { error() {} } });
 expect((await get(mobile(children[0].id), parent, production)).status).toBe(404);
 vi.stubEnv('ENABLE_ACTIVITY_HISTORY_PREVIEW', 'false');
 const disabled = createApp({ db, jwtSecret: secret, environment: 'development', logger: { error() {} } });
 expect((await get(mobile(children[0].id), parent, disabled)).status).toBe(404);
 const r = await get(`/api/v1/mobile/children/${children[0].id}/activity`, parent, disabled);
 expect(r.body.data.dailyHistory.provenance).toBe('recorded');
 expect(r.body.data.dailyHistory.lastRecordedDay).toBeNull();
});

it('uses the existing Admin cookie boundary for history with center and origin protection', async () => {
 const f = sessionFixture();
 f.state.user.centerId = 'a';
 const session = await f.login();
 const transport = adminCookieTransport({ mode: 'local-development', environment: 'development', origin: 'http://localhost:5174' });
 const router = createAdminSessionRouter({ db, service: f.service, transport });
 const cookieApp = createApp({ db, jwtSecret: secret, adminAuthRouter: router, environment: 'development', logger: { error() {} } });
 const read = id => request(cookieApp).get(`/api/v1/activity/children/${id}?source=sample`)
  .set('Host', 'localhost:5174').set('Origin', 'http://localhost:5174').set('Cookie', `${transport.name}=${session.credential}`);
 expect((await read(children[0].id)).body.data.dailyHistory.periods['7'].averageMg).toBe(9.26);
 expect((await read(children[2].id)).status).toBe(404);
 expect((await request(cookieApp).get(`/api/v1/activity/children/${children[0].id}?source=sample`)
  .set('Host', 'localhost:5174').set('Origin', 'http://untrusted.invalid').set('Cookie', `${transport.name}=${session.credential}`)).status).toBe(403);
 expect(db.alert.create).not.toHaveBeenCalled();
});
