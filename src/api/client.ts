// src/api/client.ts
import { useAuthStore } from '@/store/auth';
export const BRANCHES: string[] = [];

function resolveApiBase(): string {
  const env =
    (import.meta as any).env?.VITE_API_BASE ||
    (import.meta as any).env?.VITE_API_URL ||
    (import.meta as any).env?.VITE_API ||
    (window as any).__APP_API_BASE ||
    localStorage.getItem("api_base");
  const fromEnv = (env ? String(env) : "").replace(/\/+$/g, "");
  if (fromEnv) {
    console.log('[API Client] Using API base from env:', fromEnv);
    return fromEnv;
  }

  // FIXED: Always prefer production API URL
  const u = new URL(window.location.href);
  
  // Production: app.hijazionline.org -> api.hijazionline.org
  if (u.hostname === "app.hijazionline.org") {
    console.log('[API Client] Production mode: Using api.hijazionline.org');
    return "https://api.hijazionline.org";
  }
  
  // FIXED: Default to production API for all other cases including localhost
  console.log('[API Client] Using production API base');
  return "https://api.hijazionline.org";
}

class ApiClient {
  private base = resolveApiBase();

  // ----------------- core helpers -----------------
  private authHeaders(init?: RequestInit): RequestInit {
    let token = "";
    try {
      token =
        localStorage.getItem("token") ||
        localStorage.getItem("jwt") ||
        localStorage.getItem("auth_token") ||
        "";
    } catch {}
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init?.headers as Record<string, string>),
    };
    if (!(init?.body instanceof FormData)) {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
    }
    if (token && !headers["Authorization"]) headers["Authorization"] = `Bearer ${token}`;
    return { ...init, headers };
  }

  private async request<T = any>(path: string, init?: RequestInit): Promise<T> {
    const url = path.startsWith("http")
      ? path
      : `${this.base}${path.startsWith("/") ? "" : "/"}${path}`;

    const res = await fetch(url, this.authHeaders(init));

    if (res.status === 204) return undefined as any;

    const ctype = res.headers.get("content-type") || "";
    const isJSON = ctype.includes("application/json");
    const data = isJSON ? await res.json() : await res.text();

    if (!res.ok) {
      const message =
        (isJSON && (data?.detail || data?.message)) || res.statusText || `HTTP ${res.status}`;
      const err: any = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data as T;
  }

  private buildQuery(params?: Record<string, any>): string {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      q.set(k, String(v));
    });
    const s = q.toString();
    return s ? `?${s}` : "";
  }

  private coerceArray<T = any>(response: any): T[] {
    if (Array.isArray(response)) return response as T[];
    if (response && Array.isArray(response.items)) return response.items as T[];
    if (response && Array.isArray(response.data)) return response.data as T[];
    return [];
  }

  // For UI consumption
  public ensureArray<T = any>(response: any): T[] {
    return this.coerceArray<T>(response);
  }

  // ----------------- employee mappers -----------------
  private mapEmployeeFromServer<T extends Record<string, any>>(e: T): T & { joined_at?: string } {
    if (!e || typeof e !== "object") return e as any;
    const joined =
      (e as any).joined_at ??
      (e as any).join_date ??
      (e as any).joinedAt ??
      (e as any).joined ??
      null;
    return { ...e, joined_at: joined } as any;
  }

  private mapEmployeesArray(data: any): any {
    if (Array.isArray(data)) return data.map((x) => this.mapEmployeeFromServer(x));
    if (Array.isArray(data?.items)) {
      return { ...data, items: data.items.map((x: any) => this.mapEmployeeFromServer(x)) };
    }
    return this.mapEmployeeFromServer(data);
  }

  private withJoinDate(body: any) {
    if (!body || typeof body !== "object") return body;
    const b: any = { ...body };
    // keep both keys so whatever the backend expects will be present
    if (b.joined_at && !b.join_date) b.join_date = b.joined_at;
    if (b.join_date && !b.joined_at) b.joined_at = b.join_date;
    return b;
  }

  // ----------------- employees -----------------
  listEmployees(params?: {
    q?: string;
    page?: number;
    page_size?: number;
    branch?: string;
    manager_scope?: 0 | 1;
  }) {
    return this.request(`/employees${this.buildQuery(params)}`).then((d) =>
      this.mapEmployeesArray(d)
    );
  }

  // Back-compat for Dashboard
  getEmployees(params?: any) {
    return this.listEmployees(params);
  }

  getEmployee(id: string | number) {
    return this.request(`/employees/${id}`).then((d) => this.mapEmployeeFromServer(d));
  }

  createEmployee(body: any /* Partial<Employee> & { name: string; code?: string } */) {
    return this.request("/employees", {
      method: "POST",
      body: JSON.stringify(this.withJoinDate(body)),
    }).then((d) => this.mapEmployeeFromServer(d));
  }

  updateEmployee(id: string | number, body: any /* Partial<Employee> */) {
    return this.request(`/employees/${id}`, {
      method: "PUT",
      body: JSON.stringify(this.withJoinDate(body)),
    }).then((d) => this.mapEmployeeFromServer(d));
  }

  deleteEmployee(id: string | number) {
    return this.request(`/employees/${id}`, { method: "DELETE" });
  }

  probationDue(params?: { days?: number }) {
    return this.request(`/employees/probation_due${this.buildQuery(params)}`);
  }

  // Back-compat for Dashboard
  getProbationDue(params?: { days?: number }) {
    return this.probationDue(params);
  }

  acknowledgeProbation(id: string | number) {
    return this.request(`/employees/${id}/ack_probation`, { method: "POST" });
  }

  // Back-compat for Dashboard
  ackProbation(id: string | number) {
    return this.acknowledgeProbation(id);
  }

  // ----------------- devices -----------------
  listDevices() {
    return this.request(`/devices`);
  }
  // Back-compat
  getDevices() {
    return this.listDevices();
  }
  getDevice(id: string | number) {
    return this.request(`/devices/${id}`);
  }
  createDevice(body: any) {
    return this.request("/devices", { method: "POST", body: JSON.stringify(body) });
  }
  updateDevice(id: string | number, body: any) {
    return this.request(`/devices/${id}`, { method: "PUT", body: JSON.stringify(body) });
  }
  deleteDevice(id: string | number) {
    return this.request(`/devices/${id}`, { method: "DELETE" });
  }
  regenerateDeviceKey(id: string | number) {
    return this.request(`/devices/${id}/regenerate_key`, { method: "POST" });
  }
  heartbeat(body?: any) {
    return this.request("/devices/heartbeat", {
      method: "POST",
      body: JSON.stringify(body || {}),
    });
  }

  // ----------------- logs -----------------
  getLogs(params?: Partial<{
    employee_id: string | number;
    device_id: string | number;
    branch: string;
    date: string;
    from: string;
    to: string;
    page: number;
    page_size: number;
  }>) {
    return this.request<{ items: any[]; total?: number }>(
      `/logs${this.buildQuery(params)}`
    );
  }

  // ----------------- employee files (overview modal) -----------------
  async getEmployeeOverview(opts: { employeeId: string | number; month?: string; logsLimit?: number }) {
    const { employeeId, month, logsLimit = 20 } = opts;

    // Try dedicated endpoint first
    try {
      const data = await this.request(
        `/employee_files/${employeeId}/overview${this.buildQuery({ month, limit: logsLimit })}`
      );
      if (data) return data;
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (!/404|405|Not Found|Method Not Allowed/i.test(msg)) throw e;
      // fallthrough to compatibility path
    }

    // Fallback: compute from existing endpoints
    const [emp, logs] = await Promise.all([
      this.getEmployee(employeeId),
      this.getLogs({
        employee_id: employeeId,
        ...(month ? { from: `${month}-01`, to: `${month}-31` } : {}),
        page_size: logsLimit,
      }),
    ]);

    const items = (logs as any)?.items || [];
    const presentDays = new Set<string>();
    let minutesLateTotal = 0;
    for (const l of items) {
      const d = (l as any).ts?.slice(0, 10) || (l as any).timestamp?.slice(0, 10) || "";
      if (d) presentDays.add(d);
      minutesLateTotal += Number((l as any).minutes_late || 0);
    }

    return {
      employee: emp,
      month: month || undefined,
      present_days: presentDays.size,
      late_minutes_total: minutesLateTotal,
      recent_logs: items.slice(0, logsLimit),
    };
  }

  // ----------------- generic helpers -----------------
  get<T = any>(path: string, params?: Record<string, any>) {
    return this.request<T>(`${path}${this.buildQuery(params)}`);
  }
  post<T = any>(path: string, body?: any) {
    return this.request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    });
  }
  put<T = any>(path: string, body?: any) {
    return this.request<T>(path, {
      method: "PUT",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    });
  }
  del<T = any>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }
}

export const api = new ApiClient();
export default api;

// --- add to the END of src/api/client.ts ---

export function authHeader(): Record<string, string> {
  try {
    // Look in all common places our app has ever stored the token
    const raw = localStorage.getItem("auth") || sessionStorage.getItem("auth");
    const token =
      // current
      localStorage.getItem("jwt") ||
      // older keys / alternates
      localStorage.getItem("token") ||
      localStorage.getItem("access_token") ||
      sessionStorage.getItem("jwt") ||
      sessionStorage.getItem("token") ||
      sessionStorage.getItem("access_token") ||
      (raw ? (JSON.parse(raw).jwt || JSON.parse(raw).token || JSON.parse(raw).access_token) : null);

    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

// Some places import getAuthHeader; make it an alias.
export function getAuthHeader(): Record<string, string> {
  return authHeader();
}