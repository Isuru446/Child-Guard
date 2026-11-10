import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { dailyHistory, historyPeriod, sampleHistory, previewConfiguration, previewAvailable } from '../src/activity-history.js';
import { DEFAULT_ACTIVITY_POLICY, MEASUREMENT_VERSION } from '../src/activity-contract.js';
import { activityReadView } from '../src/activity.js';

const child = { id: 'fixture-demo-child', name: 'Demo Child', centerId: 'center-a' };
const now = new Date('2026-10-28T12:00:00+05:30');
const policy = { ...DEFAULT_ACTIVITY_POLICY };
const sample = () => sampleHistory(child, policy, now);
const at = (day, minute) => new Date(Date.parse(`${day}T00:00:00+05:30`) + minute * 60000);

describe('shared completed-calendar-day presentation', () => {
 it('returns exactly 21 days and the cross-client contract, deterministically', () => {
  const result = sample();
  expect(result).toEqual(sample());
  expect(result).toEqual(JSON.parse(readFileSync(new URL('./fixtures/activity-history.contract.json', import.meta.url))));
  expect(result.periods['21'].days).toHaveLength(21);
  expect([result.start, result.end]).toEqual(['2026-10-07', '2026-10-27']);
  expect(result.units).toBe('mg');
  expect(result.measurementVersion).toBe(MEASUREMENT_VERSION);
  expect(result.provenance).toBe('sample');
 });
 it('computes 9.26 from five valid days, not seven, with only October 27 red', () => {
  const result = sample(), seven = result.periods['7'];
  expect(seven.averageMg).toBe(9.26);
  expect(seven.averageMg.toFixed(1)).toBe('9.3');
  expect(seven.validDayCount).toBe(5);
  expect(seven.days.map(d => d.scoreMg)).toEqual([10.2, 10, 9.8, null, null, 10.1, 6.2]);
  expect(seven.days.filter(d => d.classification === 'belowAverage').map(d => d.day)).toEqual(['2026-10-27']);
  expect(seven.days.filter(d => d.classification === 'normal')).toHaveLength(4);
  expect(seven.days.filter(d => d.classification === 'noData').map(d => d.day)).toEqual(['2026-10-24', '2026-10-25']);
  expect(Math.round(result.percentDifference)).toBe(-33);
  expect(result.lastRecordedDay.scoreMg).toBe(6.2);
  expect(result.explanation).toContain('October 27');
 });
 it('uses a different data-driven 21-day mean and retains every missing position', () => {
  const result = sample();
  expect(result.periods['21'].averageMg).not.toBe(result.periods['7'].averageMg);
  expect(result.periods['21'].days.filter(r => r.quality === 'valid')).toHaveLength(15);
  expect(result.periods['21'].days.filter(r => r.classification === 'noData')).toHaveLength(6);
 });
 it('follows the configured monitoring calendar and quiet periods', () => {
  const result = sampleHistory(child, { ...policy, weekdays: [1, 3, 5], quietPeriods: [{ startMinute: 720, endMinute: 780 }] }, now);
  expect(result.periods['7'].days.at(-1).quality).toBe('noData');
  expect(result.periods['7'].validDayCount).toBe(3);
  expect(result.status).toBe('learning');
  expect(result.periods['7'].days[0].expectedMinutes).toBe(480);
 });
 it('uses Colombo boundaries even before UTC midnight', () => {
  const result = sampleHistory(child, policy, new Date('2026-10-27T19:00:00Z'));
  expect(result.asOfDay).toBe('2026-10-28');
  expect(result.end).toBe('2026-10-27');
 });
 it('never averages missing/partial scores or divides by zero', () => {
  const rows = [{ day: 'a', quality: 'valid', scoreMg: 10 }, { day: 'b', quality: 'partial', scoreMg: null }, { day: 'c', quality: 'noData', scoreMg: null }];
  expect(historyPeriod(rows, 7).averageMg).toBe(10);
  expect(historyPeriod([], 7).averageMg).toBeNull();
  expect(historyPeriod([{ quality: 'valid', scoreMg: 0 }], 7).days[0].percentDifference).toBeNull();
 });
 it('requires full-day coverage, valid sessions, correct version and normalized duration-weighted scores', () => {
  const p = { ...policy, startMinute: 600, endMinute: 660 };
  const row = (minute, seconds, mg) => ({ day: '2026-10-27', startMinute: minute, utcStart: at('2026-10-27', minute), timezone: p.timezone, measurementVersion: MEASUREMENT_VERSION, validSeconds: seconds, observedSeconds: 1800, movementIntegral: mg / 1000 * seconds });
  const args = { child, policy: p, now, intervals: [row(600, 1800, 10), row(630, 1500, 6)], sessions: [{ startedAt: at('2026-10-27', 600), endedAt: at('2026-10-27', 660) }] };
  expect(dailyHistory(args).lastRecordedDay.scoreMg).toBeCloseTo((10 * 1800 + 6 * 1500) / 3300, 5);
  expect(dailyHistory({ ...args, sessions: [] }).lastRecordedDay).toBeNull();
  expect(dailyHistory({ ...args, intervals: [row(600, 1800, 10)] }).lastRecordedDay).toBeNull();
  for (const change of [{ measurementVersion: 'wrong' }, { clockAmbiguous: true }, { validSeconds: 100 }, { movementIntegral: NaN }]) {
   expect(dailyHistory({ ...args, intervals: args.intervals.map(r => ({ ...r, ...change })) }).lastRecordedDay).toBeNull();
  }
 });
});

