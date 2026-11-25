import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000,
});

export function extractErrorMessage(err, fallback = 'An unexpected error occurred.') {
  if (err?.response?.data?.detail) {
    const detail = err.response.data.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
    }
    return JSON.stringify(detail);
  }
  if (err?.message) return err.message;
  return fallback;
}

export function resolveMediaUrl(relativePath) {
  if (!relativePath) return '';
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://') || relativePath.startsWith('data:')) {
    return relativePath;
  }
  return `${API_BASE_URL}${relativePath.startsWith('/') ? '' : '/'}${relativePath}`;
}

export async function getHealth() {
  const { data } = await apiClient.get('/api/health');
  return data;
}

export async function getTechniques() {
  const { data } = await apiClient.get('/api/techniques');
  return data;
}

export async function getDashboard() {
  const { data } = await apiClient.get('/api/dashboard');
  return data;
}

export async function uploadImages(files, onProgress) {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });
  const { data } = await apiClient.post('/api/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(pct);
      }
    },
  });
  return data;
}

export async function getImages(search = '') {
  const params = search ? { search } : {};
  const { data } = await apiClient.get('/api/images', { params });
  return data;
}

export async function deleteImage(imageId) {
  const { data } = await apiClient.delete(`/api/images/${imageId}`);
  return data;
}

export async function augmentImage(payload) {
  const { data } = await apiClient.post('/api/augment', payload);
  return data;
}

export async function getResults(params = {}) {
  const { data } = await apiClient.get('/api/results', { params });
  return data;
}

export async function deleteResult(resultId) {
  const { data } = await apiClient.delete(`/api/results/${resultId}`);
  return data;
}

export async function startBatchJob(payload) {
  const { data } = await apiClient.post('/api/batch', payload);
  return data;
}

export async function getBatchJobs() {
  const { data } = await apiClient.get('/api/batch');
  return data;
}

export async function getBatchStatus(jobId) {
  const { data } = await apiClient.get(`/api/batch/${jobId}/status`);
  return data;
}

export async function retryBatchJob(jobId) {
  const { data } = await apiClient.post(`/api/batch/${jobId}/retry`);
  return data;
}

export async function getComparison(originalId) {
  const { data } = await apiClient.get(`/api/comparison/${originalId}`);
  return data;
}

export async function getSummary() {
  const { data } = await apiClient.get('/api/summary');
  return data;
}

export async function getSummaryCharts() {
  const { data } = await apiClient.get('/api/summary/charts');
  return data;
}

export async function getHistory(params = {}) {
  const { data } = await apiClient.get('/api/history', { params });
  return data;
}

export async function deleteHistoryRecord(recordId) {
  const { data } = await apiClient.delete(`/api/history/${recordId}`);
  return data;
}

export async function downloadFileFromEndpoint(endpointPath, fallbackFilename) {
  const response = await apiClient.get(endpointPath, { responseType: 'blob' });
  const disposition = response.headers['content-disposition'] || '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const filename = match ? match[1] : fallbackFilename;

  const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = blobUrl;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

export async function exportSelectedZip(resultIds) {
  const response = await apiClient.post(
    '/api/export/zip',
    { result_ids: resultIds },
    { responseType: 'blob' }
  );
  const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = blobUrl;
  link.setAttribute('download', 'reefaugment_selected_export.zip');
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

export default apiClient;
