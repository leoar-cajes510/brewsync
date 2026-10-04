import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkInputFile, fitWithin, MAX_INPUT_BYTES } from './productImage';
import { deleteProductImage, uploadProductImage } from '../../../services/productService';

const file = (type: string, size = 10) => new File([new Uint8Array(size)], 'x', { type });

describe('product image optimization rules', () => {
  it('fits inside 800×800 keeping the aspect ratio', () => {
    expect(fitWithin(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1000, 4000)).toEqual({ width: 200, height: 800 });
  });

  it('never upscales smaller images', () => {
    expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 });
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
