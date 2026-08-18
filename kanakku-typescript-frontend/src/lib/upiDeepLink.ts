export function upiDeepLink(input: { vpa: string; payeeName: string; amount: number; note?: string }): string {
  const params = new URLSearchParams({
    pa: input.vpa,
    pn: input.payeeName,
    am: input.amount.toFixed(2),
    cu: 'INR',
    ...(input.note ? { tn: input.note } : {}),
  });
  return `upi://pay?${params.toString()}`;
}
