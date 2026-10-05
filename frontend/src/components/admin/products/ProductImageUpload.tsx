import { useRef, useState } from 'react';
import { ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import Button from '../../ui/Button';
import { optimizeProductImage, type OptimizedImage } from './productImage';

interface ProductImageUploadProps {
  /** Current preview: the saved public URL or a local object URL for a newly picked image. */
  value: string | null;
  /** A newly optimized image, or null when the image is removed. Saved with the product. */
  onChange: (image: OptimizedImage | null) => void;
}

// Picks an image, optimizes it in the browser (≤ 1600 px WEBP) and hands it to the form; the form
// uploads it to POST /products/{id}/image once the product exists (Q-ARCH-2).
export default function ProductImageUpload({ value, onChange }: ProductImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await optimizeProductImage(file));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file. Try another image.');
    } finally {
      setBusy(false);
    }
  };

  const pick = () => inputRef.current?.click();

  return (
    <div className="image-upload">
      <span className="field__label">Product Image</span>
      <div
        className={`image-upload__drop ${dragging ? 'image-upload__drop--active' : ''} ${value ? 'image-upload__drop--filled' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void readFile(e.dataTransfer.files?.[0]);
        }}
      >
        {value ? (
          <img src={value} alt="Product preview" className="image-upload__preview" />
        ) : (
          <button type="button" className="image-upload__empty" onClick={pick} disabled={busy}>
            <ImagePlus size={26} />
            <strong>{busy ? 'Optimizing…' : 'Add product image'}</strong>
            <span>PNG, JPG or WEBP · up to 10 MB · resized to 1600 px</span>
          </button>
        )}
      </div>
      {value && (
        <div className="image-upload__actions">
          <Button size="sm" icon={<RefreshCw size={13} />} onClick={pick} disabled={busy}>
            {busy ? 'Optimizing…' : 'Replace'}
          </Button>
          <Button size="sm" icon={<Trash2 size={13} />} onClick={() => onChange(null)} disabled={busy}>
            Remove
          </Button>
        </div>
      )}
      {error && <span className="field__error">{error}</span>}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        data-testid="product-image-input"
        onChange={(e) => {
          void readFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
