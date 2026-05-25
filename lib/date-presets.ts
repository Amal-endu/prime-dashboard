const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

// Build date presets given maxDateRaw (ISO string, e.g. "2026-05-21").
// D-1 = maxDate (latest data day), D-2 = maxDate-1, etc.
// D-0 = today (no data available), shown without a date suffix.
export function buildDatePresets(maxDateRaw: string | null): { label: string; value: string }[] {
  if (!maxDateRaw) {
    // Fallback labels while loading
    return [
      { label: 'D-0', value: 'today' },
      { label: 'D-1', value: 'd1' },
      { label: 'D-2', value: 'd2' },
      { label: 'D-3', value: 'd3' },
      { label: 'D-4', value: 'd4' },
      { label: 'D-5', value: 'd5' },
      { label: 'D-6', value: 'd6' },
      { label: 'D-7', value: 'd7' },
      { label: 'L7D', value: 'l7d' },
      { label: 'L30D', value: 'l30d' },
    ]
  }

  const base = new Date(maxDateRaw)
  const offsets: { label: string; value: string; offset: number | null }[] = [
    { label: 'D-0', value: 'today', offset: null }, // today — no data
    { label: 'D-1', value: 'd1', offset: 0 },
    { label: 'D-2', value: 'd2', offset: 1 },
    { label: 'D-3', value: 'd3', offset: 2 },
    { label: 'D-4', value: 'd4', offset: 3 },
    { label: 'D-5', value: 'd5', offset: 4 },
    { label: 'D-6', value: 'd6', offset: 5 },
    { label: 'D-7', value: 'd7', offset: 6 },
  ]

  const daily = offsets.map(({ label, value, offset }) => {
    if (offset === null) return { label, value }
    const d = new Date(base)
    d.setDate(d.getDate() - offset)
    return { label: `${label} (${shortDate(d)})`, value }
  })

  return [
    ...daily,
    { label: 'L7D', value: 'l7d' },
    { label: 'L30D', value: 'l30d' },
  ]
}
