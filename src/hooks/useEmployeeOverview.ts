// src/hooks/useEmployeeOverview.ts
import { useEffect, useMemo, useState } from "react";
import { getEmployeeOverview } from "@/api/employeeFiles";
import type { EmployeeOverviewDTO } from "@/types/employee-files";

type Args = {
  apiBase: string;
  token: string;
  employeeId: string;
  month?: string;
  logsLimit?: number;
};

export function useEmployeeOverview({ apiBase, token, employeeId, month, logsLimit = 20 }: Args) {
  const [data, setData] = useState<EmployeeOverviewDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase || !token || !employeeId) return;
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    getEmployeeOverview({
      apiBase,
      token,
      employeeId,
      month,
      logsLimit,
      signal: ctl.signal,
    })
      .then(setData)
      .catch((e) => setError(e?.message ?? "Failed to load"))
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [apiBase, token, employeeId, month, logsLimit]);

  return useMemo(() => ({ data, loading, error }), [data, loading, error]);
}
