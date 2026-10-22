/** How the platform is paid, as the console labels it — billing/domain/payment-record.ts PAYMENT_METHODS. */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  neft: 'NEFT / bank transfer',
  rtgs: 'RTGS',
  upi: 'UPI',
  cheque: 'Cheque',
  cash: 'Cash',
  card: 'Card',
  netbanking: 'Net banking',
  razorpay: 'Razorpay (online)',
  credit: 'Credit / adjustment',
  manual: 'Manual entry',
};
export const OPEN_STATUSES = ['unpaid', 'partially_paid'];
