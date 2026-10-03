import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useEscapeKey } from './Modal';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

// Slides in from the right edge; the main sidebar stays on the left.
export default function Drawer({ open, onClose, title, footer, children }: DrawerProps) {
  useEscapeKey(open, onClose);
  if (!open) return null;

  return createPortal(
    <div className="overlay overlay--drawer" onMouseDown={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}
