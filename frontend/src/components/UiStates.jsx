import React from 'react';
import { Loader2, AlertCircle, Waves } from 'lucide-react';

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, exp);
  return `${val >= 10 || exp === 0 ? val.toFixed(0) : val.toFixed(2)} ${units[exp]}`;
}

export function formatDateTime(isoString) {
  if (!isoString) return '—';
  const normalized = isoString.endsWith('Z') ? isoString : `${isoString}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LoadingSpinner({ label = 'Loading data...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-slate-500">
      <Loader2 className="w-8 h-8 animate-spin text-cyan-600 mb-3" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

export function EmptyState({ icon: Icon = Waves, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-slate-300 bg-white/80 py-14 px-6">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-50 to-teal-50 border border-cyan-100 flex items-center justify-center text-cyan-600 mb-4">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && (
        <p className="text-sm text-slate-500 max-w-md mt-1.5 leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800">
      <div className="flex items-center gap-2.5 text-sm">
        <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-100 transition cursor-pointer"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function StatCard({ title, value, subtitle, icon: Icon, accent = 'cyan' }) {
  const accentMap = {
    cyan: 'from-cyan-500 to-blue-600 text-cyan-700 bg-cyan-50',
    teal: 'from-teal-500 to-emerald-600 text-teal-700 bg-teal-50',
    indigo: 'from-blue-600 to-indigo-700 text-blue-700 bg-blue-50',
    amber: 'from-amber-500 to-orange-600 text-amber-700 bg-amber-50',
  }[accent] || 'from-cyan-500 to-blue-600 text-cyan-700 bg-cyan-50';

  const [, , iconText, iconBg] = accentMap.split(' ');

  return (
    <div className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80 hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1.5">{value}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
        </div>
        {Icon && (
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconText}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  const normalized = (status || '').toLowerCase();
  const map = {
    success: 'bg-teal-50 text-teal-700 ring-teal-600/20',
    completed: 'bg-teal-50 text-teal-700 ring-teal-600/20',
    processing: 'bg-cyan-50 text-cyan-700 ring-cyan-600/20',
    pending: 'bg-slate-100 text-slate-700 ring-slate-500/20',
    completed_with_errors: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    failed: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  };
  const cls = map[normalized] || 'bg-slate-100 text-slate-700 ring-slate-500/20';
  const label = normalized.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  );
}
