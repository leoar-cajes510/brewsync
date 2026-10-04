import { useRef, useState } from 'react';
import { ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import Button from '../../ui/Button';

const MAX_BYTES = 5 * 1024 * 1024;

interface ProductImageUploadProps {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}

// Local-only preview (data URL in memory). Real image storage comes later.
export default function ProductImageUpload({ value, onChange }: ProductImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const readFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (PNG, JPG, WEBP).');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Image must be 5 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError(null);
      onChange(typeof reader.result === 'string' ? reader.result : null);
    };
    reader.onerror = () => setError('Could not read that file. Try another image.');
    reader.readAsDataURL(file);
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
        }}
      >
        {value ? (
          <img src={value} alt="Product preview" className="image-upload__preview" />
        ) : (
          // Image storage is not connected yet (Q-ARCH-2): nothing picked here would be saved.
          <button type="button" className="image-upload__empty" disabled title="Available in a later phase">
            <ImagePlus size={26} />
            <strong>Product images</strong>
            <span>Available in a later phase — images are not stored yet</span>
          </button>
        )}
      </div>
      {value && (
        <div className="image-upload__actions">
          <Button size="sm" icon={<RefreshCw size={13} />} onClick={pick}>
            Replace
          </Button>
          <Button size="sm" icon={<Trash2 size={13} />} onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      )}
      {error && <span className="field__error">{error}</span>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        data-testid="product-image-input"
        onChange={(e) => {
          readFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
