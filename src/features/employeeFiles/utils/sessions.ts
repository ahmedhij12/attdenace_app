// src/features/employeeFiles/utils/sessions.ts

export type PunchType = "in" | "out";

export interface PunchEvent {
  ts: string;                // ISO timestamp
  type?: PunchType;          // may be undefined initially
  device?: string;
}

export interface Session {
  in?: string;
  out?: string;
  device?: string;
}

// Common alias sets we see in the wild
const IN_KEYS = [
  "in", "in_time", "checkin", "datein", "date_in",
  "timein", "time_in", "datetime_in", "punch_in", "enter", "entry"
];

const OUT_KEYS = [
  "out", "out_time", "checkout", "dateout", "date_out",
  "timeout", "time_out", "datetime_out", "punch_out", "exit"
];

// Generic timestamp-ish keys (single-punch feeds)
const TS_KEYS = [
  "ts", "timestamp", "time", "date", "datetime", "at",
  "created_at", "updated_at", "event_time", "log_time",
  // some devices shove both under "datein" / "date_out"
  "datein", "date_in", "dateout", "date_out", "timein", "time_in", "timeout", "time_out"
];

function firstDefined<T = any>(obj: any, keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj && obj[k] != null) return obj[k] as T;
  }
  return undefined;
}

function normalizeType(val: unknown, keyHint?: string): PunchType | undefined {
  if (val === null || val === undefined) return undefined;
  if (typeof val === "number") return val === 1 ? "in" : val === 0 ? "out" : undefined;
  if (typeof val === "boolean") return val ? "in" : "out";

  const s = String(val).trim().toLowerCase();
  if (["in", "checkin", "ci", "enter", "entered", "clockin", "start", "signin"].includes(s)) return "in";
  if (["out", "checkout", "co", "exit", "exited", "clockout", "end", "signout"].includes(s)) return "out";

  // Sometimes keys imply meaning with 1/0 strings
  const key = (keyHint || "").toLowerCase();
  if (["io", "inout", "direction", "action", "status", "mode", "event"].includes(key)) {
    if (["1", "in1", "io1", "true"].includes(s)) return "in";
    if (["0", "out0", "io0", "false"].includes(s)) return "out";
  }
  return undefined;
}

function extractTs(r: any): string | undefined {
  return firstDefined<string>(r, TS_KEYS);
}

function extractDevice(r: any): string | undefined {
  return r?.device ?? r?.dev ?? r?.reader ?? r?.source ?? r?.device_name ?? undefined;
}

/**
 * If rows already look like sessions (contain any IN/OUT columns), normalize
 * aliases to { in, out } and return them. Otherwise, treat as punch events
 * and pair via explicit types; if types are missing entirely, alternate IN/OUT.
 */
export function pairLogsIfNeeded(rows: any[]): any[] {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const r0 = rows[0] || {};
  const looksLikeSessions =
    IN_KEYS.some(k => k in r0) || OUT_KEYS.some(k => k in r0);

  if (looksLikeSessions) {
    // Normalize common alt field names to in/out for display
    return rows.map((r) => {
      const normalized = { ...r };
      const maybeIn = firstDefined<string>(normalized, IN_KEYS);
      const maybeOut = firstDefined<string>(normalized, OUT_KEYS);
      if (maybeIn && !("in" in normalized)) (normalized as any).in = maybeIn;
      if (maybeOut && !("out" in normalized)) (normalized as any).out = maybeOut;
      return normalized;
    });
  }

  // Treat as punch events
  let events: PunchEvent[] = rows.map((r) => {
    // explicit types first
    const type =
      normalizeType(r?.type, "type") ??
      normalizeType(r?.event, "event") ??
      normalizeType(r?.status, "status") ??
      normalizeType(r?.direction, "direction") ??
      normalizeType(r?.io, "io") ??
      normalizeType(r?.action, "action") ??
      undefined;

    // Some feeds sneak the time under in/out keys even in punch mode
    const ts =
      r?.in ?? r?.out ?? extractTs(r);

    return {
      ts: ts ? String(ts) : "",
      type, // may be undefined
      device: extractDevice(r),
    };
  })
  .filter(e => !!e.ts)
  .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  if (events.length === 0) return rows;

  // If NO event has a clear type, fall back to flip-flop pairing IN/OUT
  const anyTyped = events.some(e => e.type === "in" || e.type === "out");
  if (!anyTyped) {
    let next: PunchType = "in";
    events = events.map(e => ({ ...e, type: (next = next === "in" ? "out" : "in") === "out" ? "in" : "out" })); // start as IN
    // The above trick ensures the sequence becomes IN, OUT, IN, OUT...
    // (we avoid off-by-one by toggling then flipping back)
    let flip: PunchType = "in";
    events = events.map(e => {
      const out = { ...e, type: flip };
      flip = flip === "in" ? "out" : "in";
      return out;
    });
  }

  // Pair in timestamp order
  const sessions: Session[] = [];
  let open: Session | null = null;

  for (const e of events) {
    if (e.type === "in") {
      if (open) { sessions.push(open); open = null; }
      open = { in: e.ts, device: e.device };
    } else if (e.type === "out") {
      if (open) {
        open.out = e.ts;
        sessions.push(open);
        open = null;
      } else {
        sessions.push({ out: e.ts, device: e.device }); // stray OUT
      }
    }
  }
  if (open) sessions.push(open);

  return sessions;
}
