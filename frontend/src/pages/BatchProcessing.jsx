import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers,
  Play,
  Download,
  RefreshCw,
  UploadCloud,
  CheckSquare,
  Square,
  Sliders,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  downloadFileFromEndpoint,
  extractErrorMessage,
  getBatchJobs,
  getBatchStatus,
  getImages,
  getTechniques,
  resolveMediaUrl,
  retryBatchJob,
  startBatchJob,
  uploadImages,
} from '../services/api';
import { useToast } from '../components/ToastContext';
import TechniqueControls, { buildDefaultParams } from '../components/TechniqueControls';
import {
  EmptyState,
  ErrorBanner,
  LoadingSpinner,
  StatusBadge,
  formatDateTime,
} from '../components/UiStates';

export default function BatchProcessing() {
  const [images, setImages] = useState([]);
  const [techniques, setTechniques] = useState([]);
  const [recentJobs, setRecentJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedImageIds, setSelectedImageIds] = useState([]);
  const [selectedTechKeys, setSelectedTechKeys] = useState([]);
  const [variations, setVariations] = useState(2);
  const [techParams, setTechParams] = useState({});
  const [activeConfigTech, setActiveConfigTech] = useState(null);

  const [uploadingInline, setUploadingInline] = useState(false);
  const [startingBatch, setStartingBatch] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [activeJob, setActiveJob] = useState(null);

  const fileInputRef = useRef(null);
  const pollTimerRef = useRef(null);
  const toast = useToast();

  const loadInitialData = async () => {
    setLoading(true);
    setError('');
    try {
      const [imgs, techs, jobs] = await Promise.all([
        getImages(),
        getTechniques(),
        getBatchJobs(),
      ]);
      setImages(imgs);
      setTechniques(techs);
      setRecentJobs(jobs);

      const defaultsMap = {};
      techs.forEach((t) => {
        defaultsMap[t.key] = buildDefaultParams(t);
      });
      setTechParams(defaultsMap);

      if (imgs.length > 0 && selectedImageIds.length === 0) {
        setSelectedImageIds(imgs.map((i) => i.id));
      }
      if (techs.length > 0 && selectedTechKeys.length === 0) {
        setSelectedTechKeys([techs[0].key]);
        setActiveConfigTech(techs[0].key);
      }
      if (jobs.length > 0 && !activeJob) {
        setActiveJob(jobs[0]);
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Failed to load batch processing data.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, []);

  // Poll active job status while pending/processing
  useEffect(() => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (!activeJob || (activeJob.status !== 'pending' && activeJob.status !== 'processing')) {
      return;
    }

    pollTimerRef.current = window.setInterval(async () => {
      try {
        const updated = await getBatchStatus(activeJob.id);
        setActiveJob(updated);
        if (updated.status !== 'pending' && updated.status !== 'processing') {
          window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          const refreshedJobs = await getBatchJobs();
          setRecentJobs(refreshedJobs);
          if (updated.failed_images > 0) {
            toast.info(
              `Batch #${updated.id} finished: ${updated.completed_images} succeeded, ${updated.failed_images} failed.`
            );
          } else {
            toast.success(
              `Batch #${updated.id} completed (${updated.completed_images} images generated).`
            );
          }
        }
      } catch {
        // Transient poll ignore
      }
    }, 800);

    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, [activeJob?.id, activeJob?.status]);

  const techMap = useMemo(() => {
    const map = {};
    techniques.forEach((t) => {
      map[t.key] = t;
    });
    return map;
  }, [techniques]);

  const handleInlineUpload = async (filesList) => {
    const files = Array.from(filesList || []);
    if (files.length === 0) return;
    setUploadingInline(true);
    try {
      const res = await uploadImages(files);
      if (res.uploaded?.length > 0) {
        toast.success(`Uploaded ${res.uploaded.length} image(s) and added to batch selection.`);
        const updatedImgs = await getImages();
        setImages(updatedImgs);
        const newIds = res.uploaded.map((u) => u.id);
        setSelectedImageIds((prev) => Array.from(new Set([...prev, ...newIds])));
      }
      if (res.errors?.length > 0) {
        res.errors.forEach((e) => toast.error(`${e.filename}: ${e.error}`));
      }
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Inline upload failed.'));
    } finally {
      setUploadingInline(false);
    }
  };

  const toggleImage = (id) => {
    setSelectedImageIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleTechnique = (key) => {
    setSelectedTechKeys((prev) => {
      const exists = prev.includes(key);
      const next = exists ? prev.filter((k) => k !== key) : [...prev, key];
      if (!exists) setActiveConfigTech(key);
      return next;
    });
  };

  const expectedTotal = selectedImageIds.length * selectedTechKeys.length * variations;

  const handleStartBatch = async () => {
    if (selectedImageIds.length === 0) {
      toast.error('Select at least one uploaded image.');
      return;
    }
    if (selectedTechKeys.length === 0) {
      toast.error('Select at least one augmentation technique.');
      return;
    }
    setStartingBatch(true);
    try {
      const subsetParams = {};
      selectedTechKeys.forEach((key) => {
        subsetParams[key] = techParams[key] || {};
      });
      const job = await startBatchJob({
        image_ids: selectedImageIds,
        techniques: selectedTechKeys,
        variations_per_technique: variations,
        technique_parameters: subsetParams,
      });
      setActiveJob(job);
      toast.info(`Batch job #${job.id} started (${job.total_images} expected outputs).`);
      const refreshed = await getBatchJobs();
      setRecentJobs(refreshed);
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to start batch processing.'));
    } finally {
      setStartingBatch(false);
    }
  };

  const handleRetryFailed = async () => {
    if (!activeJob) return;
    setRetrying(true);
    try {
      const updated = await retryBatchJob(activeJob.id);
      setActiveJob(updated);
      toast.success(`Retried failed items in batch #${updated.id}.`);
      const refreshed = await getBatchJobs();
      setRecentJobs(refreshed);
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to retry failed items.'));
    } finally {
      setRetrying(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading Batch Processing workspace..." />;
  if (error) return <ErrorBanner message={error} onRetry={loadInitialData} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Step 1: Select or Upload Images */}
        <div className="lg:col-span-5 rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">1. Select Images ({selectedImageIds.length}/{images.length})</h2>
              <p className="text-xs text-slate-500">Choose source images or upload more directly</p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingInline}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-50 border border-cyan-200 px-3 py-1.5 text-xs font-semibold text-cyan-800 hover:bg-cyan-100 cursor-pointer disabled:opacity-50"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              {uploadingInline ? 'Uploading...' : 'Add Images'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={(e) => {
                handleInlineUpload(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {images.length === 0 ? (
            <EmptyState
              icon={UploadCloud}
              title="No images uploaded yet"
              description="Click 'Add Images' above to upload underwater species images for batch augmentation."
            />
          ) : (
            <>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedImageIds(images.map((i) => i.id))}
                  className="font-semibold text-cyan-700 hover:underline cursor-pointer"
                >
                  Select All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedImageIds([])}
                  className="font-semibold text-slate-500 hover:underline cursor-pointer"
                >
                  Clear Selection
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-80 overflow-y-auto pr-1">
                {images.map((img) => {
                  const selected = selectedImageIds.includes(img.id);
                  return (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => toggleImage(img.id)}
                      className={`relative rounded-xl overflow-hidden border-2 text-left transition cursor-pointer ${
                        selected
                          ? 'border-cyan-500 ring-2 ring-cyan-500/20'
                          : 'border-slate-200 opacity-75 hover:opacity-100'
                      }`}
                    >
                      <div className="aspect-[4/3] bg-slate-100">
                        <img
                          src={resolveMediaUrl(img.image_url)}
                          alt={img.original_filename}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="p-1.5 bg-white">
                        <p className="text-[11px] font-semibold text-slate-800 truncate">
                          {img.original_filename}
                        </p>
                      </div>
                      <span className="absolute top-1.5 right-1.5 rounded-md bg-white/90 p-0.5 text-cyan-700 shadow">
                        {selected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-400" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Step 2 & 3: Techniques, Parameters & Variations */}
        <div className="lg:col-span-7 rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                2. Techniques & Variations ({selectedTechKeys.length}/15 selected)
              </h2>
              <p className="text-xs text-slate-500">
                Pick multiple techniques and tune base parameters per technique
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => setSelectedTechKeys(techniques.map((t) => t.key))}
                className="font-semibold text-cyan-700 hover:underline cursor-pointer"
              >
                Select All 15
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={() => setSelectedTechKeys([])}
                className="font-semibold text-slate-500 hover:underline cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {techniques.map((tech) => {
              const checked = selectedTechKeys.includes(tech.key);
              const isConfigActive = activeConfigTech === tech.key;
              return (
                <div
                  key={tech.key}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs transition ${
                    checked
                      ? 'bg-cyan-50/70 border-cyan-300 text-cyan-950'
                      : 'bg-slate-50/60 border-slate-200 text-slate-700'
                  }`}
                >
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTechnique(tech.key)}
                      className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
                    />
                    <span className="font-semibold truncate">{tech.name}</span>
                  </label>
                  {tech.parameters.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setActiveConfigTech(tech.key)}
                      className={`p-1 rounded-lg cursor-pointer ${
                        isConfigActive
                          ? 'bg-cyan-600 text-white'
                          : 'text-slate-400 hover:text-cyan-700'
                      }`}
                      title={`Configure ${tech.name} parameters`}
                    >
                      <Sliders className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Active Technique Parameter Configuration */}
          {activeConfigTech && techMap[activeConfigTech] && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">
                  Parameters for: {techMap[activeConfigTech].name}
                </span>
                <span className="text-[11px] text-slate-500">
                  Variations automatically add controlled diversity around these base values
                </span>
              </div>
              <TechniqueControls
                techniqueMeta={techMap[activeConfigTech]}
                values={techParams[activeConfigTech] || {}}
                onChange={(vals) =>
                  setTechParams((prev) => ({
                    ...prev,
                    [activeConfigTech]: vals,
                  }))
                }
              />
            </div>
          )}

          {/* Variations & Expected Calculation */}
          <div className="rounded-xl bg-gradient-to-r from-[#07213e] to-[#0b3b5c] p-4 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-cyan-200">
                Variations per Technique per Image
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={variations}
                  onChange={(e) =>
                    setVariations(Math.max(1, Math.min(20, parseInt(e.target.value || '1', 10))))
                  }
                  className="w-24 rounded-lg bg-white/10 border border-white/20 px-3 py-1.5 text-sm font-bold text-white focus:outline-none focus:border-cyan-400"
                />
                <span className="text-xs text-cyan-100/80">
                  {selectedImageIds.length} images × {selectedTechKeys.length} techniques × {variations} variations ={' '}
                  <strong className="text-cyan-300 text-sm">{expectedTotal} expected images</strong>
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartBatch}
              disabled={startingBatch || expectedTotal === 0}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 text-xs font-bold text-slate-950 hover:bg-cyan-300 transition cursor-pointer disabled:opacity-50 shrink-0"
            >
              <Play className="w-4 h-4" />
              {startingBatch ? 'Starting Batch...' : 'Start Batch Processing'}
            </button>
          </div>
        </div>
      </div>

      {/* Active Batch Job Progress & Results */}
      {activeJob && (
        <div className="rounded-2xl bg-white p-6 shadow-xs ring-1 ring-slate-200/80 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-50 text-cyan-700 flex items-center justify-center">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h3 className="text-base font-bold text-slate-900">Batch Job #{activeJob.id}</h3>
                  <StatusBadge status={activeJob.status} />
                </div>
                <p className="text-xs text-slate-500">
                  Started {formatDateTime(activeJob.created_at)}
                  {activeJob.completed_at ? ` • Finished ${formatDateTime(activeJob.completed_at)}` : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {activeJob.failed_images > 0 && (
                <button
                  type="button"
                  onClick={handleRetryFailed}
                  disabled={retrying}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
                  Retry Failed ({activeJob.failed_images})
                </button>
              )}
              {activeJob.completed_images > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    downloadFileFromEndpoint(
                      `/api/batch/${activeJob.id}/download`,
                      `reefaugment_batch_${activeJob.id}.zip`
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:from-cyan-700 hover:to-teal-700 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Batch ZIP ({activeJob.completed_images})
                </button>
              )}
            </div>
          </div>

          {/* Progress Bar & Counts */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-4">
                <span className="font-semibold text-slate-700">
                  Expected: <strong>{activeJob.total_images}</strong>
                </span>
                <span className="inline-flex items-center gap-1 font-semibold text-teal-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Completed: {activeJob.completed_images}
                </span>
                <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Failed: {activeJob.failed_images}
                </span>
              </div>
              <span className="font-mono font-bold text-cyan-800">{activeJob.progress_percent}%</span>
            </div>
            <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-teal-500 transition-all duration-300"
                style={{ width: `${activeJob.progress_percent}%` }}
              />
            </div>
          </div>

          {/* Individual Item Results */}
          {activeJob.items && activeJob.items.length > 0 && (
            <div className="overflow-x-auto max-h-96 overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 sticky top-0">
                  <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="py-2.5 px-3">Preview</th>
                    <th className="py-2.5 px-3">Original File</th>
                    <th className="py-2.5 px-3">Technique</th>
                    <th className="py-2.5 px-3">Variation</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Output / Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {activeJob.items.map((item) => (
                    <tr key={item.history_id} className="hover:bg-slate-50/70">
                      <td className="py-2 px-3">
                        {item.image_url ? (
                          <img
                            src={resolveMediaUrl(item.image_url)}
                            alt={item.output_filename}
                            className="w-12 h-10 rounded-lg object-cover bg-slate-200"
                          />
                        ) : (
                          <div className="w-12 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400">
                            <Clock className="w-4 h-4" />
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 font-medium text-slate-800">{item.original_filename}</td>
                      <td className="py-2 px-3 text-slate-700">{techMap[item.technique]?.name || item.technique}</td>
                      <td className="py-2 px-3 font-mono text-slate-600">#{item.variation_index}</td>
                      <td className="py-2 px-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="py-2 px-3">
                        {item.error_message ? (
                          <span className="text-rose-600">{item.error_message}</span>
                        ) : (
                          <span className="font-mono text-slate-600">{item.output_filename}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Recent Batch Jobs Selector */}
      {recentJobs.length > 0 && (
        <div className="rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Recent Batch Jobs</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recentJobs.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => setActiveJob(job)}
                className={`text-left rounded-xl border p-3.5 transition cursor-pointer ${
                  activeJob?.id === job.id
                    ? 'border-cyan-500 bg-cyan-50/50 ring-1 ring-cyan-500/30'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">Batch #{job.id}</span>
                  <StatusBadge status={job.status} />
                </div>
                <p className="text-xs text-slate-600 mt-1.5">
                  {job.completed_images}/{job.total_images} generated
                  {job.failed_images > 0 ? ` • ${job.failed_images} failed` : ''}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">{formatDateTime(job.created_at)}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
