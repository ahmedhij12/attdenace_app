// src/api/audits.ts
import { getApiBase } from "@/lib/download";
import { useAuthStore } from "@/store/auth";

export type AuditItem = {
  created_at: string | number;
  actor: string | null;
  employee_uid: string | null;
  employee_name: string | null;
  employee_code: string | null;
  action: string | null;
  amount_iqd: number | null;
  reason: string | null;
  details: string | null;
};

export type AuditQuery = {
  from?: string;           // YYYY-MM-DD (inclusive)
  to?: string;             // YYYY-MM-DD (exclusive)
  actor?: string;
  employee_code?: string;
  employee_uid?: string;
  action?: string;
  page?: number;
  limit?: number;
};

// Always provide a token if we have it (401 fix)
function authHeader() {
  const state: any = useAuthStore.getState?.() || {};
  const token =
    state.token ||
    state.auth?.token ||
    localStorage.getItem("token") ||
    localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildUrl(base: string, path: string, params: Record<string, any>) {
  const url = new URL(`${base.replace(/\/+$/g, "")}${path}`);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.append(k, String(v));
  }
  const qs = sp.toString();
  if (qs) url.search = qs;
  return url.toString();
}

export async function getAudits(params: AuditQuery = {}, signal?: AbortSignal) {
  const base = getApiBase?.() || "";
  const url = buildUrl(base, "/audits", params);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeader(), // <- make sure the server sees your role
    },
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${text || res.statusText}`);
  }
  return res.json();
}
