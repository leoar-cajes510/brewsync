import { useEffect } from 'react';
import { CheckCircle2, Copy, FileDown, Mail, Printer } from 'lucide-react';
import Button from '../ui/Button';
import type { Receipt } from '../../types/receipt';
import { receiptCode } from '../../utils/receipt';

type Variant = 'toolbar' | 'footer';

interface ReceiptPrinterProps {
  receipt: Receipt;
  /** Records the print/reprint on the server (same number; print_count + 1). No printer driver is contacted. */
  onPrinted: (receipt: Receipt) => Promise<void>;
  variant: Variant;
  onFeedback: (message: string) => void;
}

// Receipt actions. Print/reprint is recorded by the server; email and PDF are not connected yet.
export default function ReceiptPrinter({ receipt, onPrinted, variant, onFeedback }: ReceiptPrinterProps) {
  const reprint = receipt.printCount > 0;

  const print = () => void onPrinted(receipt);

  const copyReference = async () => {
    const code = receiptCode(receipt);
    try {
      await navigator.clipboard.writeText(code);
      onFeedback(`Copied ${code}`);
    } catch {
      onFeedback(`Reference: ${code}`);
    }
  };

  if (variant === 'toolbar') {
    return (
      <div className="receipt-toolbar">
        <button type="button" className="icon-btn" title={reprint ? 'Reprint receipt' : 'Print receipt'} aria-label="Print receipt" onClick={print}>
          <Printer size={15} />
        </button>
        <button type="button" className="icon-btn" title="Copy reference" aria-label="Copy reference" onClick={copyReference}>
          <Copy size={15} />
        </button>
        <button type="button" className="icon-btn" title="Email receipt" aria-label="Email receipt" onClick={() => onFeedback('Email receipts are not available yet')}>
          <Mail size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="receipt-actions">
      <Button variant="primary" size="lg" block icon={<Printer size={18} />} onClick={print}>
        {reprint ? 'Reprint Receipt' : 'Print Receipt'}
      </Button>
      <div className="receipt-actions__secondary">
        <Button size="sm" icon={<FileDown size={14} />} onClick={() => onFeedback('PDF download is not available yet')}>
          Download PDF
        </Button>
        <Button size="sm" icon={<Copy size={14} />} onClick={copyReference}>
          Copy Reference
        </Button>
      </div>
    </div>
  );
}

/** Small auto-dismissing confirmation line for page actions. */
export function ActionFeedback({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onDone, 2500);
    return () => window.clearTimeout(id);
  }, [message, onDone]);

  if (!message) return null;
  return (
    <div className="action-feedback" role="status">
      <CheckCircle2 size={15} /> {message}
    </div>
  );
}
