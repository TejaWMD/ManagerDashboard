import { QueryAttachment } from '../types';
import { supabase } from './supabase';

/**
 * Document Upload Limits (Configured for Supabase Free Tier - 500 MB DB & PostgREST payload safety)
 * When upgrading to the Supabase Pro Plan in the future, simply increase these constants here:
 * e.g. MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024, MAX_FILES_PER_UPLOAD = 10, MAX_TOTAL_ATTACHMENTS_BYTES = 25 * 1024 * 1024
 */
export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB per file
export const MAX_FILE_SIZE_LABEL = '2MB';
export const MAX_FILES_PER_UPLOAD = 3; // Maximum 3 files per query / resolution section
export const MAX_TOTAL_ATTACHMENTS_BYTES = 4 * 1024 * 1024; // Maximum 4 MB combined per section
export const MAX_TOTAL_ATTACHMENTS_LABEL = '4MB';

// Allow raw images up to 10 MB before client-side compression shrinks them under 2 MB
const MAX_RAW_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_COMPRESS_THRESHOLD_BYTES = 350 * 1024; // Auto-compress images larger than 350 KB
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_COMPRESSION_QUALITY = 0.78;

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

function isCompressibleImage(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  return type === 'image/jpeg' || type === 'image/jpg' || type === 'image/png' || type === 'image/webp';
}

/**
 * Compress large raster images client-side on an HTML5 canvas to save Supabase Free Tier storage
 */
function compressImageFile(file: File): Promise<{ dataUrl: string; byteSize: number; mimeType: string } | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
            const ratio = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
            width = Math.max(1, Math.round(width * ratio));
            height = Math.max(1, Math.round(height * ratio));
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          // Fill white background for transparent PNGs converted to JPEG
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const outMime = 'image/jpeg';
          const dataUrl = canvas.toDataURL(outMime, IMAGE_COMPRESSION_QUALITY);
          const base64Part = dataUrl.split(',')[1] || '';
          const approxBytes = Math.round((base64Part.length * 3) / 4);
          resolve({ dataUrl, byteSize: approxBytes, mimeType: outMime });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = reader.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * Convert a browser File object to a QueryAttachment with Base64 data URL
 * Automatically compresses large images to keep Supabase Free Tier usage low.
 */
export async function readFileAsAttachment(file: File): Promise<QueryAttachment> {
  const uniqueId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (isCompressibleImage(file) && file.size > IMAGE_COMPRESS_THRESHOLD_BYTES) {
    const compressed = await compressImageFile(file);
    if (compressed && compressed.byteSize < file.size) {
      return {
        id: uniqueId,
        name: file.name,
        size: compressed.byteSize,
        type: compressed.mimeType,
        url: compressed.dataUrl,
        uploadedAt: new Date().toISOString(),
      };
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
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
 * Attempts to upload file to Supabase Storage ('query-attachments' bucket)
 * If the bucket exists, saves ~99% egress by storing a tiny CDN URL instead of a large Base64 string.
 * Gracefully falls back to compressed Base64 if bucket is missing or network upload fails.
 */
export async function uploadOrReadAttachment(file: File): Promise<QueryAttachment> {
  const uniqueId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `docs/${Date.now()}_${uniqueId}_${cleanName}`;

    const { data, error } = await supabase.storage
      .from('query-attachments')
      .upload(storagePath, file, { cacheControl: '3600', upsert: true });

    if (!error && data?.path) {
      const { data: pubData } = supabase.storage
        .from('query-attachments')
        .getPublicUrl(data.path);

      if (pubData?.publicUrl) {
        return {
          id: uniqueId,
          name: file.name,
          size: file.size,
          type: file.type || 'application/octet-stream',
          url: pubData.publicUrl,
          uploadedAt: new Date().toISOString(),
        };
      }
    }
  } catch {
    // Supabase Storage bucket not provisioned yet; fallback smoothly to Base64
  }

  // Graceful fallback to client-side compressed Base64
  return readFileAsAttachment(file);
}

/**
 * Validate and read an array of files against the Supabase Free Tier limits:
 * - Up to MAX_FILES_PER_UPLOAD files per section
 * - Up to MAX_FILE_SIZE_BYTES (2 MB) per file (after automatic image compression)
 * - Up to MAX_TOTAL_ATTACHMENTS_BYTES (4 MB) combined per section
 */
export async function validateAndReadAttachments(
  files: FileList | File[],
  existingAttachments: QueryAttachment[] = [],
  extraMetadata?: Partial<Pick<QueryAttachment, 'uploadedBy' | 'uploaderRole'>>
): Promise<{ added: QueryAttachment[]; errors: string[] }> {
  const fileArray = Array.from(files || []);
  const added: QueryAttachment[] = [];
  const errors: string[] = [];

  let currentCount = existingAttachments.length;
  let currentTotalBytes = existingAttachments.reduce((sum, a) => sum + (a.size || 0), 0);

  for (const file of fileArray) {
    if (currentCount >= MAX_FILES_PER_UPLOAD) {
      errors.push(
        `Maximum of ${MAX_FILES_PER_UPLOAD} files allowed per upload section on the current Free Plan (skipped "${file.name}").`
      );
      continue;
    }

    const isImg = isCompressibleImage(file);
    const maxRawLimit = isImg ? MAX_RAW_IMAGE_BYTES : MAX_FILE_SIZE_BYTES;

    if (file.size > maxRawLimit) {
      errors.push(
        `File "${file.name}" (${formatFileSize(file.size)}) exceeds the ${MAX_FILE_SIZE_LABEL} per-file limit (Free Plan). Please compress or choose a smaller document.`
      );
      continue;
    }

    try {
      const att = await uploadOrReadAttachment(file);

      if (att.size > MAX_FILE_SIZE_BYTES) {
        errors.push(
          `File "${file.name}" (${formatFileSize(att.size)}) exceeds the ${MAX_FILE_SIZE_LABEL} per-file limit (Free Plan). Please choose a smaller file.`
        );
        continue;
      }

      if (currentTotalBytes + att.size > MAX_TOTAL_ATTACHMENTS_BYTES) {
        errors.push(
          `Adding "${file.name}" (${formatFileSize(att.size)}) would exceed the ${MAX_TOTAL_ATTACHMENTS_LABEL} total attachment limit per query (Free Plan).`
        );
        continue;
      }

      added.push({
        ...att,
        ...(extraMetadata || {}),
      });
      currentCount += 1;
      currentTotalBytes += att.size;
    } catch (err) {
      console.error(`Error reading file ${file.name}:`, err);
      errors.push(`Failed to read file "${file.name}".`);
    }
  }

  return { added, errors };
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
