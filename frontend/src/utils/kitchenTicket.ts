// Kitchen ticket: a print-only preparation slip (order number, type, items, choices, note).
// It is NOT a receipt or sales document — it never calls the API, so it never changes document
// print counters or the reprint audit trail.

export interface KitchenTicket {
  number: string;
  orderType: string;
  tag?: string;
  placedAt: Date;
  items: { name: string; quantity: number; choices: string[] }[];
  note?: string;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export function kitchenTicketHtml(t: KitchenTicket): string {
  const items = t.items
    .map(
      (i) =>
        `<li><strong>${i.quantity}× ${escapeHtml(i.name)}</strong>${
          i.choices.length ? `<ul>${i.choices.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>` : ''
        }</li>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Kitchen #${escapeHtml(t.number)}</title>
<style>body{font:14px/1.35 system-ui,sans-serif;margin:8px;width:72mm}h1{font-size:22px;margin:0 0 4px}
.meta{font-size:12px;margin-bottom:8px}ul{padding-left:16px;margin:4px 0}li{margin:2px 0}
.note{border-top:1px dashed #000;margin-top:8px;padding-top:6px}</style></head><body>
<h1>#${escapeHtml(t.number)}</h1>
<div class="meta">${escapeHtml(t.orderType)}${t.tag ? ` · ${escapeHtml(t.tag)}` : ''} · ${escapeHtml(
    t.placedAt.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }),
  )}</div>
<ul>${items}</ul>${t.note ? `<div class="note">Note: ${escapeHtml(t.note)}</div>` : ''}
</body></html>`;
}

/** Shelf/stock tag for one inventory item (print-only; no API call). */
export function stockTagHtml(p: { code: string; name: string; category: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(p.code)}</title>
<style>body{font:14px system-ui,sans-serif;margin:8px;width:62mm}.code{font:700 20px monospace}.name{font-size:16px;font-weight:600}
.cat{font-size:11px;color:#444}</style></head><body><div class="code">#${escapeHtml(p.code)}</div>
<div class="name">${escapeHtml(p.name)}</div><div class="cat">${escapeHtml(p.category)}</div></body></html>`;
}

/** Prints through a hidden iframe so the current page (and any open cart) is untouched. */
export function printKitchenTicket(t: KitchenTicket): void {
  printHtml(kitchenTicketHtml(t));
}

export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const win = frame.contentWindow;
  window.setTimeout(() => {
    win.focus();
    win.print();
    window.setTimeout(() => frame.remove(), 1000);
  }, 50);
}
