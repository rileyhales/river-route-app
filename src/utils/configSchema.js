const VALID_ROUTERS = new Set(['Muskingum', 'RapidMuskingum', 'UnitMuskingum'])

export function inferRouter(config, fallback = 'Muskingum') {
  const candidate = String(config?._router || fallback || '').trim()
  return VALID_ROUTERS.has(candidate) ? candidate : 'Muskingum'
}

export function normalizeLoadedConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { _router: 'Muskingum' }
  }
  const next = { ...raw }
  return { ...next, _router: inferRouter(next, next._router || 'Muskingum') }
}

export function stripEmptyValues(config) {
  const cleaned = {}
  for (const [key, val] of Object.entries(config || {})) {
    if (key.startsWith('_')) continue
    if (val === null || val === undefined || val === '') continue
    if (Array.isArray(val)) {
      const compact = val.filter(v => v !== null && v !== undefined && v !== '')
      if (!compact.length) continue
      cleaned[key] = compact
      continue
    }
    cleaned[key] = val
  }
  return cleaned
}
