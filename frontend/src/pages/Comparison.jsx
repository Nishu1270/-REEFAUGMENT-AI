import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  SplitSquareHorizontal,
  Columns2,
  Download,
  Wand2,
  UploadCloud,
} from 'lucide-react';
import {
  downloadFileFromEndpoint,
  extractErrorMessage,
  getComparison,
  getImages,
  resolveMediaUrl,
} from '../services/api';
import {
  EmptyState,
  ErrorBanner,
  LoadingSpinner,
  formatBytes,
  formatDateTime,
} from '../components/UiStates';

export default function Comparison() {
  const [searchParams] = useSearchParams();
  const initialOriginalId = searchParams.get('originalId');
  const initialResultId = searchParams.get('resultId');

  const [originals, setOriginals] = useState([]);
  const [selectedOriginalId, setSelectedOriginalId] = useState(null);
  const [comparisonData, setComparisonData] = useState(null);
  const [selectedResultId, setSelectedResultId] = useState(null);

  const [viewMode, setViewMode] = useState('side_by_side'); // 'side_by_side' | 'slider'
  const [sliderPercent, setSliderPercent] = useState(50);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadOriginals = async () => {
      setLoading(true);
      setError('');
      try {
        const imgs = await getImages();
        setOriginals(imgs);
        if (imgs.length > 0) {
          const parsedOrig = initialOriginalId ? parseInt(initialOriginalId, 10) : null;
          const matched = imgs.find((i) => i.id === parsedOrig);
          setSelectedOriginalId(matched ? matched.id : imgs[0].id);
        }
      } catch (err) {
        setError(extractErrorMessage(err, 'Failed to load original images.'));
      } finally {
        setLoading(false);
      }
    };
    loadOriginals();
  }, [initialOriginalId]);

  useEffect(() => {
    if (!selectedOriginalId) return;
    const loadComp = async () => {
      try {
        const data = await getComparison(selectedOriginalId);
        setComparisonData(data);
        const list = data.results || [];
        if (list.length > 0) {
          const parsedRes = initialResultId ? parseInt(initialResultId, 10) : null;
          const matched = list.find((r) => r.id === parsedRes);
          setSelectedResultId(matched ? matched.id : list[0].id);
        } else {
          setSelectedResultId(null);
        }
      } catch (err) {
        setError(extractErrorMessage(err, 'Failed to fetch comparison details.'));
      }
    };
    loadComp();
  }, [selectedOriginalId, initialResultId]);

  const activeResult = useMemo(
    () => comparisonData?.results?.find((r) => r.id === Number(selectedResultId)) || null,
    [comparisonData, selectedResultId]
  );

  if (loading) return <LoadingSpinner label="Loading Before & After Comparison..." />;
  if (error) return <ErrorBanner message={error} />;

  if (originals.length === 0) {
    return (
      <EmptyState
        icon={UploadCloud}
        title="No Images to Compare"
        description="Upload underwater species images and create augmentations first to inspect side-by-side results."
        action={
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-cyan-700"
          >
            Upload Images
          </Link>
        }
      />
    );
  }

  const orig = comparisonData?.original;

  return (
    <div className="space-y-6">
      {/* Controls Card */}
      <div className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
        <div className="md:col-span-4 space-y-1.5">
          <label className="block text-xs font-semibold text-slate-700">1. Select Original Image</label>
          <select
            value={selectedOriginalId || ''}
            onChange={(e) => setSelectedOriginalId(Number(e.target.value))}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800 focus:bg-white focus:border-cyan-500 focus:outline-none"
          >
            {originals.map((img) => (
              <option key={img.id} value={img.id}>
                {img.original_filename} ({img.augmentation_count} augmented)
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-5 space-y-1.5">
          <label className="block text-xs font-semibold text-slate-700">2. Select Augmented Version</label>
          <select
            value={selectedResultId || ''}
            onChange={(e) => setSelectedResultId(Number(e.target.value))}
            disabled={!comparisonData?.results?.length}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800 focus:bg-white focus:border-cyan-500 focus:outline-none disabled:opacity-50"
          >
            {!comparisonData?.results?.length ? (
              <option value="">No augmented versions yet</option>
            ) : (
              comparisonData.results.map((res) => (
                <option key={res.id} value={res.id}>
                  {res.technique_label} — {res.output_filename}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="md:col-span-3 flex justify-end">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 w-full md:w-auto">
            <button
              type="button"
              onClick={() => setViewMode('side_by_side')}
              className={`flex-1 md:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer transition ${
                viewMode === 'side_by_side' ? 'bg-white text-cyan-800 shadow-2xs' : 'text-slate-600'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              Side by Side
            </button>
            <button
              type="button"
              onClick={() => setViewMode('slider')}
              className={`flex-1 md:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer transition ${
                viewMode === 'slider' ? 'bg-white text-cyan-800 shadow-2xs' : 'text-slate-600'
              }`}
            >
              <SplitSquareHorizontal className="w-3.5 h-3.5" />
              Slider
            </button>
          </div>
        </div>
      </div>

      {/* Main Comparison Canvas */}
      {orig && !activeResult ? (
        <EmptyState
          icon={Wand2}
          title={`No augmented versions for '${orig.original_filename}'`}
          description="Open this image in the Augmentation Studio to generate augmented variations for comparison."
          action={
            <Link
              to={`/studio?imageId=${orig.id}`}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-cyan-700"
            >
              <Wand2 className="w-4 h-4" />
              Augment This Image
            </Link>
          }
        />
      ) : orig && activeResult ? (
        <div className="space-y-6">
          {viewMode === 'side_by_side' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Before Card */}
              <div className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold uppercase text-slate-700">
                      Original (Before)
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 mt-1">{orig.original_filename}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      downloadFileFromEndpoint(`/api/images/${orig.id}/download`, orig.original_filename)
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </button>
                </div>
                <div className="rounded-xl bg-slate-950/5 border border-slate-200 aspect-[4/3] flex items-center justify-center overflow-hidden p-2">
                  <img
                    src={resolveMediaUrl(orig.image_url)}
                    alt={orig.original_filename}
                    className="max-h-full max-w-full object-contain rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-center">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <span className="block text-[10px] text-slate-400 uppercase font-semibold">Dimensions</span>
                    <span className="font-bold text-slate-800">{orig.width}x{orig.height}px</span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <span className="block text-[10px] text-slate-400 uppercase font-semibold">File Size</span>
                    <span className="font-bold text-slate-800">{formatBytes(orig.file_size)}</span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <span className="block text-[10px] text-slate-400 uppercase font-semibold">Format</span>
                    <span className="font-bold text-slate-800">{orig.file_format}</span>
                  </div>
                </div>
              </div>

              {/* After Card */}
              <div className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-cyan-200 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="inline-block rounded-full bg-cyan-50 px-2.5 py-0.5 text-[11px] font-bold uppercase text-cyan-800">
                      Augmented (After)
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 mt-1">{activeResult.technique_label}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      downloadFileFromEndpoint(activeResult.download_url, activeResult.output_filename)
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </button>
                </div>
                <div className="rounded-xl bg-slate-950/5 border border-slate-200 aspect-[4/3] flex items-center justify-center overflow-hidden p-2">
                  <img
                    src={resolveMediaUrl(activeResult.image_url)}
                    alt={activeResult.output_filename}
                    className="max-h-full max-w-full object-contain rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-center">
                  <div className="rounded-lg bg-cyan-50/70 p-2">
                    <span className="block text-[10px] text-cyan-700 uppercase font-semibold">Dimensions</span>
                    <span className="font-bold text-slate-900">{activeResult.width}x{activeResult.height}px</span>
                  </div>
                  <div className="rounded-lg bg-cyan-50/70 p-2">
                    <span className="block text-[10px] text-cyan-700 uppercase font-semibold">File Size</span>
                    <span className="font-bold text-slate-900">{formatBytes(activeResult.file_size)}</span>
                  </div>
                  <div className="rounded-lg bg-cyan-50/70 p-2">
                    <span className="block text-[10px] text-cyan-700 uppercase font-semibold">Created</span>
                    <span className="font-bold text-slate-900 truncate block">{formatDateTime(activeResult.created_at)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Interactive Split Slider View */
            <div className="rounded-2xl bg-white p-6 shadow-xs ring-1 ring-slate-200/80 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Interactive Before & After Slider ({sliderPercent}%)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Left shows Original ({orig.width}x{orig.height}px) • Right shows {activeResult.technique_label} ({activeResult.width}x{activeResult.height}px)
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      downloadFileFromEndpoint(`/api/images/${orig.id}/download`, orig.original_filename)
                    }
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Original
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadFileFromEndpoint(activeResult.download_url, activeResult.output_filename)
                    }
                    className="inline-flex items-center gap-1 rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Augmented
                  </button>
                </div>
              </div>

              <div className="relative mx-auto max-w-3xl aspect-[4/3] rounded-2xl overflow-hidden bg-slate-950 border border-slate-200 select-none">
                {/* Augmented base layer */}
                <img
                  src={resolveMediaUrl(activeResult.image_url)}
                  alt="Augmented"
                  className="absolute inset-0 w-full h-full object-contain"
                />
                {/* Original clipped overlay */}
                <div
                  className="absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(0 ${100 - sliderPercent}% 0 0)` }}
                >
                  <img
                    src={resolveMediaUrl(orig.image_url)}
                    alt="Original"
                    className="w-full h-full object-contain"
                  />
                </div>
                {/* Divider Line */}
                <div
                  className="absolute inset-y-0 w-0.5 bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.9)] pointer-events-none"
                  style={{ left: `${sliderPercent}%` }}
                >
                  <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-cyan-500 text-white flex items-center justify-center shadow-lg text-xs font-bold">
                    ⇄
                  </div>
                </div>
                <span className="absolute top-3 left-3 rounded-md bg-slate-950/75 px-2.5 py-1 text-[11px] font-bold text-white">
                  BEFORE
                </span>
                <span className="absolute top-3 right-3 rounded-md bg-cyan-600/90 px-2.5 py-1 text-[11px] font-bold text-white">
                  AFTER
                </span>
              </div>

              <div className="max-w-3xl mx-auto">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={sliderPercent}
                  onChange={(e) => setSliderPercent(Number(e.target.value))}
                  className="w-full cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Applied Parameters Details */}
          <div className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80">
            <h3 className="text-sm font-bold text-slate-900 mb-2">Applied Technique & Parameters</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1.5">
                <p>
                  <span className="font-semibold text-slate-600">Output Filename:</span>{' '}
                  <span className="font-mono text-slate-900">{activeResult.output_filename}</span>
                </p>
                <p>
                  <span className="font-semibold text-slate-600">Technique:</span>{' '}
                  <span className="font-bold text-cyan-800">{activeResult.technique_label}</span>
                </p>
                <p>
                  <span className="font-semibold text-slate-600">Dimension Delta:</span>{' '}
                  <span>
                    {orig.width}x{orig.height} → {activeResult.width}x{activeResult.height}px
                  </span>
                </p>
              </div>
              <pre className="rounded-xl bg-slate-50 border border-slate-200 p-3 font-mono text-[11px] text-slate-700 overflow-x-auto">
                {JSON.stringify(activeResult.parameters, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
