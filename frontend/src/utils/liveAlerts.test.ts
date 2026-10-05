import { describe, expect, it } from 'vitest';
import { FEATURE_DEFAULTS } from '../stores/featureSettingsStore';
import { PREFERENCE_DEFAULTS } from '../stores/preferenceSettingsStore';
import { alertGates, newOrdersSince, stockChanges, waitingOrders } from './liveAlerts';
import { csvCell, toCsv } from './csv';
import { kitchenTicketHtml, stockTagHtml } from './kitchenTicket';
import { _resetNotifications, dismiss, getNotifications, isOwnOrder, markOwnOrder, notify } from '../stores/notificationStore';

const order = (id: string, minutesAgo: number, status = 'pending') => ({
  id, number: id, status, created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
});

describe('alertGates', () => {
  it('requires the feature, the preference and the notifications master switch', () => {
    const on = alertGates({ ...FEATURE_DEFAULTS, orderAlerts: true, lowStockAlerts: true, soundEffects: true, liveUpdates: true }, PREFERENCE_DEFAULTS);
    expect(on.newOrders && on.waitingOrders && on.lowStock && on.payments && on.live && on.alertSound).toBe(true);
    expect(alertGates({ ...FEATURE_DEFAULTS, orderAlerts: false }, PREFERENCE_DEFAULTS).newOrders).toBe(false);
    expect(alertGates({ ...FEATURE_DEFAULTS, orderAlerts: true }, { ...PREFERENCE_DEFAULTS, notifications: false }).newOrders).toBe(false);
    expect(alertGates({ ...FEATURE_DEFAULTS, orderAlerts: true }, { ...PREFERENCE_DEFAULTS, newOrderAlerts: false }).newOrders).toBe(false);
    expect(alertGates({ ...FEATURE_DEFAULTS, soundEffects: false }, PREFERENCE_DEFAULTS).paymentSound).toBe(false);
    expect(alertGates({ ...FEATURE_DEFAULTS, liveUpdates: true }, { ...PREFERENCE_DEFAULTS, liveUpdates: false }).live).toBe(false);
  });
});

describe('order alerts', () => {
  it('first poll is only a baseline; own orders are never announced', () => {
    expect(newOrdersSince(null, [order('a', 0)], () => false)).toEqual([]);
    const fresh = newOrdersSince(new Set(['a']), [order('a', 0), order('b', 0), order('c', 0)], (id) => id === 'c');
    expect(fresh.map((o) => o.id)).toEqual(['b']);
  });

  it('waiting alerts fire once, only for pending/preparing orders past the threshold', () => {
    const orders = [order('old', 15), order('new', 2), order('ready', 30, 'ready'), order('prep', 12, 'preparing')];
    expect(waitingOrders(orders, new Date(), 10, new Set()).map((o) => o.id)).toEqual(['old', 'prep']);
    expect(waitingOrders(orders, new Date(), 10, new Set(['old', 'prep']))).toEqual([]);
    expect(waitingOrders(orders, new Date(), 0, new Set())).toEqual([]);
  });
});

describe('stock alerts', () => {
  it('announce only transitions into low / unavailable', () => {
    const base = { low: { p1: [] as string[], p2: ['Milk'] }, unavailable: { p1: false, p2: false } };
    expect(stockChanges(null, base)).toEqual({ low: [], unavailable: [] });
    const next = { low: { p1: ['Beans'], p2: ['Milk'] }, unavailable: { p1: false, p2: true } };
    expect(stockChanges(base, next)).toEqual({ low: ['p1'], unavailable: ['p2'] });
    expect(stockChanges(next, next)).toEqual({ low: [], unavailable: [] });
  });
});

describe('csv', () => {
  it('neutralises spreadsheet formulas and quotes separators', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@SUM')).toBe("'@SUM");
    expect(csvCell(-5)).toBe('-5'); // numbers are data, not formulas
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['A', 'B'], [[1, 'x']])).toBe('A,B\r\n1,x');
  });
});

describe('print-only documents', () => {
  it('escape user-entered names', () => {
    const html = kitchenTicketHtml({ number: '7', orderType: 'Dine-In', placedAt: new Date(), note: '<b>hot</b>',
                                      items: [{ name: '<img src=x onerror=alert(1)>', quantity: 2, choices: ['Oat "Milk"'] }] });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('Oat &quot;Milk&quot;');
    expect(stockTagHtml({ code: 'COF-1', name: '<script>', category: 'x' })).not.toContain('<script>');
  });
});

describe('notifications store', () => {
  it('caps the stack, dismisses and tracks own orders', () => {
    _resetNotifications();
    for (let i = 0; i < 6; i += 1) notify({ title: `n${i}`, tone: 'info' });
    expect(getNotifications().map((n) => n.title)).toEqual(['n2', 'n3', 'n4', 'n5']);
    dismiss(getNotifications()[0].id);
    expect(getNotifications().map((n) => n.title)).toEqual(['n3', 'n4', 'n5']);
    dismiss(999); // unknown id is harmless
    expect(getNotifications()).toHaveLength(3);
    markOwnOrder('o1');
    expect(isOwnOrder('o1')).toBe(true);
    expect(isOwnOrder('o2')).toBe(false);
    _resetNotifications();
    expect(getNotifications()).toEqual([]);
  });
});
