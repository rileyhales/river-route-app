function splitCsvLine(line) {
  const cells = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current)
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current)
  return cells
}

function parseRiverIdFromHeader(header) {
  const match = String(header || '').match(/-?\d+/)
  if (!match) return null
  const num = Number(match[0])
  if (!Number.isFinite(num)) return null
  return String(Math.trunc(num))
}

function normalizeText(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function parseValidationCsv(text, selectedRiverIds = []) {
  const source = normalizeText(text)
  if (!source.trim()) return { ok: false, error: 'CSV is empty' }

  const lines = source.split('\n').filter(line => line.trim() !== '')
  if (lines.length < 2) return { ok: false, error: 'CSV needs a header and at least one data row' }

  const headers = splitCsvLine(lines[0]).map(h => h.trim())
  if (headers.length < 2) {
    return { ok: false, error: 'CSV must include a time column and at least one discharge column' }
  }

  const times = []
  const columnCount = headers.length - 1
  const seriesByIndex = Array.from({ length: columnCount }, () => [])
  let skippedRows = 0

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) continue
    const cells = splitCsvLine(raw)
    const t = String(cells[0] ?? '').trim()
    if (!t) {
      skippedRows += 1
      continue
    }

    times.push(t)
    for (let c = 0; c < columnCount; c++) {
      const cell = String(cells[c + 1] ?? '').trim()
      if (cell === '') {
        seriesByIndex[c].push(null)
        continue
      }
      const v = Number(cell)
      seriesByIndex[c].push(Number.isFinite(v) ? v : null)
    }
  }

  if (times.length === 0) {
    return { ok: false, error: `No usable data rows found (${skippedRows} rows skipped)` }
  }

  const seriesByRiverId = {}
  const seriesMeta = []
  if (headers.length === 2) {
    if (selectedRiverIds.length !== 1) {
      return {
        ok: false,
        error: 'Two-column CSV requires exactly one selected River ID in the River IDs field.',
      }
    }
    const rid = String(selectedRiverIds[0])
    seriesByRiverId[rid] = seriesByIndex[0]
    seriesMeta.push({ riverId: rid, label: headers[1] || `CSV ${rid}` })
  } else {
    for (let c = 0; c < columnCount; c++) {
      const header = headers[c + 1]
      const rid = parseRiverIdFromHeader(header)
      if (!rid) continue
      if (seriesByRiverId[rid]) continue
      seriesByRiverId[rid] = seriesByIndex[c]
      seriesMeta.push({ riverId: rid, label: header || `CSV ${rid}` })
    }
    if (Object.keys(seriesByRiverId).length === 0) {
      return {
        ok: false,
        error: 'Could not parse river IDs from CSV headers. Use names that include the river ID.',
      }
    }
  }

  return {
    ok: true,
    parsed: {
      times,
      seriesByRiverId,
      seriesMeta,
      columnHeaders: headers,
      rowCount: times.length,
      skippedRows,
    },
  }
}
