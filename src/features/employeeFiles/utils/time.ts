// src/features/employeeFiles/utils/time.ts

/** Safe cast to Date (accepts ISO strings, epoch numbers, or Date) */
export function toDate(value: string | number | Date): Date {
  if (value instanceof Date) return isNaN(value.getTime()) ? new Date(0) : value;

  // Normalize common server format "YYYY-MM-DD HH:MM[:SS]" as UTC to avoid browser-dependent parsing
  if (typeof value === "string") {
    const s = value.trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}(?::\d{2})?)$/);
    if (m) {
      const iso = `${m[1]}T${m[2]}Z`;
      const dUtc = new Date(iso);
      if (!isNaN(dUtc.getTime())) return dUtc;
    }
  }

  const d = new Date(value as any);
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
  // NOTE: Enforcing Asia/Baghdad (UTC+3) to match the device and expected local time.
  return d.toLocaleString("en-GB", { timeZone: "Asia/Baghdad", ...options });
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
  opts?: Intl.DateTimeFormatOptions
): string {
  const d = toDate(value);
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: opts?.second ? "2-digit" : undefined,
    hour12: false,
    ...opts,
  };
  // NOTE: Enforcing Asia/Baghdad (UTC+3) to fix the -3 hour offset bug.
  return d.toLocaleString("en-GB", { timeZone: "Asia/Baghdad", ...options });
}

/** Calculates the difference in minutes between two timestamps. */
export function durationMinutes(
  start: string | number | Date,
  end: string | number | Date
): number {
  const ms = Math.max(0, toDate(end).getTime() - toDate(start).getTime());
  return Math.round(ms / 60000);
}

/** Alias for durationMinutes for backward compatibility */
export const minutesBetween = durationMinutes;

/** Formats minutes like 1h 23m (or 0m) */
export function formatMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes || 0));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0 && rem > 0) return `${h}h ${rem}m`;
  if (h > 0) return `${h}h`;
  return `${rem}m`;
}

// FIX: This function was the cause of the -3 hour bug.
// It is being updated to explicitly use the target timezone.
export function toLocalTime(iso: string): string {
  if (!iso) return "";

  // Determine if timestamp is UTC (contains "Z" or "+00:00")
  const isUtc = iso.endsWith("Z") || iso.includes("+00:00");

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  return isUtc
    ? d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Baghdad",
      })
    : d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function toLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "";
  // Ensure consistency in date formatting with the target time zone
  return d.toLocaleDateString([], { timeZone: "Asia/Baghdad" });
}

export function toIsoZ(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}
