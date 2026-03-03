const OVERLAY_COLORS = ['#f97316', '#a855f7', '#14b8a6', '#ef4444', '#eab308']
let colorIndex = 0

/**
 * Parse CSV text into an overlay object.
 * Expects: first column = datetime (must use 4-digit year), second column = discharge.
 * Skips header row and unparseable rows.
 * Rejects dates with 2-digit years — the CSV must contain full 4-digit years.
 *
 * @param {string} text - raw CSV content
 * @param {string} label - display label for this overlay
 * @returns {{ label: string, times: string[], discharge: number[], color: string }}
 */
export function parseCSV(text, label) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return null

  // Reject dates that use 2-digit years: M/D/YY or MM/DD/YY (no 4-digit year)
  const twoDigitYearRe = /^\d{1,2}\/\d{1,2}\/\d{2}(\s|$)/

  const times = []
  const discharge = []

  // Skip header (first line)
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 2) continue

    const dt = cols[0].trim()
    const val = parseFloat(cols[1].trim())

    if (!dt || isNaN(val)) continue
    if (twoDigitYearRe.test(dt)) continue
    if (isNaN(new Date(dt).getTime())) continue

    times.push(dt)
    discharge.push(val)
  }

  if (times.length === 0) return null

  const color = OVERLAY_COLORS[colorIndex % OVERLAY_COLORS.length]
  colorIndex++

  return { label, times, discharge, color }
}
