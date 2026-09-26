import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentNetAmount, paymentReversedAmount } from '../lib/payments/net.ts';

test('payment net amount subtracts full and partial reversals', () => {
  assert.equal(paymentNetAmount({ amount: 100, payment_reversals: [] }), 100);
  assert.equal(paymentNetAmount({ amount: 100, payment_reversals: [{ amount: 25 }] }), 75);
  assert.equal(
    paymentNetAmount({ amount: '100.00', payment_reversals: [{ amount: '20.25' }, { amount: '29.75' }] }),
    50,
  );
  assert.equal(paymentNetAmount({ amount: 100, payment_reversals: [{ amount: 100 }] }), 0);
});

test('reversal totals are currency-rounded and cannot make net payment negative', () => {
  assert.equal(paymentReversedAmount({ amount: 100, payment_reversals: [{ amount: 10.005 }] }), 10.01);
  assert.equal(paymentNetAmount({ amount: 50, payment_reversals: [{ amount: 70 }] }), 0);
});
