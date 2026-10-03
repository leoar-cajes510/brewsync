import { CheckCircle2, ChefHat, ClipboardList, Eye, NotebookPen, Printer, Wallet } from 'lucide-react';
import Badge, { type BadgeTone } from '../ui/Badge';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import PaymentPanel from './PaymentPanel';
import { useTerms } from '../../stores/terminologySettingsStore';
import type { Order, OrderPayment, OrderStatus } from '../../types/order';
import { formatPeso } from '../../utils/currency';
import { formatTime, minutesSince, orderTotals, orderTypeLabel } from '../../utils/orderDisplay';

const statusBadge: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  preparing: { label: 'Preparing', tone: 'brand' },
  ready: { label: 'Ready', tone: 'success' },
};

interface OrderDetailsPanelProps {
  order: Order | null;
  now: Date;
  onAdvance: (order: Order) => void;
  onPay: (order: Order, payment: OrderPayment) => void;
  collecting: boolean;
  onCollectingChange: (collecting: boolean) => void;
  onCancel: (order: Order) => void;
  onConfirmPayment: (order: Order, paymentId: string) => void;
  onVoidPayment: (order: Order, paymentId: string) => void;
}

function PrimaryAction({ order, onAdvance, onCollect }: { order: Order; onAdvance: () => void; onCollect: () => void }) {
  if (order.status === 'pending') {
    return (
      <Button variant="primary" size="lg" block icon={<ChefHat size={20} />} onClick={onAdvance}>
        Start Preparing
      </Button>
    );
  }
  if (order.status === 'preparing') {
    return (
      <Button variant="primary" size="lg" block icon={<CheckCircle2 size={20} />} onClick={onAdvance}>
        Mark Ready
      </Button>
    );
  }
  if (order.payment.status === 'unpaid') {
    return (
      <Button variant="primary" size="lg" block icon={<Wallet size={20} />} onClick={onCollect}>
        Collect Payment
      </Button>
    );
  }
  return (
    <Button variant="success" size="lg" block icon={<CheckCircle2 size={20} />} onClick={onAdvance}>
      Complete Order
    </Button>
  );
}

function Details({ order, now, onAdvance, onPay, collecting, onCollectingChange: setCollecting, onCancel, onConfirmPayment, onVoidPayment }: OrderDetailsPanelProps & { order: Order }) {
  const totals = orderTotals(order);
  const badge = statusBadge[order.status];
  const { term } = useTerms();

  return (
    <>
      <div className="details-panel__header">
        <h2 className="details-panel__title">
          {term('order')} #{order.number}
        </h2>
        <Badge tone={badge.tone}>{badge.label}</Badge>
        <button type="button" className="icon-btn details-panel__menu" aria-label="Order actions" title="Cancel order" onClick={() => onCancel(order)}>
          <ClipboardList size={16} />
        </button>
      </div>

      <div className="details-panel__body">
        <dl className="details-info">
          <div>
            <dt>Customer</dt>
            <dd>{order.customer}</dd>
          </div>
          <div>
            <dt>Dining Option</dt>
            <dd>{orderTypeLabel(order).replace(' · T', ' · Table T')}</dd>
          </div>
          <div>
            <dt>Cashier</dt>
            <dd>{order.cashier}</dd>
          </div>
          <div>
            <dt>Time Placed</dt>
            <dd>
              {formatTime(order.placedAt)} ({minutesSince(order.placedAt, now)}m ago)
            </dd>
          </div>
        </dl>

        <div className="details-section-head">
          <span>
            Order Items ({totals.itemCount} {totals.itemCount === 1 ? 'item' : 'items'} · {totals.quantity} qty)
          </span>
          {order.status !== 'pending' && <span className="details-section-head__ok">Verified In-Kitchen</span>}
        </div>

        <div className="details-items">
          {order.items.map((item) => (
            <div key={item.id} className="details-item">
              <span className="details-item__qty">{item.quantity}</span>
              <div className="details-item__main">
                <div className="details-item__row">
                  <strong>{item.name}</strong>
                  <strong>{formatPeso(item.unitPrice * item.quantity)}</strong>
                </div>
                <span className="details-item__unit">
                  {item.quantity} × {formatPeso(item.unitPrice)}
                </span>
                {item.choices.length > 0 && (
                  <div className="details-item__choices">
                    {item.choices.map((c) => (
                      <span key={c} className="details-chip">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {order.note && (
          <div className="details-note">
            <NotebookPen size={16} />
            <div>
              <span>Order Note</span>
              <p>“{order.note}”</p>
            </div>
          </div>
        )}

        <div className="details-totals">
          <div className="details-totals__row">
            <span>
              Items Subtotal ({totals.itemCount} items, {totals.quantity} qty)
            </span>
            <span>{formatPeso(totals.subtotal)}</span>
          </div>
          <div className="details-totals__row">
            <span>Tax</span>
            <span>{formatPeso(totals.vat)}</span>
          </div>
          <div className="details-totals__row">
            <span>Discounts</span>
            <span>{totals.discount > 0 ? `−${formatPeso(totals.discount)}` : formatPeso(0)}</span>
          </div>
          <div className="details-totals__total">
            <span>Total</span>
            <span>{formatPeso(totals.total)}</span>
          </div>
          {order.pendingPayments && order.pendingPayments.length > 0 && (
            <div className="details-pending" role="group" aria-label="Payments awaiting confirmation">
              <span className="details-pending__title">Awaiting confirmation</span>
              {order.pendingPayments.map((p) => (
                <div key={p.id} className="details-pending__row">
                  <span>
                    {p.method.replace('_', ' ')} · {formatPeso(p.amount)}
                    {p.reference ? ` · Ref ${p.reference}` : ''}
                  </span>
                  <span className="details-pending__actions">
                    <Button size="sm" variant="primary" onClick={() => onConfirmPayment(order, p.id)}>
                      Confirm
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => onVoidPayment(order, p.id)}>
                      Void
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}
          <PaymentPanel
            payment={order.payment}
            total={totals.total}
            paid={order.totals?.paid}
            due={order.totals?.amountDue}
            collecting={collecting}
            onStartCollect={() => setCollecting(true)}
            onCancel={() => setCollecting(false)}
            onPay={(payment) => {
              setCollecting(false);
              onPay(order, payment);
            }}
          />
        </div>
      </div>

      <div className="details-panel__footer">
        <PrimaryAction order={order} onAdvance={() => onAdvance(order)} onCollect={() => setCollecting(true)} />
        <div className="details-panel__secondary">
          <Button icon={<Printer size={15} />} disabled title="Available in a later phase">
            Kitchen Ticket
          </Button>
          <Button icon={<Eye size={15} />} disabled title="Available in a later phase">
            View Receipt
          </Button>
        </div>
      </div>
    </>
  );
}

export default function OrderDetailsPanel(props: OrderDetailsPanelProps) {
  return (
    <aside className="details-panel" aria-label="Order details">
      {props.order ? (
        // Keyed so the payment form resets when switching orders.
        <Details key={props.order.id} {...props} order={props.order} />
      ) : (
        <div className="details-panel__empty">
          <EmptyState
            icon={<ClipboardList size={22} />}
            title="No order selected"
            description="Select an order from the board to view its items, totals and payment."
          />
        </div>
      )}
    </aside>
  );
}
