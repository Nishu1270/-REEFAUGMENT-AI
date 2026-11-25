import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Wand2,
  Eye,
  Save,
  Download,
  RotateCcw,
  Plus,
  Trash2,
  SplitSquareHorizontal,
  UploadCloud,
  Sparkles,
  Layers,
} from 'lucide-react';
import {
  augmentImage,
  downloadFileFromEndpoint,
  extractErrorMessage,
  getImages,
  getTechniques,
  resolveMediaUrl,
} from '../services/api';
import { useToast } from '../components/ToastContext';
import TechniqueControls, { buildDefaultParams } from '../components/TechniqueControls';
import {
  EmptyState,
  ErrorBanner,
  LoadingSpinner,
  formatBytes,
} from '../components/UiStates';

export default function AugmentationStudio() {
  const [searchParams] = useSearchParams();
  const initialImageId = searchParams.get('imageId');

  const [images, setImages] = useState([]);
  const [techniques, setTechniques] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedImageId, setSelectedImageId] = useState(null);
  const [pipelineMode, setPipelineMode] = useState(false);

  // Single mode state
  const [selectedTechKey, setSelectedTechKey] = useState('horizontal_flip');
  const [singleParams, setSingleParams] = useState({});

  // Pipeline mode state
  const [pipelineSteps, setPipelineSteps] = useState([]);

  // Output state
  const [processing, setProcessing] = useState(false);
  const [previewOutput, setPreviewOutput] = useState(null); // unsaved preview response
  const [savedOutput, setSavedOutput] = useState(null); // saved AugmentationResultResponse

  const toast = useToast();

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setError('');
      try {
        const [imgs, techs] = await Promise.all([getImages(), getTechniques()]);
        setImages(imgs);
        setTechniques(techs);

        if (techs.length > 0) {
          const defaultTech = techs[0];
          setSelectedTechKey(defaultTech.key);
          setSingleParams(buildDefaultParams(defaultTech));
          setPipelineSteps([
            {
              id: 'step_1',
              technique: defaultTech.key,
              parameters: buildDefaultParams(defaultTech),
            },
          ]);
        }

        if (imgs.length > 0) {
          const parsedId = initialImageId ? parseInt(initialImageId, 10) : null;
          const found = imgs.find((i) => i.id === parsedId);
          setSelectedImageId(found ? found.id : imgs[0].id);
        }
      } catch (err) {
        setError(extractErrorMessage(err, 'Failed to initialize Augmentation Studio.'));
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [initialImageId]);

  const techMap = useMemo(() => {
    const map = {};
    techniques.forEach((t) => {
      map[t.key] = t;
    });
    return map;
  }, [techniques]);

  const selectedImage = useMemo(
    () => images.find((i) => i.id === Number(selectedImageId)) || null,
    [images, selectedImageId]
  );

  const activeTechMeta = techMap[selectedTechKey] || null;

  const handleSelectTechnique = (techKey) => {
    setSelectedTechKey(techKey);
    const meta = techMap[techKey];
    setSingleParams(buildDefaultParams(meta));
  };

  const handleAddPipelineStep = () => {
    if (!activeTechMeta) return;
    setPipelineSteps((prev) => [
      ...prev,
      {
        id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        technique: activeTechMeta.key,
        parameters: buildDefaultParams(activeTechMeta),
      },
    ]);
  };

  const updateStepTech = (stepId, newTechKey) => {
    const meta = techMap[newTechKey];
    setPipelineSteps((prev) =>
      prev.map((s) =>
        s.id === stepId ? { ...s, technique: newTechKey, parameters: buildDefaultParams(meta) } : s
      )
    );
  };

  const updateStepParams = (stepId, newParams) => {
    setPipelineSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, parameters: newParams } : s))
    );
  };

  const removePipelineStep = (stepId) => {
    setPipelineSteps((prev) => prev.filter((s) => s.id !== stepId));
  };

  const buildPayload = (saveToGallery) => {
    if (pipelineMode) {
      return {
        image_id: Number(selectedImageId),
        steps: pipelineSteps.map((s) => ({
          technique: s.technique,
          parameters: s.parameters,
        })),
        save_to_gallery: saveToGallery,
      };
    }
    return {
      image_id: Number(selectedImageId),
      technique: selectedTechKey,
      parameters: singleParams,
      save_to_gallery: saveToGallery,
    };
  };

  const handleRunAugmentation = async (saveToGallery) => {
    if (!selectedImageId) {
      toast.error('Please select an uploaded image first.');
      return;
    }
    if (pipelineMode && pipelineSteps.length === 0) {
      toast.error('Add at least one step to the sequential pipeline.');
      return;
    }

    setProcessing(true);
    try {
      const res = await augmentImage(buildPayload(saveToGallery));
      if (saveToGallery) {
        setSavedOutput(res);
        setPreviewOutput(null);
        toast.success(`Generated and saved '${res.output_filename}' to Results Gallery.`);
      } else {
        setPreviewOutput(res);
        setSavedOutput(null);
        toast.info('Preview generated by Python backend. Click "Save to Gallery" to keep it.');
      }
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Image augmentation failed.'), 'Processing Error');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadOutput = async () => {
    if (savedOutput) {
      try {
        await downloadFileFromEndpoint(savedOutput.download_url, savedOutput.output_filename);
      } catch (err) {
        toast.error(extractErrorMessage(err, 'Failed to download result.'));
      }
      return;
    }
    if (previewOutput?.preview_data_url) {
      const link = document.createElement('a');
      link.href = previewOutput.preview_data_url;
      link.download = `preview_${previewOutput.technique}_${selectedImage?.original_filename || 'image.png'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  };

  if (loading) return <LoadingSpinner label="Loading Augmentation Studio..." />;
  if (error) return <ErrorBanner message={error} />;

  if (images.length === 0) {
    return (
      <EmptyState
        icon={UploadCloud}
        title="No Underwater Images Available"
        description="Upload at least one underwater species image first to start experimenting in the Augmentation Studio."
        action={
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-700 transition"
          >
            <UploadCloud className="w-4 h-4" />
            Go to Image Upload
          </Link>
        }
      />
    );
  }

  const displayedOutputUrl = savedOutput
    ? resolveMediaUrl(savedOutput.image_url)
    : previewOutput?.preview_data_url || null;

  const activeOutputMeta = savedOutput || previewOutput;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* LEFT PANEL: Source Selection & Original Preview */}
      <div className="xl:col-span-4 rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">1. Select Source Image</h2>
          <p className="text-xs text-slate-500 mt-0.5">Original image remains untouched on disk</p>
        </div>

        <select
          value={selectedImageId || ''}
          onChange={(e) => {
            setSelectedImageId(Number(e.target.value));
            setPreviewOutput(null);
            setSavedOutput(null);
          }}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-800 focus:bg-white focus:border-cyan-500 focus:outline-none"
        >
          {images.map((img) => (
            <option key={img.id} value={img.id}>
              {img.original_filename} ({img.width}x{img.height})
            </option>
          ))}
        </select>

        {selectedImage && (
          <div className="space-y-3">
            <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-950/5 aspect-[4/3] flex items-center justify-center">
              <img
                src={resolveMediaUrl(selectedImage.image_url)}
                alt={selectedImage.original_filename}
                className="max-h-full max-w-full object-contain"
              />
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-2">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Dimensions</span>
                <span className="block text-xs font-bold text-slate-800 mt-0.5">
                  {selectedImage.width}x{selectedImage.height}
                </span>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-2">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Format</span>
                <span className="block text-xs font-bold text-slate-800 mt-0.5">
                  {selectedImage.file_format}
                </span>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-2">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">Size</span>
                <span className="block text-xs font-bold text-slate-800 mt-0.5">
                  {formatBytes(selectedImage.file_size)}
                </span>
              </div>
            </div>

            {/* Thumbnail Strip */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Quick Switch
              </p>
              <div className="grid grid-cols-4 gap-2 max-h-36 overflow-y-auto pr-1">
                {images.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => {
                      setSelectedImageId(img.id);
                      setPreviewOutput(null);
                      setSavedOutput(null);
                    }}
                    className={`rounded-lg overflow-hidden border-2 aspect-square cursor-pointer transition ${
                      img.id === selectedImage.id
                        ? 'border-cyan-500 ring-2 ring-cyan-500/30'
                        : 'border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    <img
                      src={resolveMediaUrl(img.image_url)}
                      alt={img.original_filename}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CENTER PANEL: Technique Selection & Parameter Controls */}
      <div className="xl:col-span-4 rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">2. Configure Augmentation</h2>
            <p className="text-xs text-slate-500 mt-0.5">All 15 real Python CV & underwater ops</p>
          </div>

          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setPipelineMode(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                !pipelineMode ? 'bg-white text-cyan-800 shadow-2xs' : 'text-slate-600'
              }`}
            >
              Single
            </button>
            <button
              type="button"
              onClick={() => setPipelineMode(true)}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                pipelineMode ? 'bg-white text-cyan-800 shadow-2xs' : 'text-slate-600'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Sequential
            </button>
          </div>
        </div>

        {!pipelineMode ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700">
                Augmentation Technique (15 Available)
              </label>
              <select
                value={selectedTechKey}
                onChange={(e) => handleSelectTechnique(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-900 focus:bg-white focus:border-cyan-500 focus:outline-none"
              >
                {techniques.map((t) => (
                  <option key={t.key} value={t.key}>
                    [{t.category}] {t.name}
                  </option>
                ))}
              </select>
              {activeTechMeta && (
                <p className="text-xs text-slate-500 leading-relaxed pt-1">
                  {activeTechMeta.description}
                </p>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Parameters
                </span>
                {activeTechMeta?.parameters?.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSingleParams(buildDefaultParams(activeTechMeta))}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-700 hover:text-cyan-800 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset Defaults
                  </button>
                )}
              </div>
              <TechniqueControls
                techniqueMeta={activeTechMeta}
                values={singleParams}
                onChange={setSingleParams}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                Apply multiple compatible techniques in sequence:
              </p>
              <button
                type="button"
                onClick={handleAddPipelineStep}
                className="inline-flex items-center gap-1 rounded-xl bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800 border border-cyan-200 hover:bg-cyan-100 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Step
              </button>
            </div>

            <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
              {pipelineSteps.map((step, index) => {
                const meta = techMap[step.technique];
                return (
                  <div
                    key={step.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-cyan-800">Step {index + 1}</span>
                      {pipelineSteps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePipelineStep(step.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                          title="Remove step"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <select
                      value={step.technique}
                      onChange={(e) => updateStepTech(step.id, e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                    >
                      {techniques.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <TechniqueControls
                      techniqueMeta={meta}
                      values={step.parameters}
                      onChange={(vals) => updateStepParams(step.id, vals)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT PANEL: Augmented Output Preview & Actions */}
      <div className="xl:col-span-4 rounded-2xl bg-white p-5 shadow-xs ring-1 ring-slate-200/80 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">3. Augmented Result</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Preview or save real backend-processed output
          </p>
        </div>

        <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-950/5 aspect-[4/3] flex items-center justify-center relative">
          {displayedOutputUrl ? (
            <img
              src={displayedOutputUrl}
              alt="Augmented preview"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div className="text-center p-6 text-slate-400">
              <Sparkles className="w-8 h-8 mx-auto mb-2 text-cyan-500/60" />
              <p className="text-xs font-medium text-slate-600">
                Click <span className="font-bold">Preview</span> or{' '}
                <span className="font-bold">Generate & Save</span> to run Python augmentation
              </p>
            </div>
          )}

          {savedOutput && (
            <span className="absolute top-2.5 right-2.5 rounded-full bg-teal-600 px-2.5 py-0.5 text-[10px] font-bold text-white shadow">
              Saved to Gallery
            </span>
          )}
          {previewOutput && !savedOutput && (
            <span className="absolute top-2.5 right-2.5 rounded-full bg-amber-500 px-2.5 py-0.5 text-[10px] font-bold text-slate-950 shadow">
              Unsaved Preview
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => handleRunAugmentation(false)}
            disabled={processing}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer disabled:opacity-60"
          >
            <Eye className="w-4 h-4 text-cyan-600" />
            {processing ? 'Processing...' : 'Preview Result'}
          </button>

          <button
            type="button"
            onClick={() => handleRunAugmentation(true)}
            disabled={processing}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:from-cyan-700 hover:to-teal-700 transition cursor-pointer disabled:opacity-60"
          >
            <Wand2 className="w-4 h-4" />
            {processing ? 'Generating...' : 'Generate & Save'}
          </button>
        </div>

        {previewOutput && !savedOutput && (
          <button
            type="button"
            onClick={() => handleRunAugmentation(true)}
            disabled={processing}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-teal-700 transition cursor-pointer"
          >
            <Save className="w-4 h-4" />
            Save Result to Results Gallery
          </button>
        )}

        {activeOutputMeta && (
          <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-600">Applied Technique</span>
              <span className="font-bold text-cyan-800">
                {savedOutput ? savedOutput.technique_label : activeTechMeta?.name || activeOutputMeta.technique}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-600">Output Dimensions</span>
              <span className="font-mono text-slate-800">
                {activeOutputMeta.width}x{activeOutputMeta.height}px
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-600">File Size</span>
              <span className="font-mono text-slate-800">{formatBytes(activeOutputMeta.file_size)}</span>
            </div>
            <div className="text-[11px] text-slate-600">
              <span className="font-semibold block mb-1">Parameters:</span>
              <pre className="rounded-lg bg-white border border-slate-200 p-2 overflow-x-auto text-[11px] font-mono text-slate-700">
                {JSON.stringify(activeOutputMeta.parameters, null, 2)}
              </pre>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={handleDownloadOutput}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download
              </button>
              {savedOutput && (
                <Link
                  to={`/comparison?originalId=${savedOutput.original_image_id}&resultId=${savedOutput.id}`}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-cyan-50 border border-cyan-200 px-3 py-2 text-xs font-semibold text-cyan-800 hover:bg-cyan-100"
                >
                  <SplitSquareHorizontal className="w-3.5 h-3.5" />
                  Compare
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
