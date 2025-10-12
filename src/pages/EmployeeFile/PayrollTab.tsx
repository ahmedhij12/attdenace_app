import React from 'react';

interface PayrollTabProps {
  emp: any;
  month: string;
  setMonth: (month: string) => void;
  pay: any;
  payrollLoadNonce: number;
  setPayrollLoadNonce: (nonce: number | ((prev: number) => number)) => void;
}

export default function PayrollTab({
  emp,
  month,
  setMonth,
  pay,
  payrollLoadNonce,
  setPayrollLoadNonce,
}: PayrollTabProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Month</label>
          <input
            type="month"
            className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          onClick={() => setPayrollLoadNonce(prev => prev + 1)}
        >
          Load
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Monthly Totals</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Hours:</span>
              <span className="font-medium text-slate-900 dark:text-white">{pay?.hours_total ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Food Allowance:</span>
              <span className="font-medium text-slate-900 dark:text-white">{pay?.food_allowance ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Other Allowance:</span>
              <span className="font-medium text-slate-900 dark:text-white">{pay?.other_allowance ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Deductions:</span>
              <span className="font-medium text-red-600 dark:text-red-400">{pay?.deductions ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Advances:</span>
              <span className="font-medium text-red-600 dark:text-red-400">{pay?.advances ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Late Penalty:</span>
              <span className="font-medium text-red-600 dark:text-red-400">{pay?.late_penalty ?? 0}</span>
            </div>
            <div className="flex justify-between pt-3 border-t border-slate-200 dark:border-slate-600">
              <span className="font-semibold text-slate-900 dark:text-white">Total Pay:</span>
              <span className="font-bold text-green-600 dark:text-green-400">{pay?.total_pay ?? 0}</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-700/50 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-600">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Daily Breakdown</h3>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400">Day</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Hours</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Food</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Other</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Advance</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Deduct</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Late</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-600">
                {(pay?.rows ?? []).map((d: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                    <td className="px-4 py-2 text-sm text-slate-900 dark:text-white">{d.day}</td>
                    <td className="px-4 py-2 text-sm text-slate-900 dark:text-white text-right">{d.hours}</td>
                    <td className="px-4 py-2 text-sm text-slate-900 dark:text-white text-right">{d.food}</td>
                    <td className="px-4 py-2 text-sm text-slate-900 dark:text-white text-right">{d.other}</td>
                    <td
                      className={`px-4 py-2 text-sm text-right ${
                        ((d as any).advance || 0) > 0
                          ? 'text-red-600 dark:text-red-400'
                          : ((d as any).advance || 0) < 0
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {(d as any).advance ?? 0}
                    </td>
                    <td className="px-4 py-2 text-sm text-red-600 dark:text-red-400 text-right">{d.deduct}</td>
                    <td className="px-4 py-2 text-sm text-red-600 dark:text-red-400 text-right">{d.late}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
