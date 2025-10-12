import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/auth';

interface SalaryChange {
  id?: number;
  effective_from?: string;
  date?: string;
  type?: string;
  employment_type?: string;
  hourly_rate?: number;
  rate?: number;
  salary_iqd?: number;
  salary?: number;
}

interface Props {
  empId: number;
}

export default function SalaryHistoryTab({ empId }: Props) {
  const [history, setHistory] = useState<SalaryChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSalaryHistory = async (employeeId: number) => {
    const token = useAuthStore.getState().token || "";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

    const urls = [
      `/employee_files/${employeeId}/salary_history`,
      `/api/employee_files/${employeeId}/salary_history`,
      `/employees/${employeeId}/salary_history`,
      `/api/employees/${employeeId}/salary_history`,
    ];

    for (const url of urls) {
      try {
        const r = await fetch(url, { method: "GET", headers, credentials: "include" });
        if (r.ok) return await r.json();
      } catch {
        // keep trying fallbacks
      }
    }
    return [];
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    fetchSalaryHistory(empId)
      .then((data) => {
        if (mounted) {
          setHistory(Array.isArray(data) ? data : []);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err?.message || 'Failed to load salary history');
          setHistory([]);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [empId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <span className="ml-3 text-slate-600 dark:text-slate-400">Loading salary history...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-red-800 dark:text-red-200">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-700/50 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-600">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
            Salary Change History
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Effective From
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Hourly / Salary
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-600">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    No salary history available
                  </td>
                </tr>
              ) : (
                history.map((h: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="px-6 py-3 text-sm text-slate-900 dark:text-white">
                      {h.effective_from ?? h.date ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-900 dark:text-white capitalize">
                      {h.type ?? h.employment_type ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-900 dark:text-white text-right font-mono">
                      {h.type === 'salary' || h.employment_type === 'salary'
                        ? (h.salary_iqd ?? h.salary ?? '—')
                        : (h.hourly_rate ?? h.rate ?? '—')}
                    </td>
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