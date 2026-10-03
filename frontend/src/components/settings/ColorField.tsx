import { useEffect, useId, useState } from 'react';
import { normalizeHex } from '../../stores/brandingSettingsStore';

interface ColorFieldProps {
  label: string;
  tag: string;
  description: string;
  value: string;
  onChange: (hex: string) => void;
}

// Brand color control: native color picker + hex text input kept in sync.
// Invalid hex text is shown as an error and not applied.
export default function ColorField({ label, tag, description, value, onChange }: ColorFieldProps) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const invalid = normalizeHex(text) === null;

  return (
    <div className="color-field">
      <div className="color-field__head">
        <label htmlFor={id}>{label}</label>
        <span>{tag}</span>
      </div>
      <div className="color-field__row">
        <label className="color-field__swatch" style={{ background: value }} title={`Pick ${label}`}>
          <input type="color" aria-label={`${label} picker`} value={value.toLowerCase()} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        </label>
        <input
          id={id}
          className={`input color-field__hex ${invalid ? 'input--error' : ''}`}
          spellCheck={false}
          maxLength={7}
          value={text}
          aria-invalid={invalid}
          onChange={(e) => {
            setText(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (hex && e.target.value.replace('#', '').length === 6) onChange(hex);
          }}
          onBlur={() => {
            const hex = normalizeHex(text);
            if (hex) onChange(hex);
            else setText(value);
          }}
        />
      </div>
      {invalid ? <span className="field__error">Use a hex color like #3B2620.</span> : <p className="color-field__desc">{description}</p>}
    </div>
  );
}
