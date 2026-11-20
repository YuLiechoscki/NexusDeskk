import { DateTime } from 'luxon';

const minute = 60_000;

function workWindow(day, calendar) {
  const startOfDay = day.startOf('day');
  if (!calendar.business_days.includes(day.weekday) || calendar.holidays.includes(day.toISODate())) return null;
  const [startHour, startMinute] = calendar.business_start.split(':').map(Number);
  const [endHour, endMinute] = calendar.business_end.split(':').map(Number);
  return [startOfDay.set({ hour: startHour, minute: startMinute }), startOfDay.set({ hour: endHour, minute: endMinute })];
}

export function addBusinessMinutes(start, amount, calendar) {
  let cursor = DateTime.fromJSDate(new Date(start), { zone: calendar.timezone });
  let remaining = amount * minute;
  if (remaining <= 0) return cursor.toJSDate();
  while (true) {
    const window = workWindow(cursor, calendar);
    if (window && cursor < window[1]) {
      const from = Math.max(+cursor, +window[0]);
      const available = +window[1] - from;
      if (available >= remaining) return new Date(Math.round(from + remaining));
      remaining -= available;
    }
    cursor = cursor.plus({ days: 1 }).startOf('day');
  }
}

export function businessMinutesBetween(start, end, calendar) {
  const from = +new Date(start);
  const to = +new Date(end);
  if (from >= to) return 0;
  let day = DateTime.fromMillis(from, { zone: calendar.timezone }).startOf('day');
  let total = 0;
  while (+day < to) {
    const window = workWindow(day, calendar);
    if (window) total += Math.max(0, Math.min(to, +window[1]) - Math.max(from, +window[0]));
    day = day.plus({ days: 1 }).startOf('day');
  }
  return total / minute;
}
