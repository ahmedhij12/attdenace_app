/**
 * Step 3 — API re-exports for Employee Files.
 * Expose BOTH the original names (getLogs, getPayroll, …)
 * and the friendlier aliases (getEmployeeLogs, …) so we can
 * change import PATHS without changing CALL SITES yet.
 */

// --- Employee Files (original names) ---
export {
  listEmployeeFiles,
  getEmployeeOverview,
  getLogs,
  getPayroll,
  getDeductions,
  getSalaryHistory,
  exportLogsXlsxUrl,
} from "@/api/employeeFiles";

// --- Employee Files (friendly aliases for future code) ---
export {
  listEmployeeFiles as listEmployeeFilesEF,
  getEmployeeOverview as getEmployeeOverviewEF,
  getLogs as getEmployeeLogs,
  getPayroll as getEmployeePayroll,
  getDeductions as getEmployeeDeductions,
  getSalaryHistory as getEmployeeSalaryHistory,
  exportLogsXlsxUrl as exportEmployeeLogsXlsx,
} from "@/api/employeeFiles";

// --- Employees endpoints needed by the archive (status toggle, etc.) ---
export {
  listEmployees,
  updateEmployeeStatus,
  updateEmployee,
} from "@/api/employees";
