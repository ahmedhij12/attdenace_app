// src/api/employees.ts — clean, self-contained client (adds `brand`, keeps behaviors)

// ---------- Types ----------
export type EmploymentType = "wages" | "salary";

export interface Employee {
  id: number;
  name: string;
  department?: string | null;   // UI label: Position
  branch: string;               // UI label: Location (manager scoping)
  brand?: string | null;        // NEW: Awtar | 360 | AA Chicken
  uid?: string | null;
  code?: string | null;
  join_date?: string | null;
  address?: string | null;
  phone?: string | null;
  birthdate?: string | null;
  employment_type?: EmploymentType | null;
  hourly_rate?: number | null;
  salary_iqd?: number | null;
  nationality?: string | null;
  // probation helpers may be present from server:
  probation_due?: boolean;
  probation_due_date?: string | null;
  days_to_probation?: number | null;
  probation_status?: string | null;
  is_active?: 0 | 1;
  status?: string | null;       // 'active' | 'left' | ...
  [k: string]: any;
}

export type EmployeePayload = Partial<Employee> & {
  name: string;   // required
  branch: string; // Location (required)
};

// ---------- Local helpers (no imports needed) ----------
const API_BASE: string =
  ((import.meta as any).env?.VITE_API_BASE_URL as string) ||
  ((import.meta as any).env?.VITE_API_BASE as string) ||
  ((window as any).__APP_API_BASE as string) ||
  "";

/** Authorization header from local/session storage (keeps your existing behavior) */
function authHeaders(): Record<string, string> {
  try {
    const token =
      localStorage.getItem("token") ||
      localStorage.getItem("jwt") ||
      localStorage.getItem("access_token") ||
      sessionStorage.getItem("token") ||
      "";
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function buildQS(params?: Record<string, any>) {
  if (!params) return "";
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function json(body: any): BodyInit {
  return JSON.stringify(body ?? {});
}

// ---------- API ----------
export async function listEmployees(params: {
  q?: string;
  branch?: string;               // Location filter
  include_archived?: boolean;
  status?: string;
  page?: number;
  page_size?: number;
} = {}): Promise<Employee[] | { items: Employee[]; count?: number }> {
  const qs = buildQS({
    q: params.q,
    branch: params.branch,
    include_archived: params.include_archived ? "true" : undefined,
    status: params.status,
    page: params.page,
    page_size: params.page_size,
  });
  const res = await fetch(`${API_BASE}/employees${qs}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`listEmployees failed: ${res.status}`);
  const data = await res.json();
  // Your backend sometimes returns {items,count} and sometimes [] — support both
  return data;
}

export async function getEmployee(id: number | string): Promise<Employee> {
  const res = await fetch(`${API_BASE}/employees/${id}`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`getEmployee failed: ${res.status}`);
  return await res.json();
}

export async function createEmployee(p: EmployeePayload): Promise<Employee> {
  const res = await fetch(`${API_BASE}/employees`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: json({
      name: p.name,
      department: p.department ?? null, // UI: Position
      branch: p.branch,                 // UI: Location
      brand: p.brand ?? null,           // NEW: Brand
      uid: p.uid ?? "",
      code: p.code ?? "",
      join_date: p.join_date ?? null,
      address: p.address ?? null,
      phone: p.phone ?? null,
      birthdate: p.birthdate ?? null,
      employment_type: p.employment_type ?? null,
      hourly_rate: p.hourly_rate ?? null,
      salary_iqd: p.salary_iqd ?? null,
      nationality: p.nationality ?? "non_iraqi",
      is_active: p.is_active ?? 1,
      status: p.status ?? "active",
    }),
  });
  if (!res.ok) throw new Error(`createEmployee failed: ${res.status}`);
  return await res.json();
}

export async function updateEmployee(id: number, p: EmployeePayload): Promise<Employee> {
  const res = await fetch(`${API_BASE}/employees/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: json({
      name: p.name,
      department: p.department ?? null, // UI: Position
      branch: p.branch,                 // UI: Location
      brand: p.brand ?? null,           // NEW: Brand
      uid: p.uid ?? "",
      code: p.code ?? "",
      join_date: p.join_date ?? null,
      address: p.address ?? null,
      phone: p.phone ?? null,
      birthdate: p.birthdate ?? null,
      employment_type: p.employment_type ?? null,
      hourly_rate: p.hourly_rate ?? null,
      salary_iqd: p.salary_iqd ?? null,
      nationality: p.nationality ?? "non_iraqi",
      is_active: p.is_active ?? 1,
      status: p.status ?? "active",
    }),
  });
  if (!res.ok) throw new Error(`updateEmployee failed: ${res.status}`);
  return await res.json();
}

/** Toggle Active/Left while preserving UID semantics (server already enforces) */
export async function updateEmployeeStatus(
  id: number,
  body: { is_active?: 0 | 1; status?: "active" | "left" }
): Promise<Employee> {
  const res = await fetch(`${API_BASE}/employees/${id}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: json(body),
  });
  if (!res.ok) throw new Error(`updateEmployeeStatus failed: ${res.status}`);
  return await res.json();
}

/** Soft archive (server marks left/is_active=0) */
export async function deleteEmployee(id: number): Promise<{ ok: true } | any> {
  const res = await fetch(`${API_BASE}/employees/${id}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`deleteEmployee failed: ${res.status}`);
  return await res.json();
}

/** Hard delete (purge) */
export async function purgeEmployee(id: number): Promise<{ ok: true } | any> {
  const res = await fetch(`${API_BASE}/employees/${id}/purge`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`purgeEmployee failed: ${res.status}`);
  return await res.json();
}

/** Probation feed used on Dashboard */
export async function getProbationDue(): Promise<Employee[]> {
  const res = await fetch(`${API_BASE}/employees/probation_due`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`probation_due failed: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) return data as Employee[];
  if (data?.items && Array.isArray(data.items)) return data.items as Employee[];
  return [];
}

/** Employees export URL (client-side download) */
export function getEmployeesExportUrl(params: {
  branch?: string;           // Location filter
  include_archived?: boolean;
} = {}): string {
  const qs = buildQS({
    branch: params.branch,
    include_archived: params.include_archived ? "true" : undefined,
  });
  return `${API_BASE}/exports/employees.xlsx${qs}`;
}

// Optional default export for convenience
const employeeApi = {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  purgeEmployee,
  updateEmployeeStatus,
  getProbationDue,
  getEmployeesExportUrl,
};
export default employeeApi;
