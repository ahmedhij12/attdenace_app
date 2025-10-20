import * as React from "react";
import { useAuthStore } from '@/store/auth'
import { api } from '@/api/client'   
import { formatLocalTime } from '@/features/employeeFiles/utils/time';


type Props = { empId: number; uid: string; month: string }; // YYYY-MM

type LateEvent = {
  date: string;
  check_in?: string | null;
  auto_penalty_iqd: number;
  final_penalty_iqd: number;
  rule?: string | null;
  override?: { id?: number; mode: "set" | "delta"; amount_iqd: number; note?: string | null } | null;
};

function unwrap(res: any) {
  return res && typeof res === "object" && "data" in res ? (res as any).data : res;
}

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

function fmtLocal(dt?: string | null) {
  return dt ? formatLocalTime(dt) : "—";  // ✅ use dt, not s
}


export default function LateOverridesTab({ empId, uid, month }: Props) {
  const role = (useAuthStore((s: any) => s.role) || "").toLowerCase();
  const canEdit = role === "admin" || role === "hr";

  const [rows, setRows] = React.useState<LateEvent[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // per-row UI state
  const [editing, setEditing] = React.useState<Record<string, boolean>>({});
  const [draft, setDraft] = React.useState<Record<string, number>>({});  // final amount
  const [notes, setNotes] = React.useState<Record<string, string>>({});  // reason/note (by date)



  // StrictMode-safe loader with payroll fallback
  const seq = React.useRef(0);
  const load = React.useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const { from, to } = monthRange(month);

      let data: any = null;
      
      // Try employee_files proxy first, then direct payroll using API client
      try {
        data = await api.get(`/employee_files/${empId}/late_events`, { from, to });
      } catch (err: any) {
        console.warn('Employee files proxy failed:', err?.message || err);
        
        // Fallback to direct payroll endpoint
        try {
          data = await api.get('/payroll/late_events', { employee_id: empId, from, to });
        } catch (err2: any) {
          console.warn('Direct payroll failed:', err2?.message || err2);
          throw err2; // Re-throw the last error
        }
      }

      if (seq.current !== my) return;

      if (!Array.isArray(data)) {
        setRows([]);
        setError("Late events API not available.");
      } else {
        const list: LateEvent[] = data.map((e: any) => ({
          date: e.date,
          check_in: e.check_in ?? null,
          auto_penalty_iqd: Number(e.auto_penalty_iqd ?? e.auto ?? 0),
          final_penalty_iqd: Number(e.final_penalty_iqd ?? e.final ?? e.auto ?? 0),
          rule: e.rule ?? null,
          override: e.override
            ? {
                id: e.override.id ? Number(e.override.id) : undefined,
                mode: (e.override.mode || "set") as "set" | "delta",
                amount_iqd: Number(e.override.amount_iqd || 0),
                note: e.override.note ?? null,
              }
            : null,
        }));

        setRows(list);
        setEditing({});
        const next: Record<string, number> = {};
        const nextNotes: Record<string, string> = {};
        list.forEach(ev => {
          next[ev.date] = ev.final_penalty_iqd;
          nextNotes[ev.date] = ev.override?.note ?? "";
        });
        setDraft(next);
        setNotes(nextNotes);
      }
    } catch (err: any) {
      if (seq.current !== my) return;
      setError(err?.message || "Failed to load late events.");
      setRows([]);
      setEditing({});
      setDraft({});
      setNotes({});
    } finally {
      if (seq.current === my) setLoading(false);
    }
  }, [empId, month]);

  React.useEffect(() => { load(); }, [load]);

  // --- API helpers using correct endpoints
  async function createOverride(payload: {
    uid: string; date: string; mode: "set" | "delta"; amount_iqd: number; note?: string;
  }) {
    const res = await api.post("/payroll/late_override", payload);
    return unwrap(res); // may be { id } or { data: { id } }
  }
  
  async function updateOverride(id: number, payload: {
    date: string; mode: "set" | "delta"; amount_iqd: number; note?: string;
  }) {
    const res = await api.put(`/payroll/late_override/${id}`, payload);
    return unwrap(res);
  }
  
  async function deleteOverrideById(id: number, reason: string) {
    const q = encodeURIComponent(reason);
    const res = await api.del(`/payroll/late_override/${id}?reason=${q}`);
    return unwrap(res);
  }

  const getReason = (date: string) => (notes[date] ?? "").trim();

  // Save desired final amount (0 removes). If equals auto → delete override; else set exact amount.
  async function saveFinal(date: string) {
    const row = rows.find(r => r.date === date);
    if (!row) return;

    const auto = Number(row.auto_penalty_iqd || 0);
    const desired = Math.max(0, Number(draft[date] ?? row.final_penalty_iqd));
    const reason = getReason(date);

    if (!canEdit) return;
    if (!reason) { window.alert("Reason is required"); return; }

    if (desired === auto) {
      // Delete override if present (back to auto)
      if (row.override?.id) {
        await deleteOverrideById(Number(row.override.id), reason);
      }
      setRows(rs => rs.map(r => r.date === date ? { ...r, final_penalty_iqd: auto, override: null } : r));
      setEditing(ed => ({ ...ed, [date]: false }));
      return;
    }

    if (!row.override?.id) {
      // create
      const created: any = await createOverride({ uid, date, mode: "set", amount_iqd: desired, note: reason });
      const newId =
        (created && typeof created.id !== "undefined" && Number(created.id)) ||
        (created && created.data && Number(created.data.id)) ||
        undefined;

      setRows(rs => rs.map(r =>
        r.date === date
          ? { ...r, final_penalty_iqd: desired, override: { id: newId, mode: "set", amount_iqd: desired, note: reason } }
          : r
      ));
    } else {
      // update
      const id = Number(row.override.id);
      await updateOverride(id, { date, mode: "set", amount_iqd: desired, note: reason });
      setRows(rs => rs.map(r =>
        r.date === date
          ? { ...r, final_penalty_iqd: desired, override: { id, mode: "set", amount_iqd: desired, note: reason } }
          : r
      ));
    }

    setEditing(ed => ({ ...ed, [date]: false }));
  }

  
  async function deleteOverride(date: string) {
    const row = rows.find(r => r.date === date);
    const id = row?.override?.id;
    if (!id || !canEdit) return;

    let reason = getReason(date);
    if (!reason) {
      const r = window.prompt("Delete reason (required):", "");
      if (r == null || !r.trim()) return;
      reason = r.trim();
      setNotes(ns => ({ ...ns, [date]: reason }));
    }

    await deleteOverrideById(Number(id), reason);
    setRows(rs => rs.map(r => r.date === date ? { ...r, final_penalty_iqd: r.auto_penalty_iqd, override: null } : r));
    setDraft(d => ({ ...d, [date]: rows.find(r => r.date === date)?.auto_penalty_iqd || 0 }));
    setEditing(ed => ({ ...ed, [date]: false }));
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Late Overrides</h3>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Edit the amount directly. Saving sets the penalty to that number (0 removes it).
        Delete removes the override and returns to the automatic amount.
      </p>

      {error && <div className="text-red-600 dark:text-red-300">{error}</div>}
      {loading && <div className="p-4">Loading…</div>}

      {!loading && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-600 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr className="text-slate-500 dark:text-slate-400">
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-left px-4 py-2">Check-in</th>
                <th className="text-right px-4 py-2">Auto</th>
                <th className="text-right px-4 py-2">Final</th>
                <th className="text-left px-4 py-2">Reason</th>
                <th className="px-4 py-2 w-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No late events in this month.</td></tr>
              ) : (
                rows.map(ev => {
                  const isEditing = !!editing[ev.date];
                  const value = isEditing ? (draft[ev.date] ?? ev.final_penalty_iqd) : ev.final_penalty_iqd;
                  const reason = notes[ev.date] ?? "";

                  return (
                    <tr key={ev.date} className="border-t border-slate-200 dark:border-slate-600">
                      <td className="px-4 py-2 font-mono">{ev.date}</td>
                      <td className="px-4 py-2">{fmtLocal(ev.check_in)}</td>
                      <td className="px-4 py-2 text-right">{ev.auto_penalty_iqd.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          className={`px-2 py-1 w-28 text-right font-mono rounded border ${!isEditing ? "opacity-70" : ""} bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600`}
                          disabled={!isEditing || !canEdit}
                          value={value}
                          onChange={(e) => setDraft(d => ({ ...d, [ev.date]: Number(e.target.value || 0) }))}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          className={`px-2 py-1 w-64 rounded border ${!isEditing ? "opacity-70" : ""} bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600`}
                          placeholder="Why are you changing this?"
                          disabled={!isEditing || !canEdit}
                          value={reason}
                          onChange={(e) => setNotes(ns => ({ ...ns, [ev.date]: e.target.value }))}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2 justify-end">
                          {!isEditing ? (
                            <>
                              <button
                                type="button"
                                className="px-2 py-1 rounded bg-slate-600 text-white hover:bg-slate-700 disabled:opacity-50"
                                disabled={!canEdit}
                                onClick={() => {
                                  setDraft(d => ({ ...d, [ev.date]: ev.final_penalty_iqd }));
                                  setNotes(ns => ({ ...ns, [ev.date]: ev.override?.note ?? (ns[ev.date] ?? "") }));
                                  setEditing(ed => ({ ...ed, [ev.date]: true }));
                                }}>
                                Edit
                              </button>
                              {ev.override?.id ? (
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                                  disabled={!canEdit}
                                  onClick={() => deleteOverride(ev.date)}>
                                  Delete
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                disabled={!canEdit || !(notes[ev.date] ?? "").trim()}
                                onClick={() => saveFinal(ev.date)}>
                                Save
                              </button>
                              <button
                                type="button"
                                className="px-2 py-1 rounded bg-slate-600 text-white hover:bg-slate-700"
                                onClick={() => {
                                  setEditing(ed => ({ ...ed, [ev.date]: false }));
                                  setDraft(d => ({ ...d, [ev.date]: ev.final_penalty_iqd }));
                                  setNotes(ns => ({ ...ns, [ev.date]: ev.override?.note ?? "" }));
                                }}>
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}