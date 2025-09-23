// src/lib/roles.ts
export type UserRole = 'admin' | 'hr' | 'manager' | 'accountant';
export type AppPage =
  | 'dashboard'
  | 'employees'
  | 'devices'
  | 'logs'
  | 'payroll'
  | 'employeeFiles'
  | 'audits'
  | 'settings';

// Normalize any incoming role string to our 4 canonical roles
export function normalizeRole(r: unknown): UserRole {
  const x = String(r ?? '').toLowerCase().trim();
  if (x.startsWith('admin')) return 'admin';
  if (x === 'hr' || x.startsWith('humanresources') || x.startsWith('human-resources')) return 'hr';
  if (x === 'accountant' || x.startsWith('account')) return 'accountant';
  return 'manager';
}

// LEGACY: keep old behavior for any code that still expects 'admin' | 'manager'
// AFTER (show the true role for display chips)
export function roleLabel(r: unknown): 'admin' | 'hr' | 'manager' | 'accountant' {
  return normalizeRole(r);
}


// Page → allowed roles mapping (frontend mirror of your backend gates)
export const PAGE_PERMISSIONS = {
  dashboard:     ['admin', 'hr', 'manager'],
  employees:     ['admin', 'hr', 'manager'],
  devices:       ['admin', 'hr', 'manager'],
  logs:          ['admin', 'hr', 'manager'],
  payroll:       ['admin', 'hr'],
  employeeFiles: ['admin', 'hr', 'accountant'],
  audits:        ['admin'],
  settings: ['admin', 'hr', 'manager', 'accountant'],
} as const;

// Check access using normalized role
export function canAccess(role: unknown, page: AppPage): boolean {
  const r = normalizeRole(role);
  const allowed = PAGE_PERMISSIONS[page] as ReadonlyArray<UserRole>;
  return allowed.includes(r);
}
