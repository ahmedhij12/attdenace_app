// src/pages/Dashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { getProbationDue } from "@/api/employees";
import type { AttendanceLog, Employee, DeviceInfo } from "@/types/models";
import RoleBadge from "@/components/RoleBadge";
import { useAuthStore } from '@/store/auth';
import { Navigate } from "react-router-dom";
import { formatLocalDateTime } from "@/features/employeeFiles/utils/time";

/** Config */
const OFFLINE_MINUTES = 5;      // device considered offline if no heartbeat for N minutes
const OVERDUE_WINDOW_DAYS = 3;  // include up to 3 days past 90
const UPCOMING_WINDOW_DAYS = 7; // include up to 7 days before 90
const DISMISS_STORE_KEY = "probation_dismissed_v5";

/** Local types */
type Me = {
  username: string;
  email: string;
  role: "admin" | "manager" | string;
  allowed_branches: any[];
};

type ProbationRow = Employee & {
  daysToProbation?: number;
  probationStatus?: string; // "Overdue" | "Soon" | "upcoming"
};

export default function Dashboard() {
  /** core data */
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [probation, setProbation] = useState<ProbationRow[]>([]);

  /** misc state */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** manager scope (kept, but optional) */
  const [me, setMe] = useState<Me | null>(null);
  const isManager = (me?.role || "").toLowerCase() === "manager";
  const allowedBranchesRaw = me?.allowed_branches ?? [];
  const isAccountant = (me?.role || "").toLowerCase() === "accountant";
  const role = useAuthStore(s => s.role?.toLowerCase?.() || 'manager');
  


  /** ----- helpers: dates/keys/normalization ----- */
  const fmtDate = (v: any) => {
    if (!v) return "";
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : d.toISOString().substring(0, 10);
  };

  function daysTo90(joined: any): number {
    if (!joined) return Number.NaN;
    const base = new Date(fmtDate(joined) || "").getTime();
    if (!base) return Number.NaN;
    const ninety = 90 * 24 * 60 * 60 * 1000;
    const diff = base + ninety - Date.now();
    return Math.ceil(diff / (24 * 60 * 60 * 1000));
  }

  function normalizeNameKey(raw: any) {
    return String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  }
  function normDateKey(raw: any) {
    const d = fmtDate(raw);
    return d || "";
  }
  function normalizeBranchKey(raw: any) {
    if (raw == null) return "";
    const s = String(
      typeof raw === "object" ? raw.name ?? raw.title ?? raw.slug ?? raw.branch ?? raw : raw
    )
      .trim()
      .toLowerCase();
    return s.replace(/\s+/g, "");
  }

  /** make a stable identity for an employee-ish row */
  function computeKeyLike(e: any) {
    const id = e?.id ?? e?.employee_id ?? e?.emp_id;
    const uid = e?.uid ?? e?.employee_uid ?? e?.employee?.uid;
    const code = e?.code ?? e?.employee_code ?? e?.employee?.code;
    const name = normalizeNameKey(e?.name || e?.employee?.name);
    const branch = normalizeBranchKey(e?.branch || e?.employee?.branch);
    const joined = normDateKey(e?.joined_at || e?.employee?.joined_at);
    return String(
      (id != null && `id:${id}`) ||
        (uid && `uid:${uid}`) ||
        (code && `code:${code}`) ||
        (name && branch && `nb:${name}|${branch}`) ||
        (name && joined && `nj:${name}|${joined}`) ||
        (name && `n:${name}`) ||
        (branch && `b:${branch}`) ||
        ""
    );
  }

  function includeInWindow(d: any) {
    if (!Number.isFinite(d)) return false;
    const n = Number(d);
    return n >= -OVERDUE_WINDOW_DAYS && n <= UPCOMING_WINDOW_DAYS;
  }

  function findEmployeeMatch(source: Employee[], probe: any): Employee | undefined {
    const pid = probe?.id ?? probe?.employee_id ?? probe?.emp_id;
    if (pid != null) {
      const byId = source.find((e) => String(e.id) === String(pid));
      if (byId) return byId;
    }
    const pcode = probe?.code ?? probe?.employee_code;
    if (pcode) {
      const byCode = source.find((e: any) => String(e.code || "") === String(pcode));
      if (byCode) return byCode;
    }
    const puid = probe?.uid ?? probe?.employee_uid;
    if (puid) {
      const byUid = source.find((e: any) => String(e.uid || "") === String(puid));
      if (byUid) return byUid;
    }
    const pname = normalizeNameKey(probe?.name ?? probe?.employee?.name);
    if (pname) {
      const byName = source.find((e) => normalizeNameKey(e.name) === pname);
      if (byName) return byName;
    }
    return undefined;
  }

  function normalizeProbationItems(items: any[], sourceEmployees: Employee[]): ProbationRow[] {
    return (items || [])
      .map((x: any) => {
        const emp = x?.employee || x?.user || x?.emp || x;
        const match =
          findEmployeeMatch(sourceEmployees, x) ||
          findEmployeeMatch(sourceEmployees, emp) ||
          emp;

        const id = match?.id ?? emp?.id ?? x?.employee_id ?? x?.emp_id;
        const name = match?.name ?? emp?.name ?? x?.name ?? "";
        const branch = match?.branch ?? emp?.branch ?? x?.branch ?? "";
        const uid = (match as any)?.uid ?? (emp as any)?.uid ?? (x as any)?.uid ?? "";
        const code = (match as any)?.code ?? (emp as any)?.code ?? (x as any)?.code ?? "";
        const joined_at =
          (match as any)?.joined_at ?? (emp as any)?.joined_at ?? (x as any)?.joined_at ?? null;

        let d90 =
          (x as any)?.daysToProbation ??
          (x as any)?.days_to_probation ??
          (x as any)?.days_to_90 ??
          (x as any)?.until_90;
        if (!Number.isFinite(d90)) d90 = daysTo90(joined_at);

        const status =
          (x as any)?.probationStatus ??
          (x as any)?.status ??
          (Number.isFinite(d90)
            ? d90 <= 0
              ? "Overdue"
              : d90 <= 3
                ? "Soon"
                : "upcoming"
            : "-");

        return {
          ...(match as any),
          id: id as any,
          name,
          branch,
          uid,
          code,
          joined_at,
          daysToProbation: Number.isFinite(d90) ? Number(d90) : undefined,
          probationStatus: status,
        } as ProbationRow;
      })
      .filter((row: ProbationRow) => row.name && includeInWindow(row.daysToProbation));
  }

  function localProbationFromEmployees(list: Employee[]): ProbationRow[] {
    return (list || [])
      .map((e) => {
        const d90 = daysTo90((e as any).joined_at);
        if (!includeInWindow(d90)) return null;
        return {
          ...(e as any),
          daysToProbation: d90,
          probationStatus: d90 <= 0 ? "Overdue" : d90 <= 3 ? "Soon" : "upcoming",
        } as ProbationRow;
      })
      .filter(Boolean) as ProbationRow[];
  }

  /** ----- dismiss storage (local, forgiving) ----- */
  function readDismissed(): Record<string, string> {
    try {
      const raw = localStorage.getItem(DISMISS_STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function writeDismissed(map: Record<string, string>) {
    try {
      localStorage.setItem(DISMISS_STORE_KEY, JSON.stringify(map));
    } catch {}
  }
  function isDismissed(row: any, resolved?: Employee | null): boolean {
    const map = readDismissed();
    const rid = resolved?.id ?? row?.id;
    const ruid = (resolved as any)?.uid ?? row?.uid;
    const rcode = (resolved as any)?.code ?? row?.code;
    const rname = normalizeNameKey((resolved as any)?.name ?? row?.name);
    const rbranch = normalizeBranchKey((resolved as any)?.branch ?? row?.branch);
    const rjoined = normDateKey((resolved as any)?.joined_at ?? row?.joined_at);
    const candidates = [
      rid != null ? `id:${rid}` : "",
      ruid ? `uid:${ruid}` : "",
      rcode ? `code:${rcode}` : "",
      rname && rbranch ? `nb:${rname}|${rbranch}` : "",
      rname && rjoined ? `nj:${rname}|${rjoined}` : "",
      rname ? `n:${rname}` : "",
      rbranch ? `b:${rbranch}` : "",
    ].filter(Boolean) as string[];
    return candidates.some((k) => !!map[k]);
  }
  function markDismissedFor(rowLike: any, resolved?: Employee | null) {
    const map = readDismissed();

    const rid = resolved?.id ?? rowLike?.id;
    const ruid = (resolved as any)?.uid ?? rowLike?.uid;
    const rcode = (resolved as any)?.code ?? rowLike?.code;
    const rname = normalizeNameKey((resolved as any)?.name ?? rowLike?.name);
    const rbranch = normalizeBranchKey((resolved as any)?.branch ?? rowLike?.branch);
    const rjoined = normDateKey((resolved as any)?.joined_at ?? rowLike?.joined_at);

    const keys = new Set<string>(
      [
        rid != null ? `id:${rid}` : "",
        ruid ? `uid:${ruid}` : "",
        rcode ? `code:${rcode}` : "",
        rname && rbranch ? `nb:${rname}|${rbranch}` : "",
        rname && rjoined ? `nj:${rname}|${rjoined}` : "",
        rname ? `n:${rname}` : "",
        rbranch ? `b:${rbranch}` : "",
      ].filter(Boolean) as string[]
    );
    if (keys.size) {
      const ts = new Date().toISOString();
      keys.forEach((k) => (map[k] = ts));
      writeDismissed(map);
    }
  }
  function gcDismissedAgainst(list: ProbationRow[]) {
    const map = readDismissed();
    const keep = new Set<string>();
    for (const r of list) {
      const rid = (r as any)?.id;
      const ruid = (r as any)?.uid;
      const rcode = (r as any)?.code;
      const rname = normalizeNameKey((r as any)?.name);
      const rbranch = normalizeBranchKey((r as any)?.branch);
      const rjoined = normDateKey((r as any)?.joined_at);
      [
        rid != null ? `id:${rid}` : "",
        ruid ? `uid:${ruid}` : "",
        rcode ? `code:${rcode}` : "",
        rname && rbranch ? `nb:${rname}|${rbranch}` : "",
        rname && rjoined ? `nj:${rname}|${rjoined}` : "",
        rname ? `n:${rname}` : "",
        rbranch ? `b:${rbranch}` : "",
      ]
        .filter(Boolean)
        .forEach((k) => {
          if (map[k]) keep.add(k);
        });
    }
    if (keep.size === 0) return;
    const next: Record<string, string> = {};
    keep.forEach((k) => (next[k] = map[k]));
    writeDismissed(next);
  }

  /** ----- manager scoping (kept) ----- */
  function extractBranchInfo(x: any): { nameKey: string; idKey: string } {
    const b =
      x?.branch ??
      x?.deviceBranch ??
      x?.branch_name ??
      x?.branchName ??
      (typeof x?.branch === "object" ? x.branch.name ?? x.branch.title : undefined);
    const id = x?.branch_id ?? x?.branchId ?? (typeof x?.branch === "object" ? x.branch.id : undefined);
    return { nameKey: normalizeBranchKey(b), idKey: id != null ? String(id) : "" };
  }
  function normalizeAllowed(raw: any[]): { names: Set<string>; ids: Set<string> } {
    const names = new Set<string>();
    const ids = new Set<string>();
    for (const it of raw || []) {
      if (it == null) continue;
      if (typeof it === "object") {
        if (it.id != null) ids.add(String(it.id));
        if (it.name != null || it.title != null) names.add(normalizeBranchKey(it.name ?? it.title));
        if (it.slug != null) names.add(normalizeBranchKey(it.slug));
      } else {
        const s = String(it);
        if (/^\d+$/.test(s)) ids.add(s);
        names.add(normalizeBranchKey(s));
      }
    }
    return { names, ids };
  }
  const allowedSets = useMemo(
    () => normalizeAllowed(allowedBranchesRaw),
    [JSON.stringify(allowedBranchesRaw)]
  );
  function isWithinAllowed(x: any): boolean {
    if (!isManager) return true;
    if (allowedSets.names.size === 0 && allowedSets.ids.size === 0) return false;
    const info = extractBranchInfo(x);
    if (info.nameKey && allowedSets.names.has(info.nameKey)) return true;
    if (info.idKey && allowedSets.ids.has(info.idKey)) return true;
    return false;
  }

  /** ----- main loader (single source of truth) ----- */
  async function load() {
    setLoading(true);
    try {
      setError(null);

      const [l, e, d, p] = await Promise.all([
        (api as any).getLogs ? (api as any).getLogs({}) : Promise.resolve([]),
        (api as any).getEmployees ? (api as any).getEmployees({}) : Promise.resolve([]),
        (api as any).getDevices ? (api as any).getDevices({}) : Promise.resolve([]),
        getProbationDue().catch(() => [] as Employee[]),
      ]);

      const eScoped = isManager ? (e as any[]).filter(isWithinAllowed) : (e as any[]);
      const dScoped = isManager ? (d as any[]).filter(isWithinAllowed) : (d as any[]);
      const lScoped = isManager ? (l as any[]).filter(isWithinAllowed) : (l as any[]);

      setLogs(lScoped.slice(0, 10));
      setEmployees(eScoped);
      setDevices(dScoped);

      const serverRows = normalizeProbationItems(
        (p as any)?.items || (Array.isArray(p) ? p : []),
        eScoped
      );
      const localRows = localProbationFromEmployees(eScoped);
      const merged = mergeServerAndLocal(serverRows, localRows, eScoped);
      setProbation(merged);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load dashboard");
      setLogs([]);
      setEmployees([]);
      setDevices([]);
      setProbation([]);
    } finally {
      setLoading(false);
    }
  }

  function mergeServerAndLocal(
    serverRows: ProbationRow[],
    localRows: ProbationRow[],
    empList: Employee[]
  ) {
    const serverKeys = new Set<string>(serverRows.map(computeKeyLike));
    const out: ProbationRow[] = [];

    const maybePush = (r: ProbationRow) => {
      if (!r) return;
      if (!includeInWindow(r.daysToProbation)) return;
      const resolved = findEmployeeMatch(empList, r) || null;
      if (isDismissed(r, resolved)) return;
      const k = computeKeyLike(resolved || r);
      if (!k || out.some((x) => computeKeyLike(x) === k)) return;
      if (isManager && !isWithinAllowed(resolved || r)) return;
      out.push(r);
    };

    serverRows.forEach(maybePush);
    localRows.forEach((r) => {
      const k = computeKeyLike(r);
      if (k && serverKeys.has(k)) return;
      maybePush(r);
    });

    out.sort((a, b) => {
      const da = Number.isFinite(a.daysToProbation as any)
        ? (a.daysToProbation as number)
        : 9999;
      const db = Number.isFinite(b.daysToProbation as any)
        ? (b.daysToProbation as number)
        : 9999;
      return da - db;
    });
    gcDismissedAgainst(out);
    return out;
  }

  /** one-time load; re-run if manager scope changes */
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (me) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role, JSON.stringify(allowedBranchesRaw)]);

  /** review/dismiss first probation row */
  async function onReviewFirst() {
    const first = probation[0];
    if (!first) return;
    const resolved = findEmployeeMatch(employees, first) || null;
    const id = (resolved as any)?.id ?? (first as any)?.id;
    if (id != null) {
      try {
        await (api as any).ackProbation?.(id);
      } catch {}
    }
    const joinedAt =
      (first as any).joined_at ??
      (first as any).joinedAt ??
      (first as any).joined ??
      null;

    markDismissedFor(
      {
        id: (first as any).id,
        uid: (first as any).uid,
        code: (first as any).code,
        name: (first as any).name,
        branch: (first as any).branch,
        joined_at: joinedAt,
      },
      resolved
    );
    setProbation((prev) =>
      prev.filter((r) => computeKeyLike(r) !== computeKeyLike(resolved || first))
    );
    openReviewCard(first);
  }

  /** modal editing (same behavior; admin only) */
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const readOnly = isManager;

  function openReviewCard(row?: ProbationRow) {
    const target = row || probation[0];
    if (!target) return;
    const match = findEmployeeMatch(employees, target) || target;
    const id = (match as any)?.id ?? (target as any)?.id;
    setEditing({
      ...(match as any),
      id,
      department: (match as any)?.department ?? (target as any)?.department ?? null,
      address: (match as any)?.address ?? (target as any)?.address ?? null,
      phone: (match as any)?.phone ?? (target as any)?.phone ?? null,
      birthdate: (match as any)?.birthdate ?? (target as any)?.birthdate ?? null,
      employment_type:
        (match as any)?.employment_type ?? (target as any)?.employment_type ?? null,
      hourly_rate: (match as any)?.hourly_rate ?? (target as any)?.hourly_rate ?? null,
      salary_iqd: (match as any)?.salary_iqd ?? (target as any)?.salary_iqd ?? null,
      joined_at: (match as any)?.joined_at ?? (target as any)?.joined_at ?? null,
    } as any);
    setShowEdit(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) {
      alert("Read-only role: managers cannot edit employees.");
      return;
    }
    if (!editing) return;
    const real = findEmployeeMatch(employees, editing) || editing;
    const id = (real as any)?.id ?? (editing as any)?.id;
    if (id == null) {
      alert("Could not resolve employee ID.");
      return;
    }

    try {
      const payload = { ...(editing as any), id };
      await (api as any).updateEmployee?.(id, payload);
      try {
        await (api as any).ackProbation?.(id);
      } catch {}
      const resolved = findEmployeeMatch(employees, payload) || payload;
      markDismissedFor(payload, resolved as any);
      setProbation((prev) =>
        prev.filter((r) => computeKeyLike(r) !== computeKeyLike(resolved))
      );
      setShowEdit(false);
    } catch (err: any) {
      alert(err?.message || "Failed to save employee");
    }
  }

  /** derived UI bits */
  const deviceStats = useMemo(() => {
    const now = Date.now();
    const cut = OFFLINE_MINUTES * 60 * 1000;
    let total = devices.length,
      online = 0,
      offline = 0,
      needs = 0;
    for (const d of devices as any[]) {
      const last = new Date(
        (d as any).last_seen || (d as any).lastHeartbeat || (d as any).last_heartbeat || 0
      ).getTime();
      const stale = last ? now - last > cut : true;
      const isOn = Boolean((d as any).online) && !stale;
      if (isOn) online++;
      else {
        offline++;
        needs++;
      }
    }
    return { total, online, offline, needs };
  }, [devices]);

  const branchesCount = useMemo(
    () => new Set((employees as any[]).map((e) => String((e as any).branch || ""))).size,
    [employees]
  );

  const branchTotals = useMemo(() => {
    const by: Record<string, number> = {};
    for (const e of employees as any[]) {
      const b = String((e as any).branch || "");
      if (!b) continue;
      by[b] = (by[b] || 0) + 1;
    }
    return Object.entries(by)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [employees]);

  const probStats = useMemo(() => {
    if (!probation.length) return { overdue: 0, soon: 0, rest: 0 };
    const overdue = probation.filter((a) => (a.daysToProbation ?? 0) <= 0).length;
    const soon = probation.filter((a) => {
      const d = a.daysToProbation ?? 0;
      return d > 0 && d <= 3;
    }).length;
    const rest = Math.max(0, probation.length - overdue - soon);
    return { overdue, soon, rest };
  }, [probation]);

  const barWidths = useMemo(() => {
    const n = Math.max(1, probation.length);
    return {
      overdue: Math.round((probStats.overdue / n) * 100),
      soon: Math.round((probStats.soon / n) * 100),
      rest: Math.max(
        0,
        100 -
          Math.round((probStats.overdue / n) * 100) -
          Math.round((probStats.soon / n) * 100)
      ),
    };
  }, [probation, probStats]);

  const fmtTime = (ts: any) =>
  new Date(ts || Date.now()).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Baghdad"
  });

const fmtDateShort = (ts: any) =>
  new Date(ts || Date.now()).toLocaleDateString([], {
    day: "2-digit", month: "2-digit", timeZone: "Asia/Baghdad"
  });

  const recentRows = (logs as any[]).map((r: any, i: number) => {
    const ts = r.timestamp || r.time || r.created_at || r.date || Date.now();
    const emp = r.employee || r.user || {};
    const dev = r.device || {};
    const ev = r.event || r.type || r.direction || r.status || "";
    return {
      key: String(r.id ?? i),
      time: fmtTime(ts),
      date: fmtDateShort(ts),
      name: (emp as any).name || (r as any).name || "",
      uid: (emp as any).uid || (r as any).uid || "",
      event: String(ev).toUpperCase(),
      code: (emp as any).code || (r as any).code || "",
      branch:
        (r as any).branch || (emp as any).branch || (dev as any).branch || (dev as any).branch_name || "",
      device:
        (dev as any).name ||
        (r as any).device_name ||
        `Device ${(dev as any).id ?? ""}` + ((dev as any).branch ? ` (${(dev as any).branch})` : (dev as any).branch_name ? ` (${(dev as any).branch_name})` : ""),
    };
  });

if (role === 'accountant') {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview</p>
      </div>
      <div className="card py-12 text-center text-sm">
        <Navigate to="/employee-files" replace />
      </div>
    </div>
  );
}


  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back{me?.username ? `, ${me.username}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RoleBadge />
          {isManager && allowedBranchesRaw.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {allowedBranchesRaw.length} branch
              {allowedBranchesRaw.length !== 1 ? "es" : ""}
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <StatCard title="Employees" value={employees.length} />
        <StatCard title="Branches" value={new Set(employees.map((e: any) => e.branch || "")).size} />
        <StatCard
          title="Devices Online"
          value={`${deviceStats.online}/${deviceStats.total}`}
          subtitle={deviceStats.offline > 0 ? `${deviceStats.offline} offline` : "All online"}
          status={deviceStats.offline > 0 ? "warning" : "success"}
        />
        <StatCard title="Recent Events" value={logs.length} subtitle="Last fetch" />
      </div>

      {/* Probation & Devices */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Probation */}
        <div className={`card ${probation.length ? "border-l-4 border-l-red-500" : ""}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500"></div>
                <h3 className="font-semibold text-lg">Probation Alerts</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Employees near day 90 (−{OVERDUE_WINDOW_DAYS} to +{UPCOMING_WINDOW_DAYS} days)
              </p>

              {/* Legend bar */}
              <div className="flex items-center gap-4 mt-3">
                <div className="flex w-48 h-2 rounded-full overflow-hidden bg-muted">
                  <div className="h-2 bg-red-500" style={{ width: `${barWidths.overdue}%` }} />
                  <div className="h-2 bg-yellow-400" style={{ width: `${barWidths.soon}%` }} />
                  <div
                    className="h-2 bg-muted-foreground/30"
                    style={{ width: `${barWidths.rest}%` }}
                  />
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-red-500"></div>
                    Overdue
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                    Soon
                  </span>
                  <span className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/30"></div>
                    Others
                  </span>
                </div>
              </div>
            </div>

            {probation.length > 0 && (
              <button
                type="button"
                onClick={onReviewFirst}
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-900/30 transition-colors"
                title="Review & dismiss first probation item"
              >
                Review
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold px-2">
                  {probation.length}
                </span>
              </button>
            )}
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Joined</th>
                  <th className="px-3 py-2 font-medium">Days to 90</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {probation.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                          ✅
                        </div>
                        No probation alerts
                      </div>
                    </td>
                  </tr>
                ) : (
                  probation.map((e, i) => (
                    <tr
                      key={`${computeKeyLike(e) || i}`}
                      className="hover:bg-muted/50 cursor-pointer transition-colors border-b border-border/50"
                      onClick={() => openReviewCard(e)}
                      title="Click to edit"
                    >
                      <td className="px-3 py-3 font-medium">{e.name}</td>
                      <td className="px-3 py-3 text-muted-foreground">{String((e as any).branch || "")}</td>
                      <td className="px-3 py-3 text-muted-foreground">{fmtDate((e as any).joined_at)}</td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            Number.isFinite(e.daysToProbation as any)
                              ? (e.daysToProbation as number) <= 0
                                ? "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300"
                                : (e.daysToProbation as number) <= 3
                                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300"
                                : "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {Number.isFinite(e.daysToProbation as any) ? (e.daysToProbation as number) : "-"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            e.probationStatus === "Overdue"
                              ? "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300"
                              : e.probationStatus === "Soon"
                              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300"
                              : "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
                          }`}
                        >
                          {e.probationStatus || "-"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Device health */}
        <div className="card">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${deviceStats.offline > 0 ? "bg-yellow-500" : "bg-green-500"}`} />
                <h3 className="font-semibold text-lg">Device Health</h3>
              </div>
              <p className="text-sm text-muted-foreground">Real-time status monitoring</p>
            </div>
            <div className="text-right">
              <div className="text-sm font-medium">{deviceStats.total} Total</div>
              <div className="text-xs text-muted-foreground">
                {deviceStats.online} online • {deviceStats.offline} offline
              </div>
            </div>
          </div>

          {/* Summary chips */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            <Chip label="Total" value={deviceStats.total} color="blue" />
            <Chip label="Online" value={deviceStats.online} color="green" />
            <Chip label="Offline" value={deviceStats.offline} color="red" />
            <Chip label="Attention" value={deviceStats.needs} color="yellow" />
          </div>

          {/* Device table */}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-1">ID</th>
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Branch</th>
                  <th className="px-2 py-1">Type</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {(devices as any[]).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-8 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">📱</div>
                        No devices found
                      </div>
                    </td>
                  </tr>
                ) : (
                  (devices as any[]).map((d: any, i: number) => {
                    const now = Date.now(),
                      cut = OFFLINE_MINUTES * 60 * 1000;
                    const last = new Date(d.last_seen || d.lastHeartbeat || d.last_heartbeat || 0).getTime();
                    const stale = last ? now - last > cut : true;
                    const isOn = Boolean(d.online) && !stale;
                    const lastFmt = last ? formatLocalDateTime(last) : "-";
                    return (
                      <tr key={String(d.id || i)} className="hover:bg-muted/50 transition-colors border-b border-border/50">
                        <td className="px-2 py-3 font-mono text-xs">{String(d.id ?? "")}</td>
                        <td className="px-2 py-3 font-medium">{d.name || d.device_name || `Device ${d.id || ""}`}</td>
                        <td className="px-2 py-3 text-muted-foreground">{String(d.branch || d.branch_name || "")}</td>
                        <td className="px-2 py-3 text-muted-foreground">{String(d.type || d.model || "ESP32")}</td>
                        <td className="px-2 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              isOn
                                ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300"
                                : "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300"
                            }`}
                          >
                            {isOn ? "Online" : "Offline"}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-xs text-muted-foreground font-mono">{lastFmt}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Top branches */}
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500"></div>
              <h3 className="font-semibold text-lg">Top Branches</h3>
            </div>
            <p className="text-sm text-muted-foreground">Employee distribution across locations</p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            {branchesCount} branches • {employees.length} employees
          </div>
        </div>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Employees</th>
              </tr>
            </thead>
            <tbody>
              {branchTotals.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-3 py-8 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">🏢</div>
                      No branch data available
                    </div>
                  </td>
                </tr>
              ) : (
                branchTotals.map(([b, c]) => (
                  <tr key={b} className="hover:bg-muted/50 transition-colors border-b border-border/50">
                    <td className="px-3 py-3 font-medium">{b}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c}</span>
                        <div className="flex-1 max-w-20 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.max(
                                10,
                                (c / Math.max(...branchTotals.map(([, count]) => count))) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent activity */}
      <div className="card">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <h3 className="font-semibold text-lg">Recent Activity</h3>
            </div>
            <p className="text-sm text-muted-foreground">Latest attendance events</p>
          </div>
        </div>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">UID</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Device</th>
              </tr>
            </thead>
            <tbody>
              {recentRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">📊</div>
                      No recent activity
                    </div>
                  </td>
                </tr>
              ) : (
                recentRows.map((r) => (
                  <tr key={r.key} className="hover:bg-muted/50 transition-colors border-b border-border/50">
                    <td className="px-3 py-3 font-mono text-xs">{r.time}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{r.date}</td>
                    <td className="px-3 py-3 font-medium">{r.name}</td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{r.uid}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          r.event.includes("IN") || r.event.includes("ENTER")
                            ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300"
                            : r.event.includes("OUT") || r.event.includes("EXIT")
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {r.event}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{r.code}</td>
                    <td className="px-3 py-3 text-muted-foreground">{r.branch}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{r.device}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit modal */}
      {showEdit && editing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <form onSubmit={saveEdit} className="w-full max-w-xl rounded-2xl bg-white dark:bg-zinc-900 p-4 space-y-3 shadow-xl">
            <div className="flex items-start justify-between">
              <div className="font-medium">Employee</div>
              <button type="button" onClick={() => setShowEdit(false)} className="text-sm text-zinc-500">
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <input
                  className="input"
                  disabled={readOnly}
                  value={(editing as any).name || ""}
                  onChange={(e) => setEditing({ ...(editing as any), name: e.target.value })}
                />
              </Field>
              <Field label="Branch">
                <input
                  className="input"
                  disabled={readOnly}
                  value={(editing as any).branch || ""}
                  onChange={(e) => setEditing({ ...(editing as any), branch: e.target.value })}
                />
              </Field>
              <Field label="Department">
                <input
                  className="input"
                  disabled={readOnly}
                  value={(editing as any).department || ""}
                  onChange={(e) => setEditing({ ...(editing as any), department: e.target.value })}
                />
              </Field>
              <Field label="Phone">
                <input
                  className="input"
                  disabled={readOnly}
                  value={(editing as any).phone || ""}
                  onChange={(e) => setEditing({ ...(editing as any), phone: e.target.value })}
                />
              </Field>
              <Field label="UID">
                <input
                  className="input"
                  disabled={readOnly}
                  value={(editing as any).uid || ""}
                  onChange={(e) => setEditing({ ...(editing as any), uid: e.target.value })}
                />
              </Field>
              <Field label="Code">
                <input
                  className="input"
                  disabled={readOnly}
                  value={(editing as any).code || ""}
                  onChange={(e) => setEditing({ ...(editing as any), code: e.target.value })}
                />
              </Field>
              <Field label="Employment Type">
                <select
                  className="input"
                  disabled={readOnly}
                  value={(editing as any).employment_type || ""}
                  onChange={(e) => {
                    const v = (e.target.value || "") as "wages" | "salary" | "" | null;
                    setEditing({
                      ...(editing as any),
                      employment_type: v,
                      hourly_rate: v === "wages" ? (editing as any).hourly_rate ?? 0 : null,
                      salary_iqd: v === "salary" ? (editing as any).salary_iqd ?? 0 : null,
                    } as any);
                  }}
                >
                  <option value="">(unset)</option>
                  <option value="wages">Wages (hourly)</option>
                  <option value="salary">Salary (IQD)</option>
                </select>
              </Field>
              {(editing as any).employment_type === "wages" && (
                <Field label="Hourly rate">
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    disabled={readOnly}
                    value={(editing as any).hourly_rate ?? ""}
                    onChange={(e) =>
                      setEditing({ ...(editing as any), hourly_rate: Number(e.target.value) })
                    }
                  />
                </Field>
              )}
              {(editing as any).employment_type === "salary" && (
                <Field label="Salary (IQD)">
                  <input
                    className="input"
                    type="number"
                    step="1"
                    disabled={readOnly}
                    value={(editing as any).salary_iqd ?? ""}
                    onChange={(e) =>
                      setEditing({ ...(editing as any), salary_iqd: Number(e.target.value) })
                    }
                  />
                </Field>
              )}
              <Field label="Joined at">
                <input
                  className="input"
                  type="date"
                  disabled={readOnly}
                  value={fmtDate((editing as any).joined_at)}
                  onChange={(e) =>
                    setEditing({ ...(editing as any), joined_at: e.target.value || null } as any)
                  }
                />
              </Field>
            </div>

            {!readOnly && (
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" className="btn" onClick={() => setShowEdit(false)}>
                  Cancel
                </button>
                <button className="btn-primary" type="submit">
                  Save
                </button>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs">{label}</span>
      {children}
    </label>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  status,
}: {
  title: string;
  value: React.ReactNode;
  subtitle?: string;
  status?: "success" | "warning" | "error";
}) {
  const statusColors = {
    success: "border-green-200 dark:border-green-800",
    warning: "border-yellow-200 dark:border-yellow-800",
    error: "border-red-200 dark:border-red-800",
  };

  return (
    <div
      className={`rounded-2xl bg-zinc-900/5 dark:bg-zinc-800 p-6 shadow-sm card border hover:shadow-md transition-shadow ${
        status ? statusColors[status] : "border-border/50"
      }`}
    >
      <div className="text-sm text-muted-foreground font-medium">{title}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight">{value}</div>
      {subtitle && <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>}
    </div>
  );
}

function Chip({
  label,
  value,
  color = "blue",
}: {
  label: string;
  value: React.ReactNode;
  color?: "blue" | "green" | "red" | "yellow";
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800",
    green:
      "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800",
    red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800",
    yellow:
      "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-800",
  };

  return (
    <div className={`rounded-xl p-4 text-center border ${colors[color]} transition-colors hover:brightness-95`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}
