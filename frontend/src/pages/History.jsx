import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  History as HistoryIcon,
  Search,
  Download,
  Trash2,
  Eye,
  X,
  RotateCcw,
} from 'lucide-react';
import {
  deleteHistoryRecord,
  downloadFileFromEndpoint,
  extractErrorMessage,
  getHistory,
  getTechniques,
  resolveMediaUrl,
} from '../services/api';
import { useToast } from '../components/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  EmptyState,
  ErrorBanner,
  LoadingSpinner,
  StatusBadge,
  formatDateTime,
} from '../components/UiStates';

export default function History() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [techniques, setTechniques] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [techniqueFilter, setTechniqueFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [detailEntry, setDetailEntry] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const toast = useToast();

  const fetchHistory = async (overrides = {}) => {
    setLoading(true);
    setError('');
    try {
      const params = {
        search: overrides.search !== undefined ? overrides.search : search,
        technique: overrides.technique !== undefined ? overrides.technique : techniqueFilter,
        status: overrides.status !== undefined ? overrides.status : statusFilter,
        date_from: overrides.dateFrom !== undefined ? overrides.dateFrom : dateFrom || undefined,
        date_to: overrides.dateTo !== undefined ? overrides.dateTo : dateTo || undefined,
      };
      const data = await getHistory(params);
      setEntries(data.items || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to fetch processing history.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const techs = await getTechniques();
        setTechniques(techs);
      } catch {
        // Ignore
      }
      await fetchHistory();
    };
    init();
  }, []);

  const resetFilters = () => {
    setSearch('');
    setTechniqueFilter('all');
    setStatusFilter('all');
    setDateFrom('');
    setDateTo('');
    fetchHistory({ search: '', technique: 'all', status: 'all', dateFrom: '', dateTo: '' });
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteHistoryRecord(deleteTarget.id);
      toast.success(`Removed history entry #${deleteTarget.id}.`);
      setDeleteTarget(null);
      await fetchHistory();
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to delete history entry.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Filter Card */}
      <div className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div className="lg:col-span-2 space-y-1">
            <label className="block text-[11px] font-semibold text-slate-600">Search</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  fetchHistory({ search: e.target.value });
                }}
                placeholder="Filename, technique, or Job ID..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-xs text-slate-800 focus:bg-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-600">Technique</label>
            <select
              value={techniqueFilter}
              onChange={(e) => {
                setTechniqueFilter(e.target.value);
                fetchHistory({ technique: e.target.value });
              }}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800"
            >
              <option value="all">All Techniques</option>
              {techniques.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-600">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                fetchHistory({ status: e.target.value });
              }}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800"
            >
              <option value="all">All Statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-600">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                fetchHistory({ dateFrom: e.target.value });
              }}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-800"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-semibold text-slate-600">To Date</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  fetchHistory({ dateTo: e.target.value });
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-800"
              />
              <button
                type="button"
                onClick={resetFilters}
                className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-100 cursor-pointer"
                title="Reset filters"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Persistent History Table */}
      <div className="rounded-2xl bg-white shadow-xs ring-1 ring-slate-200/80 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Persistent SQLite Audit Log ({total})</h2>
            <p className="text-xs text-slate-500">All augmentation records persist across restarts</p>
          </div>
        </div>

        {loading ? (
          <LoadingSpinner label="Loading processing history..." />
        ) : error ? (
          <div className="p-5">
            <ErrorBanner message={error} onRetry={() => fetchHistory()} />
          </div>
        ) : entries.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={HistoryIcon}
              title="No processing history found"
              description="Run single or batch augmentations in the Studio or Batch Processing to see persistent job logs here."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">Job ID</th>
                  <th className="py-3 px-4">Original Filename</th>
                  <th className="py-3 px-4">Technique</th>
                  <th className="py-3 px-4">Date & Time</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Generated Output</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {entries.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-700">
                      #{row.job_id || '—'}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900 max-w-[180px] truncate">
                      {row.original_filename}
                    </td>
                    <td className="py-3 px-4 text-slate-700">{row.technique_label}</td>
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={row.status} />
                      {row.error_message && (
                        <p className="text-[11px] text-rose-600 mt-1 max-w-xs truncate" title={row.error_message}>
                          {row.error_message}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 max-w-[200px] truncate">
                      {row.output_filename || '—'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDetailEntry(row)}
                          className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
                          title="View job details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {row.download_url && (
                          <button
                            type="button"
                            onClick={() => downloadFileFromEndpoint(row.download_url, row.output_filename)}
                            className="p-1.5 rounded-lg border border-slate-200 text-cyan-700 hover:bg-cyan-50 cursor-pointer"
                            title="Download generated image"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(row)}
                          className="p-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 cursor-pointer"
                          title="Delete history record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Job Details Modal */}
      {detailEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          onClick={() => setDetailEntry(null)}
        >
          <div
            className="max-w-xl w-full rounded-2xl bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Job #{detailEntry.job_id || '—'} • History Record #{detailEntry.id}
                </h3>
                <p className="text-xs text-slate-500">{formatDateTime(detailEntry.created_at)}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailEntry(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              {detailEntry.result_image_url && (
                <div className="rounded-xl bg-slate-950/5 border border-slate-200 p-2 flex justify-center max-h-56">
                  <img
                    src={resolveMediaUrl(detailEntry.result_image_url)}
                    alt={detailEntry.output_filename}
                    className="max-h-52 object-contain rounded-lg"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="block text-slate-400 font-semibold uppercase text-[10px]">Original Image</span>
                  <span className="font-semibold text-slate-800">{detailEntry.original_filename}</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-semibold uppercase text-[10px]">Status</span>
                  <div className="mt-0.5">
                    <StatusBadge status={detailEntry.status} />
                  </div>
                </div>
                <div>
                  <span className="block text-slate-400 font-semibold uppercase text-[10px]">Technique</span>
                  <span className="font-semibold text-cyan-800">{detailEntry.technique_label}</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-semibold uppercase text-[10px]">Output File</span>
                  <span className="font-mono text-slate-700 break-all">{detailEntry.output_filename || 'None'}</span>
                </div>
              </div>
              {detailEntry.error_message && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-rose-700">
                  <strong>Error:</strong> {detailEntry.error_message}
                </div>
              )}
              <div>
                <span className="block text-slate-400 font-semibold uppercase text-[10px] mb-1">
                  Applied Parameters
                </span>
                <pre className="rounded-xl bg-slate-50 border border-slate-200 p-3 font-mono text-[11px] overflow-x-auto">
                  {JSON.stringify(detailEntry.parameters, null, 2)}
                </pre>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                {detailEntry.original_image_id && detailEntry.result_id && (
                  <Link
                    to={`/comparison?originalId=${detailEntry.original_image_id}&resultId=${detailEntry.result_id}`}
                    className="rounded-xl bg-cyan-50 border border-cyan-200 px-3.5 py-2 font-semibold text-cyan-800 hover:bg-cyan-100"
                  >
                    Open in Comparison
                  </Link>
                )}
                {detailEntry.download_url && (
                  <button
                    type="button"
                    onClick={() => downloadFileFromEndpoint(detailEntry.download_url, detailEntry.output_filename)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-3.5 py-2 font-semibold text-white hover:bg-cyan-700 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Result
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete History Record?"
        message={`This removes history log entry #${deleteTarget?.id} from SQLite without deleting your original or generated image files.`}
        confirmLabel="Delete Record"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
