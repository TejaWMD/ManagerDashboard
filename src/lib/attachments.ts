import { QueryAttachment } from '../types';

/**
 * Format bytes into readable format (e.g., 250 KB, 1.4 MB)
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const num = parseFloat((bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1));
  return `${num} ${sizes[i]}`;
}

/**
 * Get an appropriate emoji or label for a file based on name and MIME type
 */
export function getFileIcon(fileName: string, mimeType?: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const type = (mimeType || '').toLowerCase();

  if (ext === 'pdf' || type.includes('pdf')) return '📄';
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext) || type.includes('word') || type.includes('officedocument.wordprocessingml')) return '📝';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext) || type.includes('excel') || type.includes('spreadsheet') || type.includes('csv')) return '📊';
  if (['ppt', 'pptx', 'odp'].includes(ext) || type.includes('presentation') || type.includes('powerpoint')) return '📽️';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || type.startsWith('image/')) return '🖼️';
  if (['txt', 'log', 'md'].includes(ext) || type.includes('text/plain')) return '📋';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || type.includes('zip') || type.includes('compressed')) return '📦';
  return '📎';
}

/**
 * Convert a browser File object to a QueryAttachment with Base64 data URL
 */
export function readFileAsAttachment(file: File): Promise<QueryAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const uniqueId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      resolve({
        id: uniqueId,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        url: result,
        uploadedAt: new Date().toISOString(),
      });
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Helper to convert Data URL to Blob for reliable opening in new tabs
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Open attachment in a new browser tab/window safely
 */
export function openAttachment(attachment: QueryAttachment): void {
  try {
    if (attachment.url.startsWith('data:')) {
      const blob = dataUrlToBlob(attachment.url);
      const blobUrl = URL.createObjectURL(blob);
      const newWin = window.open(blobUrl, '_blank', 'noopener,noreferrer');
      if (!newWin) {
        // If popup was blocked, fallback to download
        downloadAttachment(attachment);
      } else {
        // Revoke after a short delay so the browser can load it
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      }
    } else {
      window.open(attachment.url, '_blank', 'noopener,noreferrer');
    }
  } catch {
    downloadAttachment(attachment);
  }
}

/**
 * Trigger download of the attached document with its original filename
 */
export function downloadAttachment(attachment: QueryAttachment): void {
  try {
    const link = document.createElement('a');
    link.href = attachment.url;
    link.download = attachment.name;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    console.error('Failed to download attachment:', err);
  }
}
