// Client-side product image optimization (Q-ARCH-2). The server re-validates type, bytes and size.

export const PRODUCT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
/** Server limit for the optimized upload. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
/** Longest side in pixels: sharp on high-DPI POS screens. */
export const MAX_DIMENSION = 1600;
export const WEBP_QUALITY = 0.92;

export interface OptimizedImage {
  blob: Blob;
  /** Object URL for the local preview; revoke it when replaced. */
  preview: string;
}

/** Fit the longest side within max keeping the aspect ratio; never upscale. */
export function fitWithin(width: number, height: number, max = MAX_DIMENSION): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Problem with the picked file before any decoding, or null when it may be processed. */
export function checkInputFile(file: File): string | null {
  if (!PRODUCT_IMAGE_TYPES.includes(file.type)) return 'Use a PNG, JPG or WEBP image.';
  if (file.size > MAX_INPUT_BYTES) return 'Image must be 10 MB or smaller.';
  return null;
}

/** Decodes, downsizes to at most 1600 px on the longest side and re-encodes as WEBP (transparency kept). */
export async function optimizeProductImage(file: File): Promise<OptimizedImage> {
  const problem = checkInputFile(file);
  if (problem) throw new Error(problem);
  const source = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file is not a readable image.'));
      el.src = source;
    });
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process that image. Try another one.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height); // transparent canvas: alpha is preserved in WEBP/PNG
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
    // Browsers without a WEBP encoder fall back to PNG, which the server also accepts.
    if (!blob || !PRODUCT_IMAGE_TYPES.includes(blob.type)) throw new Error('Could not process that image. Try another one.');
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('This image is still larger than 3 MB after optimizing. Try a simpler image.');
    return { blob, preview: URL.createObjectURL(blob) };
  } finally {
    URL.revokeObjectURL(source);
  }
}