describe('read-only development preview isolation', () => {
 it('defaults off, refuses production/test even with the flag, and supports date-pinned demos', () => {
  for (const environment of ['production', 'test', undefined]) expect(previewConfiguration(environment, { ENABLE_ACTIVITY_HISTORY_PREVIEW: 'true' }).enabled).toBe(false);
  expect(previewConfiguration('development', {}).enabled).toBe(false);
  expect(previewConfiguration('development', { ENABLE_ACTIVITY_HISTORY_PREVIEW: 'true', ACTIVITY_HISTORY_PREVIEW_DAY: '2026-10-28' }).enabled).toBe(true);
  expect(() => previewConfiguration('development', { ENABLE_ACTIVITY_HISTORY_PREVIEW: 'true', ACTIVITY_HISTORY_PREVIEW_DAY: '2026-02-30' })).toThrow();
 });
 it('resolves only actual Demo Child records in the authorized center and refuses ambiguous names', async () => {
  const db = { child: { findMany: vi.fn(async () => [{ id: child.id }]) } };
  expect(await previewAvailable(db, child, { enabled: true, childId: child.id })).toBe(true);
  expect(db.child.findMany.mock.calls[0][0].where.centerId).toBe(child.centerId);
  expect(await previewAvailable(db, { ...child, name: 'Another child' }, { enabled: true })).toBe(false);
  db.child.findMany.mockResolvedValue([{ id: child.id }, { id: 'duplicate' }]);
  expect(await previewAvailable(db, child, { enabled: true })).toBe(false);
  expect(await previewAvailable(db, child, { enabled: true, childId: child.id })).toBe(false);
  expect(await previewAvailable(db, child, { enabled: true, childId: 'duplicate' })).toBe(false);
 });
 it('keeps genuine safety state, never writes telemetry/advisories and returns genuine history when disabled', async () => {
  const writes = vi.fn(() => { throw new Error('No writes allowed'); });
  const db = {
   child: { findMany: vi.fn(async () => [{ id: child.id }]) },
   activityPolicy: { findUnique: vi.fn(async () => null) },
   assignment: { findFirst: vi.fn(async () => null) }, attendance: { findUnique: vi.fn(async () => null) },
   activitySummary: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), create: writes },
   activityInterval: { findMany: vi.fn(async () => []), upsert: writes },
   activityAttendanceSession: { findMany: vi.fn(async () => []), upsert: writes },
   activityDaily: { findMany: vi.fn(async () => []), upsert: writes },
   alert: { findUnique: vi.fn(async () => ({ id: 'genuine', createdAt: now, details: { real: true } })), create: writes },
   $queryRaw: vi.fn(async () => [{ now }]), $transaction: writes,
  };
  const preview = { enabled: true, childId: child.id, day: '2026-10-28' };
  const result = await activityReadView(db, child, { preview, source: 'sample' });
  expect(result.dailyHistory.provenance).toBe('sample');
  expect(result.state).toBe('NOT_MONITORING');
  expect(result.latestMeasurement).toBeNull();
  expect(result.alert.id).toBe('genuine');
  expect(writes).not.toHaveBeenCalled();
  const live = await activityReadView(db, child, { preview: { enabled: false } });
  expect(live.dailyHistory.provenance).toBe('recorded');
  expect(live.dailyHistory.lastRecordedDay).toBeNull();
  await expect(activityReadView(db, child, { preview: { enabled: false }, source: 'sample' })).rejects.toMatchObject({ status: 404 });
 });
});
