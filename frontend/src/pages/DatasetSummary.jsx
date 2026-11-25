import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Database,
  ImagePlus,
  Sparkles,
  CheckCircle2,
  HardDrive,
  Sliders,
  Maximize2,
  BarChart3,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { extractErrorMessage, getSummary, getSummaryCharts } from '../services/api';
import {
  EmptyState,
  ErrorBanner,
  LoadingSpinner,
  StatCard,
  StatusBadge,
  formatBytes,
  formatDateTime,
} from '../components/UiStates';

const CHART_COLORS = ['#0891b2', '#14b8a6', '#2563eb', '#0284c7', '#0d9488', '#6366f1', '#f59e0b'];

export default function DatasetSummary() {
  const [summary, setSummary] = useState(null);
  const [charts, setCharts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAnalytics = async () => {
    setLoading(true);
    setError('');
    try {
      const [sumData, chartData] = await Promise.all([getSummary(), getSummaryCharts()]);
      setSummary(sumData);
      setCharts(chartData);
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load dataset summary analytics.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, []);

  if (loading) return <LoadingSpinner label="Calculating SQLite dataset statistics..." />;
  if (error) return <ErrorBanner message={error} onRetry={loadAnalytics} />;
  if (!summary || !charts) return null;

  const isEmpty = summary.total_original_images === 0 && summary.total_generated_images === 0;

  if (isEmpty) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No Dataset Analytics Available Yet"
        description="Upload underwater species images and run augmentations to generate real SQLite statistics, format distributions, and storage metrics."
        action={
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-cyan-700"
          >
            Upload Underwater Images
          </Link>
        }
      />
    );
  }

  const dims = summary.dimensions_overview || {};

  return (
    <div className="space-y-6">
      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard
          title="Original Images"
          value={summary.total_original_images}
          subtitle={`Storage: ${formatBytes(summary.original_storage_bytes)}`}
          icon={ImagePlus}
          accent="cyan"
        />
        <StatCard
          title="Generated Images"
          value={summary.total_generated_images}
          subtitle={`Storage: ${formatBytes(summary.augmented_storage_bytes)}`}
          icon={Sparkles}
          accent="teal"
        />
        <StatCard
          title="Processing Jobs"
          value={summary.total_processing_jobs}
          subtitle={`${summary.successful_jobs} successful • ${summary.failed_jobs} failed/partial`}
          icon={CheckCircle2}
          accent="indigo"
        />
        <StatCard
          title="Techniques Used"
          value={`${summary.techniques_used_count} / ${summary.total_techniques_available}`}
          subtitle="Distinct base techniques applied"
          icon={Sliders}
          accent="amber"
        />
        <StatCard
          title="Total Storage Used"
          value={formatBytes(summary.total_storage_bytes)}
          subtitle="Combined uploads + generated outputs"
          icon={HardDrive}
          accent="cyan"
        />
        <StatCard
          title="Avg Image Dimensions"
          value={`${dims.avg_width || 0} × ${dims.avg_height || 0}`}
          subtitle={`Range: ${dims.min_width || 0}–${dims.max_width || 0}px wide`}
          icon={Maximize2}
          accent="teal"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart: Technique Distribution */}
        <div className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80">
          <h3 className="text-sm font-bold text-slate-900">Augmentation Technique Distribution</h3>
          <p className="text-xs text-slate-500 mb-4">Generated image count per technique</p>
          {charts.technique_distribution.length === 0 ? (
            <p className="text-xs text-slate-400 py-16 text-center">No augmented images generated yet.</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.technique_distribution} margin={{ left: 0, right: 16, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: '#475569' }}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                    height={55}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Images" fill="#0891b2" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Pie Chart: File Format Distribution */}
        <div className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80">
          <h3 className="text-sm font-bold text-slate-900">Uploaded File Format Distribution</h3>
          <p className="text-xs text-slate-500 mb-4">Source dataset image formats</p>
          {charts.format_distribution.length === 0 ? (
            <p className="text-xs text-slate-400 py-16 text-center">No uploaded files yet.</p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={charts.format_distribution}
                    dataKey="count"
                    nameKey="format"
                    cx="50%"
                    cy="50%"
                    outerRadius={95}
                    label={({ format, count }) => `${format} (${count})`}
                  >
                    {charts.format_distribution.map((entry, idx) => (
                      <Cell key={entry.format} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Line Chart: Processing Activity Over Time */}
      <div className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80">
        <h3 className="text-sm font-bold text-slate-900">Dataset Growth & Processing Activity</h3>
        <p className="text-xs text-slate-500 mb-4">Daily uploads, successful augmentations, and failures</p>
        {charts.activity_over_time.length === 0 ? (
          <p className="text-xs text-slate-400 py-12 text-center">No timeline data recorded yet.</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={charts.activity_over_time}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="uploaded" name="Uploaded" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="augmented" name="Augmented" stroke="#0891b2" strokeWidth={2.5} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="failed" name="Failed" stroke="#e11d48" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Recent Processing Activity */}
      <div className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-900">Recent Dataset Activity</h3>
          <Link to="/history" className="text-xs font-semibold text-cyan-700 hover:underline">
            View Full History
          </Link>
        </div>
        {summary.recent_activity.length === 0 ? (
          <p className="text-xs text-slate-500 py-6 text-center">No recent processing events.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase text-slate-500">
                  <th className="py-2 pr-4">Job</th>
                  <th className="py-2 pr-4">Original File</th>
                  <th className="py-2 pr-4">Technique</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {summary.recent_activity.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2.5 pr-4 font-mono text-slate-600">#{row.job_id || '—'}</td>
                    <td className="py-2.5 pr-4 font-medium text-slate-800">{row.original_filename}</td>
                    <td className="py-2.5 pr-4 text-slate-700">{row.technique_label}</td>
                    <td className="py-2.5 pr-4">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="py-2.5 text-slate-500">{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
