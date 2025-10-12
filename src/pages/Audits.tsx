import { useEffect, useMemo, useState } from "react";
import { getAudits, type AuditItem } from "@/api/audits";
import { useAuthStore } from "@/store/auth";
import { formatLocalDateTime } from "@/features/employeeFiles/utils";

// --- date helpers (date-only, not datetime) ---
const pad = (n: number) => String(n).padStart(2, "0");
const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (ymd: string, n: number) => {
  if (!ymd) return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + n);
  return toYmd(dt);
};

function fmtWhen(v: any) {
  if (v === null || v === undefined) return "—";
  const s = String(v).trim();
  if (!s) return "—";
  // Delegate to shared util that normalizes ISO/SQLite strings to LOCAL time
  return formatLocalDateTime(s);
}

export default function Audits() {
  // UI-only guard; server also enforces admin
  const role = useAuthStore((s) => s.role?.toLowerCase?.() || "manager");
  if (role !== "admin") {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audits</h1>
          <p className="text-muted-foreground mt-1">Read-only audit trail</p>
        </div>
        <div className="card py-12 text-center text-sm">Access denied. This page is only for Admin.</div>
      </div>
    );
  }

  const [items, setItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to one full month: 2025-09-01 -> 2025-09-30
  const [fromUI, setFromUI] = useState<string>("2025-09-01");
  const [toUI, setToUI] = useState<string>("2025-09-30");

  const [actor, setActor] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [action, setAction] = useState<string>("");

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null | undefined>(undefined);

  // Build query: server expects from inclusive, to exclusive
  const query = useMemo(
    () => ({
      from: fromUI || undefined,
      to: toUI ? addDays(toUI, 1) : undefined, // exclusive upper bound so the last day is included
      actor: actor || undefined,
      employee_code: code || undefined,
      action: action || undefined,
      page,
      limit,
    }),
    [fromUI, toUI, actor, code, action, page, limit]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    getAudits(query, ctrl.signal)
      .then((res) => {
        setItems(res.items || []);
        setHasMore(!!res.has_more);
        setTotal(res.total);
      })
      .catch((e: any) => {
        if (e?.name !== "AbortError") setError(e?.message || "Failed to load audits");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [query]);

  function applyFilters() {
    setPage(1);
  }
  function onEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") applyFilters();
  }

  // --- Export CSV (new) ---
  function exportCsv() {
    const params = new URLSearchParams();
    if (fromUI) params.set("from", fromUI);
    if (toUI) params.set("to", addDays(toUI, 1)); // keep same inclusive UX as table
    if (actor) params.set("actor", actor);
    if (code) params.set("employee_code", code);
    if (action) params.set("action", action);
    // no page/limit -> backend exports all rows for current filter
    const url = `/audits/export?${params.toString()}`;
    window.open(url, "_blank");
  }

  const inputCls =
    "w-full px-3 py-2.5 bg-background border border-border rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all duration-200 text-sm text-foreground dark:[color-scheme:dark]";
  const pillBtn =
    "px-3 py-2 bg-background border border-border rounded-lg text-sm shadow-sm hover:shadow-md transition-all duration-200";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audits</h1>
          <p className="text-muted-foreground mt-1">Read-only trail of sensitive actions and system changes</p>
        </div>
        <div className="px-3 py-1.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">
          Audit Trail
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500"></div>
              <h3 className="font-semibold text-lg">Audit Filters</h3>
            </div>
            <p className="text-sm text-muted-foreground">Filter audit events by time, actor, employee, or action type</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-7 gap-4 items-end">
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">From</label>
            <input type="date" value={fromUI} onChange={(e) => setFromUI(e.target.value)} onKeyDown={onEnter} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">To</label>
            <input type="date" value={toUI} onChange={(e) => setToUI(e.target.value)} onKeyDown={onEnter} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">Actor</label>
            <input type="text" value={actor} onChange={(e) => setActor(e.target.value)} onKeyDown={onEnter} placeholder="hr, accountant…" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">Employee Code</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onEnter} placeholder="Code…" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground block mb-2">Action</label>
            <input type="text" value={action} onChange={(e) => setAction(e.target.value)} onKeyDown={onEnter} placeholder="Edit/Transfer/Delete…" className={inputCls} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={applyFilters}
              className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 text-sm"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                setFromUI("2025-09-01");
                setToUI("2025-09-30");
                setActor("");
                setCode("");
                setAction("");
                setLimit(50);
                setPage(1);
              }}
              className={pillBtn}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={loading || items.length === 0}
              title={items.length === 0 ? "No rows to export" : "Download CSV"}
              className={`${pillBtn} ${loading || items.length === 0 ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Pagination */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Page</span>
            <button disabled={page <= 1} className={pillBtn} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </button>
            <span className="px-3 py-2 bg-muted rounded-lg text-sm font-medium">{page}</span>
            <button disabled={!hasMore} className={pillBtn} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Rows per page</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(parseInt(e.target.value || "50", 10));
                setPage(1);
              }}
              className="px-3 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all duration-200 text-sm text-foreground dark:[color-scheme:dark]"
            >
              {[25, 50, 100, 150, 200].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {typeof total === "number" && (
              <span className="text-sm text-muted-foreground">
                Total: <span className="font-bold text-amber-600 dark:text-amber-400">{total}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-6 py-4 rounded-2xl shadow-lg">
          {error}
        </div>
      )}

      {/* Results */}
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <h3 className="font-semibold text-lg">Audit Events</h3>
            </div>
            <p className="text-sm text-muted-foreground">Chronological record of system actions and changes</p>
          </div>
          <div className="text-sm text-muted-foreground">
            {items.length} event{items.length !== 1 ? "s" : ""} found
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Employee</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                {/* <th className="px-3 py-2 font-medium">Details</th> */}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={6}>
                    Loading audit events...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-muted-foreground" colSpan={6}>
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">📋</div>
                      No audit events found
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((it, idx) => (
                  <tr key={idx} className="hover:bg-muted/50 transition-colors border-b border-border/50">
                    <td className="px-3 py-3 font-mono text-xs">{fmtWhen(it.created_at)}</td>
                    <td className="px-3 py-3 font-medium">{it.actor ?? "—"}</td>
                    <td className="px-3 py-3">
                      {(() => {
                        const code = (it as any).employee_code || null;
                        const uid = it.employee_uid || null;
                        if (it.employee_name) {
                          const tag = code ?? uid ?? "—";
                          return `${it.employee_name} (${tag})`;
                        }
                        return code ?? uid ?? "—";
                      })()}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                        {it.action}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {typeof it.amount_iqd === "number" ? it.amount_iqd.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{it.reason ?? "—"}</td>
                    {/* <td className="px-3 py-3 max-w-[32rem] truncate text-muted-foreground" title={it.details ?? ""}>
                      {it.details ?? "—"}
                    </td> */}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
