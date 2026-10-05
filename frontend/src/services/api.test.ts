import { describe, expect, it } from 'vitest';
import { ApiError, isUnknownOutcome } from './api';

describe('isUnknownOutcome', () => {
  it('treats no answer and gateway failures as unknown (retry with the same key)', () => {
    expect(isUnknownOutcome(new ApiError(0, 'NETWORK_TIMEOUT', 'x'))).toBe(true);
    expect(isUnknownOutcome(new ApiError(0, 'NETWORK_ERROR', 'x'))).toBe(true);
    expect(isUnknownOutcome(new ApiError(504, 'HTTP_504', 'x'))).toBe(true);
  });

  it('treats definite server answers as known (new attempt needs a new key)', () => {
    expect(isUnknownOutcome(new ApiError(409, 'INSUFFICIENT_STOCK', 'x'))).toBe(false);
    expect(isUnknownOutcome(new ApiError(409, 'CART_STALE', 'x'))).toBe(false);
    expect(isUnknownOutcome(new ApiError(422, 'VALIDATION_ERROR', 'x'))).toBe(false);
    expect(isUnknownOutcome(new Error('boom'))).toBe(false);
  });
});
