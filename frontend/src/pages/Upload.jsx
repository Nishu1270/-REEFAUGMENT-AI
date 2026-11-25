import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  UploadCloud,
  Trash2,
  Wand2,
  Download,
  FileImage,
  X,
  CheckCircle2,
  Search,
} from 'lucide-react';
import {
  deleteImage,
  downloadFileFromEndpoint,
  extractErrorMessage,
  getImages,
  resolveMediaUrl,
  uploadImages,
} from '../services/api';
import { useToast } from '../components/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  EmptyState,
  ErrorBanner,
  LoadingSpinner,
  formatBytes,
  formatDateTime,
} from '../components/UiStates';

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_SIZE_BYTES = 25 * 1024 * 1024;

function readImageDimensions(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: null, height: null });
    img.src = url;
  });
}

export default function Upload() {
  const [queuedFiles, setQueuedFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [savedImages, setSavedImages] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState('');
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const inputRef = useRef(null);
  const toast = useToast();

  const fetchSavedImages = async (query = search) => {
    setLoadingList(true);
    setListError('');
    try {
      const items = await getImages(query);
      setSavedImages(items);
    } catch (err) {
      setListError(extractErrorMessage(err, 'Failed to load uploaded images.'));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchSavedImages('');
  }, []);

  useEffect(() => {
    return () => {
      queuedFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  const addFilesToQueue = async (fileList) => {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;

    const accepted = [];
    for (const file of incoming) {
      const lowerName = file.name.toLowerCase();
      const validExt = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
      if (!validExt) {
        toast.error(`'${file.name}' is not a supported format (JPG, JPEG, PNG, WEBP).`, 'Invalid File');
        continue;
      }
      if (file.size <= 0) {
        toast.error(`'${file.name}' is empty.`, 'Invalid File');
        continue;
      }
      if (file.size > MAX_SIZE_BYTES) {
        toast.error(`'${file.name}' exceeds the 25 MB limit.`, 'File Too Large');
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      const dims = await readImageDimensions(previewUrl);
      accepted.push({
        id: `${file.name}_${file.size}_${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl,
        width: dims.width,
        height: dims.height,
      });
    }
    if (accepted.length > 0) {
      setQueuedFiles((prev) => [...prev, ...accepted]);
    }
  };

  const removeQueuedFile = (id) => {
    setQueuedFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  const handleUpload = async () => {
    if (queuedFiles.length === 0) return;
    setUploading(true);
    setProgress(0);
    try {
      const result = await uploadImages(
        queuedFiles.map((q) => q.file),
        (pct) => setProgress(pct)
      );
      if (result.uploaded?.length > 0) {
        toast.success(
          `Uploaded ${result.uploaded.length} underwater image(s) to local storage.`
        );
      }
      if (result.errors?.length > 0) {
        result.errors.forEach((e) => toast.error(`${e.filename}: ${e.error}`, 'Partial Upload Warning'));
      }
      queuedFiles.forEach((q) => URL.revokeObjectURL(q.previewUrl));
      setQueuedFiles([]);
      setProgress(0);
      await fetchSavedImages(search);
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to upload image(s).'), 'Upload Failed');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteImage(deleteTarget.id);
      toast.success(`Removed '${deleteTarget.original_filename}'.`);
      setDeleteTarget(null);
      await fetchSavedImages(search);
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Failed to delete uploaded image.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Dropzone Card */}
      <div className="rounded-2xl bg-white p-6 shadow-xs ring-1 ring-slate-200/80">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Upload Underwater Species Images</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Supported formats: JPG, JPEG, PNG, WEBP (max 25 MB per file). Originals are always preserved separately.
            </p>
          </div>
          {queuedFiles.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-800 border border-cyan-200">
              {queuedFiles.length} file(s) ready
            </span>
          )}
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFilesToQueue(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`rounded-2xl border-2 border-dashed p-8 text-center transition cursor-pointer ${
            dragging
              ? 'border-cyan-500 bg-cyan-50/70'
              : 'border-slate-300 bg-slate-50/70 hover:border-cyan-400 hover:bg-cyan-50/30'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              addFilesToQueue(e.target.files);
              e.target.value = '';
            }}
          />
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center text-white shadow-md shadow-cyan-500/20 mb-3">
            <UploadCloud className="w-7 h-7" />
          </div>
          <p className="text-sm font-semibold text-slate-800">
            Drag and drop underwater images here, or{' '}
            <span className="text-cyan-700 underline">browse files</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Select single or multiple coral, fish, sea turtle, or benthic photos
          </p>
        </div>

        {/* Staged Queue */}
        {queuedFiles.length > 0 && (
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {queuedFiles.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5"
                >
                  <img
                    src={item.previewUrl}
                    alt={item.file.name}
                    className="w-16 h-16 rounded-lg object-cover bg-slate-200 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">{item.file.name}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {formatBytes(item.file.size)}
                      {item.width && item.height ? ` • ${item.width}x${item.height}px` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeQueuedFile(item.id)}
                    disabled={uploading}
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                    aria-label={`Remove ${item.file.name}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {uploading && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium text-slate-600">
                  <span>Uploading to ReefAugment AI backend...</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-teal-500 transition-all duration-150"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  queuedFiles.forEach((q) => URL.revokeObjectURL(q.previewUrl));
                  setQueuedFiles([]);
                }}
                disabled={uploading}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                Clear Queue
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-cyan-600 to-teal-600 rounded-xl shadow-sm hover:from-cyan-700 hover:to-teal-700 transition cursor-pointer disabled:opacity-60"
              >
                <CheckCircle2 className="w-4 h-4" />
                {uploading ? `Uploading (${progress}%)...` : `Upload ${queuedFiles.length} Image(s)`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Uploaded Dataset Library */}
      <div className="rounded-2xl bg-white p-6 shadow-xs ring-1 ring-slate-200/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Original Image Dataset ({savedImages.length})
            </h2>
            <p className="text-xs text-slate-500">
              Preserved source underwater images stored safely on local disk
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                fetchSavedImages(e.target.value);
              }}
              placeholder="Search filename..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-xs text-slate-800 focus:bg-white focus:border-cyan-500 focus:outline-none"
            />
          </div>
        </div>

        {loadingList ? (
          <LoadingSpinner label="Loading uploaded images..." />
        ) : listError ? (
          <ErrorBanner message={listError} onRetry={() => fetchSavedImages(search)} />
        ) : savedImages.length === 0 ? (
          <EmptyState
            icon={FileImage}
            title="No uploaded images found"
            description="Upload underwater species photos above to build your source dataset."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {savedImages.map((img) => (
              <div
                key={img.id}
                className="rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-2xs hover:shadow-md transition flex flex-col"
              >
                <div className="aspect-[4/3] bg-slate-100 relative overflow-hidden">
                  <img
                    src={resolveMediaUrl(img.image_url)}
                    alt={img.original_filename}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute top-2.5 left-2.5 rounded-md bg-slate-950/75 px-2 py-0.5 text-[10px] font-bold text-white uppercase">
                    {img.file_format}
                  </span>
                  <span className="absolute top-2.5 right-2.5 rounded-md bg-cyan-600/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                    {img.augmentation_count} augmented
                  </span>
                </div>
                <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 truncate" title={img.original_filename}>
                      {img.original_filename}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {img.width} x {img.height}px • {formatBytes(img.file_size)}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {formatDateTime(img.uploaded_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                    <Link
                      to={`/studio?imageId=${img.id}`}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-cyan-50 px-2.5 py-1.5 text-xs font-semibold text-cyan-800 hover:bg-cyan-100 transition"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Augment
                    </Link>
                    <button
                      type="button"
                      onClick={() =>
                        downloadFileFromEndpoint(`/api/images/${img.id}/download`, img.original_filename)
                      }
                      className="p-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
                      title="Download original"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(img)}
                      className="p-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 cursor-pointer"
                      title="Delete original image"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Uploaded Image?"
        message={`Deleting '${deleteTarget?.original_filename}' will remove the original file and its dependent augmented versions from local storage. Processing history logs are preserved.`}
        confirmLabel="Delete Image"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
