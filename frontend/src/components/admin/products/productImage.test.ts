import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkInputFile, fitWithin, MAX_DIMENSION, MAX_INPUT_BYTES, MAX_UPLOAD_BYTES, optimizeProductImage, WEBP_QUALITY } from './productImage';
import { deleteProductImage, uploadProductImage } from '../../../services/productService';

const file = (type: string, size = 10) => new File([new Uint8Array(size)], 'x', { type });

describe('product image optimization rules', () => {
  it('uses the approved high-quality settings', () => {
    expect(MAX_DIMENSION).toBe(1600);
    expect(WEBP_QUALITY).toBe(0.92);
    expect(MAX_UPLOAD_BYTES).toBe(3 * 1024 * 1024);
  });

  it('fits the longest side within 1600 px keeping the aspect ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1000, 4000)).toEqual({ width: 400, height: 1600 });
    expect(fitWithin(6000, 6000)).toEqual({ width: 1600, height: 1600 });
  });

  it('never upscales smaller images', () => {
    expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(1600, 900)).toEqual({ width: 1600, height: 900 });
  });

  it('accepts PNG, JPEG and WEBP up to 10 MB only', () => {
    expect(checkInputFile(file('image/png'))).toBeNull();
    expect(checkInputFile(file('image/jpeg'))).toBeNull();
    expect(checkInputFile(file('image/webp'))).toBeNull();
    expect(checkInputFile(file('image/svg+xml'))).toMatch(/PNG, JPG or WEBP/);
    expect(checkInputFile(file('image/gif'))).toMatch(/PNG, JPG or WEBP/);
    expect(checkInputFile(file('image/png', MAX_INPUT_BYTES + 1))).toMatch(/10 MB/);
  });
});

describe('optimizeProductImage', () => {
  const calls: { width: number; height: number; type?: string; quality?: number; drawn?: number[] } = { width: 0, height: 0 };
  let output: Blob | null;

  beforeEach(() => {
    output = new Blob([new Uint8Array(100)], { type: 'image/webp' });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:preview', revokeObjectURL: () => undefined });
    vi.stubGlobal('Image', class {
      naturalWidth = 4000;
      naturalHeight = 3000;
      onload: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => this.onload?.());
      }
    });
    vi.stubGlobal('document', {
      createElement: () => ({
        set width(v: number) { calls.width = v; },
        set height(v: number) { calls.height = v; },
        getContext: () => ({ drawImage: (_img: unknown, ...rest: number[]) => { calls.drawn = rest; } }),
        toBlob: (cb: (b: Blob | null) => void, type: string, quality: number) => {
          calls.type = type;
          calls.quality = quality;
          cb(output);
        },
      }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('downsizes a 4000×3000 photo to 1600×1200 WEBP at quality 0.92 on a transparent canvas', async () => {
    const result = await optimizeProductImage(file('image/png'));
    expect(calls).toMatchObject({ width: 1600, height: 1200, type: 'image/webp', quality: 0.92, drawn: [0, 0, 1600, 1200] });
    expect(result.blob.type).toBe('image/webp');
    expect(result.preview).toBe('blob:preview');
  });

  it('rejects output still over 3 MB', async () => {
    output = new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: 'image/webp' });
    await expect(optimizeProductImage(file('image/jpeg'))).rejects.toThrow(/3 MB/);
  });

  it('accepts the PNG fallback when the browser cannot encode WEBP', async () => {
    output = new Blob([new Uint8Array(10)], { type: 'image/png' });
    expect((await optimizeProductImage(file('image/webp'))).blob.type).toBe('image/png');
  });
});

const memoryStorage = (): Storage => {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  };
};

describe('product image API', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uploads the optimized blob as a raw body with its own type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'p1', image_url: 'https://cdn/x.webp' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
    const result = await uploadProductImage('p1', blob);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/products/p1/image');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(blob);
    expect(init.headers['Content-Type']).toBe('image/webp');
    expect(result.image_url).toBe('https://cdn/x.webp');
  });

  it('removes the image with DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'p1', image_url: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteProductImage('p1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/products/p1/image');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });
});
