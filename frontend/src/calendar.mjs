export const YEARS = Array.from({ length: 8 }, (_, index) => 2020 + index);
export const CATEGORIES = {
  regular: { label: 'Regular Holidays', badge: 'Regular holiday' },
  special: { label: 'Special Non-Working Days', badge: 'Special non-working' },
  islamic: { label: 'Islamic Holidays', badge: 'Islamic holiday' },
};

export function calendarCells(year, month) {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Array.from({ length: firstDay }, () => null);
  for (let day = 1; day <= days; day++) cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
