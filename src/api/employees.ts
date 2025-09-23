// src/api/employees.ts — CLEAN API ONLY

// Keep this type here OR in your src/types.ts (but not both).
// If you already have Employee in src/types.ts, delete this and import from there.
export type Employee = {
  id: number;
  name: string;
  department: string;
  branch: string;
  uid: string;
  code?: string;
  join_date?: string | null;
  address?: string | null;
  phone?: string | null;
  birthdate?: string | null;
  employment_type?: string | null;
  hourly_rate?: number | null;
  salary_iqd?: number | null;
  nationality?: string | null;
  probation_due?: boolean;
  probation_due_date?: string | null;
  days_to_probation?: number | null;
  probation_status?: string | null;
  is_active?: 0 | 1;
  status?: string; // 'active' | 'left' | 'terminated' | ...
};

// Use (import.meta as any).env to avoid TS error “Property 'env' does not exist on type 'ImportMeta'”
const API_BASE: string =
  ((import.meta as any).env?.VITE_API_BASE_URL as string) ||
  ((import.meta as any).env?.VITE_API_BASE as string) ||
  "";

// ---- auth header helper
function authHeaders(): Record<string, string> {
  try {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

// ---- helpers
function buildQS(params: Record<string, any>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : "";
}

// ---- API
export async function listEmployees(params: {
  q?: string;
  branch?: string;
  include_archived?: boolean;
  status?: string;
} = {}): Promise<Employee[]> {
  const qs = buildQS({
    q: params.q,
    branch: params.branch,
    include_archived: params.include_archived ? "true" : undefined,
    status: params.status,
  });
  const res = await fetch(`${API_BASE}/employees${qs}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`listEmployees failed: ${res.status}`);
  return await res.json();
}

export async function createEmployee(body: Partial<Employee>): Promise<Employee> {
  const res = await fetch(`${API_BASE}/employees`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createEmployee failed: ${res.status}`);
  return await res.json();
}

export async function updateEmployee(empId: number, body: Partial<Employee>): Promise<Employee> {
  const res = await fetch(`${API_BASE}/employees/${empId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`updateEmployee failed: ${res.status}`);
  return await res.json();
}

export async function updateEmployeeStatus(
  empId: number,
  body: { is_active?: boolean; status?: string }
) {
  const res = await fetch(`${API_BASE}/employees/${empId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`updateEmployeeStatus failed: ${res.status}`);
  return await res.json();
}

// Soft delete now archives (is_active=0, status='left') server-side
export async function softDeleteEmployee(
  empId: number
): Promise<{ ok: boolean; archived: boolean }> {
  const res = await fetch(`${API_BASE}/employees/${empId}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`softDeleteEmployee failed: ${res.status}`);
  return await res.json();
}
export async function getProbationDue(): Promise<Employee[]> {
  const res = await fetch(`${API_BASE}/employees/probation_due`, {
    headers: { ...authHeaders() },
  });
  if (!res.ok) throw new Error(`probation_due failed: ${res.status}`);
  // backend returns either {count, items} or an array (depending on your older UI)
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (data?.items && Array.isArray(data.items)) return data.items;
  return [];
}
