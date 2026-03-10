const VALID_ROUTERS = new Set(['Muskingum', 'RapidMuskingum', 'UnitMuskingum'])
const LEGACY_KEY_MAP = {
  routing_params_file: 'params_file',
  initial_state_file: 'channel_state_init_file',
  final_state_file: 'channel_state_final_file',
  input_type: 'runoff_processing_mode',
  catchment_volumes_files: 'qlateral_files',
  runoff_type: 'grid_accumulation_type',
  runoff_depths_files: 'grid_runoff_files',
  weight_table_file: 'grid_weights_file',
}
const REMOVED_KEYS = new Set(['connectivity_file', 'var_catchment_volume'])
const LIST_KEYS = new Set(['discharge_files', 'qlateral_files', 'grid_runoff_files'])

function isBlank(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

function migrateConfigKeys(raw) {
  const next = { ...raw }

  for (const [legacyKey, currentKey] of Object.entries(LEGACY_KEY_MAP)) {
    if (!isBlank(next[legacyKey]) && isBlank(next[currentKey])) {
      next[currentKey] = next[legacyKey]
    }
    delete next[legacyKey]
  }

  for (const key of REMOVED_KEYS) {
    delete next[key]
  }

  for (const key of LIST_KEYS) {
    if (typeof next[key] === 'string' && next[key].trim()) {
      next[key] = [next[key]]
    }
  }

  return next
}

function inferRouterFromFields(config) {
  if (!config || typeof config !== 'object') return null
  if (config.uh_kernel_file) return 'UnitMuskingum'
  if (
    (Array.isArray(config.qlateral_files) && config.qlateral_files.length > 0) ||
    (Array.isArray(config.grid_runoff_files) && config.grid_runoff_files.length > 0) ||
    config.grid_weights_file
  ) {
    return 'RapidMuskingum'
  }
  return null
}

export function inferRouter(config, fallback = 'Muskingum') {
  const candidate = String(config?._router || fallback || '').trim()
  return VALID_ROUTERS.has(candidate) ? candidate : 'Muskingum'
}

export function normalizeLoadedConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { _router: 'Muskingum' }
  }
  const next = migrateConfigKeys(raw)
  const inferredRouter = next._router || inferRouterFromFields(next) || 'Muskingum'
  return { ...next, _router: inferRouter(next, inferredRouter) }
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
