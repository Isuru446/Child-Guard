import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

// Database-free HTTP regression tests. No Prisma client, environment loading,
// database connection, persisted account or fixture writes are involved.
const secret = randomUUID() + randomUUID();
const password = 'mock-only-password';
const passwordHash = bcrypt.hashSync(password, 4);
const users = ['PARENT', 'TEACHER', 'ADMIN', 'TRANSPORT'].map(role => ({
 id: randomUUID(), username: `mock-${role}`, role, centerId: 'center-a', active: true, passwordHash,
}));
const [parent, teacher, admin, transport] = users;
const children = [
 { id: randomUUID(), name: 'Mock linked child', centerId: 'center-a', guardians: [parent.id] },
 { id: randomUUID(), name: 'Mock unrelated child', centerId: 'center-a', guardians: [] },
 // A cross-center link must never expand access.
 { id: randomUUID(), name: 'Mock other-center child', centerId: 'center-b', guardians: [parent.id] },
];
const publicChild = ({ id, name, centerId }) => ({ id, name, centerId });
const matches = (row, where) => (!where.id || row.id === where.id)
 && (!where.centerId || row.centerId === where.centerId)
 && (!where.guardians || row.guardians.includes(where.guardians.some.userId));
const db = {
 user: { findUnique: vi.fn(async ({ where }) => users.find(u => where.id ? u.id === where.id : u.username === where.username) ?? null) },
 center: { findUnique: vi.fn(async () => ({ id: 'center-a', name: 'Mock center' })) },
 child: {
  findMany: vi.fn(async ({ where, skip, take }) => children.filter(c => matches(c, where)).slice(skip, skip + take).map(publicChild)),
  findFirst: vi.fn(async ({ where }) => { const c = children.find(c => matches(c, where)); return c ? publicChild(c) : null; }),
 },
 attendance: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
 alert: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
 assignment: { findFirst: vi.fn(async () => null) },
 activityPolicy: { findUnique: vi.fn(async () => null) },
 activitySummary: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
 activityInterval: { findMany: vi.fn(async () => []) },
 activityDaily: { findMany: vi.fn(async () => []) },
 activityAttendanceSession: { findMany: vi.fn(async () => []) },
 $queryRaw: vi.fn(async () => [{ now: new Date('2026-10-23T06:00:00Z') }]),
};
db.$transaction = vi.fn(async work => work(db));
const app = createApp({ db, jwtSecret: secret, logger: { error() {} }, environment: 'test', enableDevAttendanceReset: 'false' });
const sign = (u, options = {}) => jwt.sign({}, secret, { subject: u.id, issuer: 'childguard', audience: 'childguard-app', expiresIn: '1h', ...options });
const get = (path, u = parent) => request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${sign(u)}`);
beforeEach(() => { vi.clearAllMocks(); parent.active = true; });

describe('mobile HTTP authorization with database-free mocks', () => {
 it('authorizes update history before any read, rejecting unrelated children and missing sessions',async()=>{
  for(const c of children.slice(1)) expect((await get(`/mobile/children/${c.id}/updates`)).status).toBe(404);
  expect((await request(app).get(`/api/v1/mobile/children/${children[0].id}/updates`)).status).toBe(401);
  expect(db.$queryRaw).not.toHaveBeenCalled();
 });
 it('serves authenticated child update history when Pickup is not installed without a write or private audit fields',async()=>{
  db.$queryRaw.mockResolvedValueOnce([{id:'saved-audit',kind:'ATTENDANCE_ABSENT:INITIAL:{"reason":"not exported"}',createdAt:new Date('2026-10-28T05:00Z')}]).mockResolvedValueOnce([{installed:false}]);
  const r=await get(`/mobile/children/${children[0].id}/updates?limit=1&offset=0`);
  expect(r.status).toBe(200);expect(r.body.pickupAvailable).toBe(false);
  expect(r.body.data).toEqual([{id:'saved-audit',kind:'ABSENT',createdAt:'2026-10-28T05:00:00.000Z',child:{id:children[0].id,name:children[0].name}}]);
  expect(db.$transaction).not.toHaveBeenCalled();
 });
 it('checks bcrypt login and returns a verifiable role-bound JWT', async () => {
  const response = await request(app).post('/api/v1/auth/login').send({ username: parent.username, password });
  expect(response.status).toBe(200);
  expect(response.body.data.user.role).toBe('PARENT');
  expect(jwt.verify(response.body.data.token, secret, { issuer: 'childguard', audience: 'childguard-app' }).sub).toBe(parent.id);
  expect((await request(app).post('/api/v1/auth/login').send({ username: parent.username, password: 'wrong' })).status).toBe(401);
 });
 it('rejects missing, expired and wrong-audience JWTs before child queries', async () => {
  expect((await request(app).get('/api/v1/mobile/children')).status).toBe(401);
  for (const options of [{ expiresIn: -1 }, { audience: 'other-app' }]) {
   expect((await request(app).get('/api/v1/mobile/children').set('Authorization', `Bearer ${sign(parent, options)}`)).status).toBe(401);
  }
  expect(db.child.findMany).not.toHaveBeenCalled();
 });
 it('rechecks active user state for an already issued JWT', async () => {
  const token = sign(parent);
  parent.active = false;
  expect((await request(app).get('/api/v1/mobile/profile').set('Authorization', `Bearer ${token}`)).status).toBe(401);
 });
 it('returns only the authenticated profile without password hashes', async () => {
  const r = await get('/mobile/profile');
  expect(r.status).toBe(200);
  expect(r.body.data.id).toBe(parent.id);
  expect(r.body.data).not.toHaveProperty('passwordHash');
 });
 it('limits the Parent roster to linked children in the same center', async () => {
  const r = await get('/mobile/children');
  expect(r.status).toBe(200);
  expect(r.body.data).toEqual([publicChild(children[0])]);
 });
 it('uses the authorized child danger filter before pagination without any Teacher acknowledgement dependency',async()=>{
  const r=await get(`/mobile/children/${children[0].id}/alerts?kind=DANGER_ZONE_NEAR&limit=1&offset=0`);expect(r.status).toBe(200);
  expect(db.alert.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{NOT:{kind:'BEACON_SIGNAL_LOST'},kind:'DANGER_ZONE_NEAR',event:{childId:children[0].id,device:{centerId:'center-a'}}},take:1,skip:0,orderBy:[{createdAt:'desc'},{id:'desc'}]}));
  expect(db.$transaction).not.toHaveBeenCalled();expect((await get(`/mobile/children/${children[0].id}/alerts?kind=BLE_NEAR`)).status).toBe(422);
  for(const id of [children[1].id,children[2].id])expect((await get(`/mobile/children/${id}/alerts?kind=DANGER_ZONE_NEAR&limit=1`)).status).toBe(404);
 });
 it('returns recorded wearable and beacon snapshot values and redacts a foreign-center beacon association',async()=>{
  const row={id:randomUUID(),kind:'DANGER_ZONE_NEAR',createdAt:new Date(),details:null,event:{id:randomUUID(),eventId:'recorded-event',eventType:'DANGER_ZONE_NEAR',childId:children[0].id,child:publicChild(children[0]),receivedAt:new Date(),observedAt:new Date(),device:{hardwareId:'ORIGINAL-RECORDED-BELT'},beacon:{id:'beacon',centerId:'center-a',hardwareId:'RECORDED-BEACON',name:'Current label',location:'Current place',kind:'DANGER_ZONE'},payload:{beaconMetadata:{name:'Recorded label',location:'Recorded place',kind:'DANGER_ZONE'}}}};
  db.alert.findMany.mockResolvedValueOnce([row]);const result=await get(`/mobile/children/${children[0].id}/alerts`);expect(result.status).toBe(200);expect(result.body.data[0]).toMatchObject({child:{id:children[0].id},event:{device:{hardwareId:'ORIGINAL-RECORDED-BELT'},beacon:{name:'Recorded label',location:'Recorded place'}}});expect(result.body.data[0]).not.toHaveProperty('checkedByMe');
  db.alert.findMany.mockResolvedValueOnce([{...row,event:{...row.event,beacon:{...row.event.beacon,centerId:'center-b',hardwareId:'FOREIGN-PRIVATE'},payload:{beaconMetadata:{name:'Foreign private name',location:'Foreign private place'}}}}]);
  const hidden=await get(`/mobile/children/${children[0].id}/alerts`);expect(hidden.status).toBe(200);expect(hidden.body.data[0].event.beacon).toBeNull();expect(JSON.stringify(hidden.body)).not.toMatch(/FOREIGN-PRIVATE|Foreign private/);
 });
 it.each([teacher, admin])('allows $role center roster without exposing other centers', async user => {
  const r = await get('/mobile/children', user);
  expect(r.status).toBe(200);
  expect(r.body.data).toEqual(children.slice(0, 2).map(publicChild));
 });
 it.each(['', '/attendance', '/alerts', '/device', '/activity'])('rejects unrelated and cross-center Parent access to child%s', async suffix => {
  for (const id of [children[1].id, children[2].id, randomUUID()]) {
   expect((await get(`/mobile/children/${id}${suffix}`)).status).toBe(404);
  }
 });
 it.each(['', '/attendance', '/alerts', '/device', '/activity'])('rejects other-center Teacher access to child%s', async suffix => {
  expect((await get(`/mobile/children/${children[2].id}${suffix}`, teacher)).status).toBe(404);
 });
 it('returns honest empty history/device/activity projections for an authorized child', async () => {
  const path = `/mobile/children/${children[0].id}`;
  expect((await get(path)).body.data).toEqual(publicChild(children[0]));
  expect((await get(`${path}/attendance`)).body.data).toEqual([]);
  expect((await get(`${path}/alerts`)).body.data).toEqual([]);
  expect((await get(`${path}/device`)).body.data).toBeNull();
  const activity = await get(`${path}/activity`);
  expect(activity.status).toBe(200);
  expect(activity.body.data.latestMeasurement).toBeNull();
  expect(activity.body.data.history).toEqual([]);
 });
 it('blocks Parent staff reads and attendance approval before any transaction', async () => {
  for (const path of ['/devices', '/attendance', '/beacons', '/alerts', '/activity/children']) expect((await get(path)).status).toBe(403);
  expect((await request(app).post(`/api/v1/attendance/${randomUUID()}/confirm`).set('Authorization', `Bearer ${sign(parent)}`).send({})).status).toBe(403);
  expect(db.$transaction).not.toHaveBeenCalled();
 });
 it('scopes Teacher confirmation lookup to the teacher center', async () => {
  const id = randomUUID();
  const r = await request(app).post(`/api/v1/attendance/${id}/confirm`).set('Authorization', `Bearer ${sign(teacher)}`).send({});
  expect(r.status).toBe(404);
  expect(db.attendance.findFirst).toHaveBeenCalledWith({ where: { id, child: { centerId: teacher.centerId } } });
 });
 it('rejects Transport mobile access and malformed resource queries', async () => {
  expect((await get('/mobile/profile', transport)).status).toBe(403);
  expect((await get('/mobile/children/not-a-uuid')).status).toBe(422);
  expect((await get('/mobile/children?limit=101')).status).toBe(422);
  expect((await get(`/mobile/children/${children[0].id}/attendance?day=2026-02-30`)).status).toBe(422);
 });
});
