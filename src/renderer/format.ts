// Formatting is centralized so every screen shows amounts and dates the
// same way - a shopkeeper should never see "8000" on one screen and
// "8,000.00" on another for the same figure.

const money = new Intl.NumberFormat('en-PK', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatRs(amount: number): string {
  return `Rs. ${money.format(amount)}`;
}

// Due amounts are shown with an explicit sign word rather than a bare
// negative number - "credit" is much clearer to a non-technical user than
// "-3600".
export function formatDue(amount: number): { text: string; kind: 'due' | 'credit' | 'clear' } {
  if (Math.abs(amount) < 0.01) return { text: formatRs(0), kind: 'clear' };
  if (amount > 0) return { text: formatRs(amount), kind: 'due' };
  return { text: `${formatRs(Math.abs(amount))} credit`, kind: 'credit' };
}

export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Backend timestamps are 'YYYY-MM-DD HH:MM:SS' (SQLite datetime('now')) or
// 'YYYY-MM-DD' for pure dates. Handle both without pulling in a date library.
export function formatDate(raw: string): string {
  const datePart = raw.slice(0, 10);
  const [y, m, d] = datePart.split('-');
  if (!y || !m || !d) return raw;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const monthIndex = Number(m) - 1;
  const monthLabel = months[monthIndex] ?? m;
  return `${Number(d)} ${monthLabel} ${y}`;
}

export function formatDateTime(raw: string): string {
  const [datePart, timePart] = raw.split(' ');
  if (!timePart) return formatDate(raw);
  const [hh, mm] = timePart.split(':');
  const hour = Number(hh);
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${formatDate(datePart)}, ${hour12}:${mm} ${period}`;
}
