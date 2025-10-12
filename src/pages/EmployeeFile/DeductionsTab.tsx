import React from 'react';
import employeeFileApi from '@/api/employeeFiles';

interface DeductionsTabProps {
  emp: any;
  month: string;
  setMonth: (month: string) => void;
  canEdit: boolean;
  deds: any[];
  dedLoadNonce: number;
  setDedLoadNonce: (nonce: number | ((prev: number) => number)) => void;
}

export default function DeductionsTab({
  emp,
  month,
  setMonth,
  canEdit,
  deds,
  dedLoadNonce,
  setDedLoadNonce,
}: DeductionsTabProps) {
  const [addingDed, setAddingDed] = React.useState(false);
  const [addDate, setAddDate] = React.useState<string>('');
  const [addAmount, setAddAmount] = React.useState<string>('');
  const [addReason, setAddReason] = React.useState<string>('');
  const [editId, setEditId] = React.useState<string | number | null>(null);
  const [editDate, setEditDate] = React.useState<string>('');
  const [editAmount, setEditAmount] = React.useState<string>('');
  const [editReason, setEditReason] = React.useState<string>('');
  const [dedBusy, setDedBusy] = React.useState(false);
  const [dedMsg, setDedMsg] = React.useState<string | null>(null);

  const firstDayOfMonth = (m: string) =>
    (/^\d{4}-\d{2}$/.test(m || '') ? `${m}-01` : new Date().toISOString().slice(0, 10));

  const startAddDed = () => {
    setDedMsg(null);
    setAddingDed(true);
    setEditId(null);
    setAddDate(firstDayOfMonth(month));
    setAddAmount('');
    setAddReason('');
  };

  const cancelAddDed = () => {
    setAddingDed(false);
    setAddDate('');
    setAddAmount('');
    setAddReason('');
  };

  const createDed = async () => {
    if (dedBusy) return;
    try {
      setDedBusy(true);
      setDedMsg(null);
      const amt = parseInt(addAmount || '0', 10) || 0;
      await employeeFileApi.createEmpDeduction(emp.id, {
        date: (addDate && addDate.trim()) || firstDayOfMonth(month),
        amount_iqd: amt,
        note: (addReason || '').trim() || undefined,
      });
      cancelAddDed();
      setDedLoadNonce((n) => n + 1);
    } catch (e: any) {
      setDedMsg(e?.message || 'Failed to add deduction');
    } finally {
      setDedBusy(false);
    }
  };

  const startEditDed = (d: any) => {
    setDedMsg(null);
    setAddingDed(false);
    setEditId(d.id);
    setEditDate(d.date || firstDayOfMonth(month));
    setEditAmount(String(d.amount ?? 0));
    setEditReason(d.reason || d.note || '');
  };

  const cancelEditDed = () => {
    setEditId(null);
    setEditDate('');
    setEditAmount('');
    setEditReason('');
  };

  const saveEditDed = async () => {
    if (dedBusy || editId == null) return;
    try {
      setDedBusy(true);
      setDedMsg(null);
      const amt = parseInt(editAmount || '0', 10) || 0;
      await employeeFileApi.updateEmpDeduction(emp.id, editId as any, {
        date: (editDate && editDate.trim()) || undefined,
        amount_iqd: amt,
        note: (editReason || '').trim() || undefined,
      });
      cancelEditDed();
      setDedLoadNonce((n) => n + 1);
    } catch (e: any) {
      setDedMsg(e?.message || 'Failed to save');
    } finally {
      setDedBusy(false);
    }
  };

  const deleteDed = async (d: any) => {
    if (dedBusy) return;
    const isReal = /^\d+$/.test(String(d.id || ''));
    if (!isReal) {
      setDedMsg('Cannot delete legacy payroll-only row.');
      return;
    }
    const reason = window.prompt('Delete reason (required):', '');
    if (reason === null) return;
    if (!reason.trim()) {
      setDedMsg('Delete reason is required.');
      return;
    }
    if (!window.confirm('Are you sure you want to delete this deduction?')) return;
    try {
      setDedBusy(true);
      setDedMsg(null);
      await employeeFileApi.deleteEmpDeduction(emp.id, d.id, { reason: reason.trim() });
      setDedLoadNonce((n) => n + 1);
    } catch (e: any) {
      setDedMsg(e?.message || 'Failed to delete');
    } finally {
      setDedBusy(false);
    }
  };

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
          onClick={() => setDedLoadNonce((n) => n + 1)}
        >
          Load
        </button>
        {canEdit && !addingDed && editId == null && (
          <button
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
            onClick={startAddDed}
          >
            + Add Deduction
          </button>
        )}
      </div>

      {dedMsg && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-3 text-yellow-800 dark:text-yellow-200">
          {dedMsg}
        </div>
      )}

      <div className="bg-white dark:bg-slate-700/50 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Amount (IQD)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Reason
                </th>
                {canEdit && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-600">
              {canEdit && addingDed && (
                <tr className="bg-slate-50/60 dark:bg-slate-800/40">
                  <td className="px-6 py-3">
                    <input
                      type="date"
                      className="px-2 py-1 rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600"
                      value={addDate}
                      onChange={(e) => setAddDate(e.target.value)}
                    />
                  </td>
                  <td className="px-6 py-3 text-right">
                    <input
                      type="number"
                      className="px-2 py-1 w-32 text-right rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600"
                      value={addAmount}
                      onChange={(e) => setAddAmount(e.target.value)}
                    />
                  </td>
                  <td className="px-6 py-3">
                    <input
                      className="px-2 py-1 rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 w-full"
                      value={addReason}
                      onChange={(e) => setAddReason(e.target.value)}
                    />
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button
                      className="px-3 py-1 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100 mr-2"
                      onClick={cancelAddDed}
                      disabled={dedBusy}
                    >
                      Cancel
                    </button>
                    <button
                      className="px-3 py-1 rounded-md bg-blue-600 text-white disabled:opacity-50"
                      onClick={createDed}
                      disabled={dedBusy}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              )}
              {(deds ?? []).map((d: any) => {
                const editingThis = editId === d.id;
                return (
                  <tr key={d.id}>
                    <td className="px-6 py-3">
                      {editingThis ? (
                        <input
                          type="date"
                          className="px-2 py-1 rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                        />
                      ) : (
                        <span>{d.date ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {editingThis ? (
                        <input
                          type="number"
                          className="px-2 py-1 w-32 text-right rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                        />
                      ) : (
                        <span>{d.amount}</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      {editingThis ? (
                        <input
                          className="px-2 py-1 rounded-md bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 w-full"
                          value={editReason}
                          onChange={(e) => setEditReason(e.target.value)}
                        />
                      ) : (
                        <span>{d.reason ?? '—'}</span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-6 py-3 text-right">
                        {editingThis ? (
                          <>
                            <button
                              className="px-3 py-1 rounded-md bg-blue-600 text-white mr-2 disabled:opacity-50"
                              onClick={saveEditDed}
                              disabled={dedBusy}
                            >
                              Save
                            </button>
                            <button
                              className="px-3 py-1 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100"
                              onClick={cancelEditDed}
                              disabled={dedBusy}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="px-3 py-1 rounded-md bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-100 mr-2"
                              onClick={() => startEditDed(d)}
                              disabled={dedBusy}
                            >
                              Edit
                            </button>
                            <button
                              className="px-3 py-1 rounded-md bg-red-600 text-white disabled:opacity-50"
                              onClick={() => deleteDed(d)}
                              disabled={dedBusy}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}

              {(!deds || deds.length === 0) && !addingDed && (
                <tr>
                  <td
                    colSpan={canEdit ? 5 : 4}
                    className="px-6 py-12 text-center text-slate-500 dark:text-slate-400"
                  >
                    No deductions found for selected month
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
