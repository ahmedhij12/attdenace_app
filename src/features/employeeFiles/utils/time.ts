// src/features/employeeFiles/utils/time.ts

/** Safe cast to Date (accepts ISO strings, epoch numbers, or Date) */
export function toDate(value: string | number | Date): Date {
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

/** 2025-09-18 14:05 (24h) — local time */
export function formatLocalDateTime(
  value: string | number | Date,
  opts?: Intl.DateTimeFormatOptions
): string {
  const d = toDate(value);
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...opts,
  };
  return d.toLocaleString(undefined, options);
}

/** 2025-09-18 — local date */
export function formatLocalDate(value: string | number | Date): string {
  return formatLocalDateTime(value, {
    hour: undefined,
    minute: undefined,
  });
}

/** 14:05 or 14:05:33 — local time */
export function formatLocalTime(
  value: string | number | Date,
  withSeconds = false
): string {
  return formatLocalDateTime(value, {
    year: undefined,
    month: undefined,
    day: undefined,
    second: withSeconds ? "2-digit" : undefined,
  });
}

/** Duration in whole minutes between two timestamps (>= 0) */
export function minutesBetween(
  start: string | number | Date,
  end: string | number | Date
): number {
  const ms = Math.max(0, toDate(end).getTime() - toDate(start).getTime());
  return Math.round(ms / 60000);
}

/** Formats minutes like 1h 23m (or 0m) */
export function formatMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes || 0));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0 && rem > 0) return `${h}h ${rem}m`;
  if (h > 0) return `${h}h`;
  return `${rem}m`;
}
