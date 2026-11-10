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

