import { MEASUREMENT_VERSION } from './activity-contract.js';
import { localParts, previousDays, qualifyingInterval, scheduled } from './activity-analysis.js';

const TIMEZONE = 'Asia/Colombo';
const mean = rows => rows.length ? Number((rows.reduce((n, r) => n + r.scoreMg, 0) / rows.length).toFixed(6)) : null;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const at = (day, minute) => new Date(Date.parse(`${day}T00:00:00+05:30`) + minute * 60000);
const dateLabel = day => new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, month: 'long', day: 'numeric' }).format(at(day, 720));

// Daily presentation only; never used to decide advisory eligibility.
export function historyPeriod(days, count) {
 const records = days.slice(-count);
 const valid = records.filter(r => r.quality === 'valid' && finite(r.scoreMg));
 const averageMg = mean(valid);
 return { calendarDays: count, start: records[0]?.day ?? null, end: records.at(-1)?.day ?? null,
  validDayCount: valid.length, averageMg,
  days: records.map(r => {
   const percentDifference = r.quality === 'valid' && averageMg > 0 ? (r.scoreMg - averageMg) / averageMg * 100 : null;
   // Red is a visual comparison with this period's mean, never an advisory.
   const classification = r.quality !== 'valid' ? r.quality === 'partial' ? 'partial' : 'noData'
    : percentDifference !== null && percentDifference < -0.000001 ? 'belowAverage' : 'normal';
   return { ...r, percentDifference, classification, statusLabel: {
    belowAverage: 'Below average', normal: 'Normal', partial: 'Partial data', noData: 'No data',
   }[classification] };
  }) };
}

export function dailyHistory({ child, policy, now, intervals, sessions, provenance = 'recorded' }) {
 const today = localParts(now, TIMEZONE).day;
 const dates = previousDays(today, 21).reverse();
 const days = dates.map(day => {
  // Do not reinterpret intervals recorded in a different timezone as Colombo days.
  const keys = Array.from({ length: 48 }, (_, i) => i * 30)
   .filter(m => scheduled({ ...policy, timezone: TIMEZONE }, day, m, m + 30));
  const observed = intervals.filter(r => r.day === day && r.timezone === TIMEZONE);
  const accepted = keys.flatMap(key => {
   const rows = observed.filter(r => r.startMinute === key);
   return rows.length === 1 && qualifyingInterval(rows[0], policy, sessions) ? rows : [];
  });
  const expectedSeconds = keys.length * 1800;
  const validSeconds = accepted.reduce((n, r) => n + r.validSeconds, 0);
  const integral = accepted.reduce((n, r) => n + r.movementIntegral, 0);
  const coveragePercent = expectedSeconds ? validSeconds / expectedSeconds * 100 : null;
  const valid = policy.timezone === TIMEZONE && validSeconds > 0 && coveragePercent + 1e-9 >= policy.minCoveragePercent;
  return { day, scoreMg: valid ? Number((integral / validSeconds * 1000).toFixed(6)) : null,
   quality: valid ? 'valid' : observed.length ? 'partial' : 'noData', coveragePercent,
   validMinutes: validSeconds / 60, expectedMinutes: expectedSeconds / 60,
   observationStart: valid ? at(day, accepted[0].startMinute).toISOString() : null,
   observationEnd: valid ? at(day, accepted.at(-1).startMinute + 30).toISOString() : null };
 });
 return summarizeHistory(child, days, now, provenance, policy.reductionPercent);
}

