// Illustrative UI fixtures only. They are not official yearly holiday datasets.
// No holiday API is connected at the user's request.
export const YEARS = Array.from({ length: 8 }, (_, index) => 2020 + index);
export const CATEGORIES = {
  regular: { label: 'Regular Holidays', badge: 'Regular holiday' },
  special: { label: 'Special Non-Working Days', badge: 'Special non-working' },
  islamic: { label: 'Islamic Holidays', badge: 'Islamic holiday' },
};
export function previewHolidays(year) {
  return [
    { id: 'new-year', date: `${year}-01-01`, name: "New Year's Day", categories: ['regular'] },
    { id: 'valor', date: `${year}-04-09`, name: 'Day of Valor', categories: ['regular'] },
    { id: 'labor', date: `${year}-05-01`, name: 'Labor Day', categories: ['regular'] },
    { id: 'independence', date: `${year}-06-12`, name: 'Independence Day', categories: ['regular'] },
    { id: 'ninoy', date: `${year}-08-21`, name: 'Ninoy Aquino Day', categories: ['special'] },
    { id: 'all-saints', date: `${year}-11-01`, name: "All Saints' Day", categories: ['special'] },
    { id: 'bonifacio', date: `${year}-11-30`, name: 'Bonifacio Day', categories: ['regular'] },
    { id: 'christmas', date: `${year}-12-25`, name: 'Christmas Day', categories: ['regular'] },
    { id: 'rizal', date: `${year}-12-30`, name: 'Rizal Day', categories: ['regular'] },
    { id: 'eid-fitr', date: null, name: 'Eid al-Fitr', categories: ['regular', 'islamic'] },
    { id: 'eid-adha', date: null, name: 'Eid al-Adha', categories: ['regular', 'islamic'] },
  ];
}

export function calendarCells(year, month) {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Array.from({ length: firstDay }, () => null);
  for (let day = 1; day <= days; day++) cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
