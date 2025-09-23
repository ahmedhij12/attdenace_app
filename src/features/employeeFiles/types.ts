/**
 * Step 1 — centralize Employee Files types without changing behavior.
 * Safe to add; not imported anywhere yet.
 */

export type EmployeeStatus = "Active" | "Left";

export interface EmployeeFileLite {
  id: number | string;
  name: string;
  code?: string;
  branch?: string;
  status?: EmployeeStatus;
  joined_at?: string;            // ISO string
  employment_type?: "salary" | "wages" | string;
}

/**
 * Re-export app-wide models so future code can import everything
 * from one place without hunting paths. This does not change any behavior.
 * (Alias "@" → src should already exist in your Vite config.)
 */
export * from "@/types/models";