export function summarizeHistory(child, days, now, provenance, significancePercent = 30) {
 const seven = historyPeriod(days, 7), twentyOne = historyPeriod(days, 21);
 const latest = [...days].reverse().find(r => r.quality === 'valid' && finite(r.scoreMg)) ?? null;
 const percentDifference = latest && seven.averageMg > 0 && latest.day >= seven.start
  ? (latest.scoreMg - seven.averageMg) / seven.averageMg * 100 : null;
 const enough = seven.validDayCount >= 4;
 const lower = enough && percentDifference !== null && percentDifference < -0.000001;
 const status = !latest ? 'noData' : !enough || percentDifference === null ? 'learning'
  : lower ? percentDifference <= -significancePercent ? 'significantlyBelow' : 'slightlyBelow' : 'normal';
 const statusLabel = { noData: 'No recent movement data', learning: 'Still learning the activity pattern',
  significantlyBelow: 'Movement lower than usual', slightlyBelow: 'Movement slightly below recent average',
  normal: 'Movement is within the usual range' }[status];
 const explanation = !latest || !enough || percentDifference === null
  ? "We are still learning the child's usual activity pattern."
  : `${child.name}'s movement on ${dateLabel(latest.day)} was ${lower ? `approximately ${Math.round(Math.abs(percentDifference))}% below` : 'within or above'} the average of the recorded days in the seven-day period (${seven.start} to ${seven.end}).`;
 return { child: { id: child.id, name: child.name }, units: 'mg', metric: 'MAD', measurementVersion: MEASUREMENT_VERSION,
  timezone: TIMEZONE, provenance, sourceLabel: provenance === 'sample' ? 'Sample history' : 'Recorded history',
  asOfDay: localParts(now, TIMEZONE).day, start: days[0]?.day ?? null, end: days.at(-1)?.day ?? null,
  periods: { '7': seven, '21': twentyOne }, lastRecordedDay: latest, percentDifference,
  status, statusLabel, explanation, comparisonRule: 'Below the displayed daily average; not a safety advisory.' };
}

// In-memory fixture intervals and session bounds only. No telemetry/attendance writes.
export function sampleHistory(child, policy, now) {
 const dates = previousDays(localParts(now, TIMEZONE).day, 21).reverse();
 const values = [10.1, 9.9, 10.3, 10.0, 9.8, 10.2, 10.1, 9.9, 10.4, 10.0, 10.2, 9.9, 10.1, 10.0, 10.2, 10.0, 9.8, 10.1, 10.0, 10.1, 6.2];
 const previewPolicy = { ...policy, timezone: TIMEZONE };
 const intervals = [], sessions = [];
 dates.forEach((day, i) => {
  const keys = Array.from({ length: 48 }, (_, k) => k * 30).filter(m => scheduled(previewPolicy, day, m, m + 30));
  if (!keys.length) return;
  sessions.push({ startedAt: at(day, keys[0]), endedAt: at(day, keys.at(-1) + 30) });
  keys.forEach(startMinute => intervals.push({ day, startMinute, utcStart: at(day, startMinute),
   timezone: TIMEZONE, measurementVersion: MEASUREMENT_VERSION, validSeconds: 1800,
   observedSeconds: 1800, movementIntegral: values[i] / 1000 * 1800, clockAmbiguous: false }));
 });
 return dailyHistory({ child, policy: previewPolicy, now, intervals, sessions, provenance: 'sample' });
}

export function previewConfiguration(environment, env = process.env) {
 const enabled = environment === 'development' && env.ENABLE_ACTIVITY_HISTORY_PREVIEW === 'true';
 const day = env.ACTIVITY_HISTORY_PREVIEW_DAY;
 if (enabled && day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day)) {
  throw new Error('ACTIVITY_HISTORY_PREVIEW_DAY must be a calendar date');
 }
 return { enabled, childId: env.ACTIVITY_HISTORY_PREVIEW_CHILD_ID || null, day: enabled ? day : null };
}

// Called only AFTER the route's Guardian/Teacher/center authorization succeeds.
export async function previewAvailable(db, child, config) {
 // Require an operator-pinned, actual child ID. A flag or a matching name alone
 // must never enable fixtures for another center's Demo Child or a namesake.
 if (!config?.enabled || !config.childId || child.id !== config.childId || child.name.trim().toLowerCase() !== 'demo child') return false;
 const matches = await db.child.findMany({ where: { id: config.childId, centerId: child.centerId, name: { equals: 'Demo Child', mode: 'insensitive' } },
  select: { id: true }, take: 2 });
 return matches.length === 1 && matches[0].id === child.id;
}
