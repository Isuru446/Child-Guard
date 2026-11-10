import {
  initialStudents,
  initialAttendanceRecords,
  STORAGE_KEYS,
} from './mockData';

export const attendanceStorageKeys = {
  children: STORAGE_KEYS.children,
  attendance: STORAGE_KEYS.attendance,
};

export const attendanceMockData = {
  children: initialStudents,
  records: initialAttendanceRecords,
};

/* Sri Lanka current date */

export function getTodayKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const getPart = (type) =>
    parts.find((part) => part.type === type)?.value;

  return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
}

/* Dates belonging to a month */

export function getMonthDates(month) {
  const [year, monthNumber] = month.split('-').map(Number);

  const days = new Date(
    Date.UTC(year, monthNumber, 0)
  ).getUTCDate();

  return Array.from(
    { length: days },
    (_, index) =>
      `${month}-${String(index + 1).padStart(2, '0')}`
  );
}

/* Display formatting */

export function formatMonth(month) {
  return new Date(
    `${month}-01T12:00:00Z`
  ).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDate(date) {
  return new Date(
    `${date}T12:00:00Z`
  ).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/* Date validation */

function isValidDateKey(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T12:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

/* Read saved data, otherwise use mock data */

function readArray(key, fallback) {
  try {
    const saved = localStorage.getItem(key);

    if (saved === null) {
      return fallback;
    }

    const parsed = JSON.parse(saved);

    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/* Support both id and childId */

function normalizeChild(child) {
  if (!child || typeof child !== 'object') {
    return null;
  }

  const childId = String(
    child.childId || child.id || ''
  ).trim();

  if (!childId) {
    return null;
  }

  return {
    ...child,
    childId,
    name: String(child.name ?? ''),
  };
}

/* Shared attendance data */

export function loadAttendanceData() {
  const savedChildren = readArray(
    attendanceStorageKeys.children,
    attendanceMockData.children
  );

  const uniqueChildren = new Map();

  savedChildren.forEach((child) => {
    const normalizedChild = normalizeChild(child);

    if (normalizedChild) {
      uniqueChildren.set(
        normalizedChild.childId,
        normalizedChild
      );
    }
  });

  const children = [...uniqueChildren.values()];

  const childIds = new Set(
    children.map((child) => child.childId)
  );

  const savedRecords = readArray(
    attendanceStorageKeys.attendance,
    attendanceMockData.records
  );

  const uniqueRecords = new Map();

  savedRecords.forEach((record) => {
    if (!record || typeof record !== 'object') {
      return;
    }

    const childId = String(
      record.childId ?? ''
    ).trim();

    if (
      !childIds.has(childId) ||
      !isValidDateKey(record.date) ||
      !['Present', 'Absent'].includes(record.status)
    ) {
      return;
    }

    uniqueRecords.set(
      `${childId}:${record.date}`,
      {
        ...record,
        childId,
        date: record.date,
        status: record.status,
      }
    );
  });

  return {
    children,
    records: [...uniqueRecords.values()],
  };
}