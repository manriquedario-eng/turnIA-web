export type PaymentWithReversals = {
  amount: unknown;
  payment_reversals?: Array<{ amount?: unknown }> | null;
};

function money(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function paymentReversedAmount(payment: PaymentWithReversals): number {
  return Math.round(
    (payment.payment_reversals ?? []).reduce(
      (sum, reversal) => sum + money(reversal.amount),
      0,
    ) * 100,
  ) / 100;
}

export function paymentNetAmount(payment: PaymentWithReversals): number {
  const gross = money(payment.amount);
  const reversed = paymentReversedAmount(payment);
  return Math.max(Math.round((gross - reversed) * 100) / 100, 0);
}
