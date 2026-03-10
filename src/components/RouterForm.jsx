import { useState, useEffect } from 'preact/hooks'
import { FileBrowser } from './FileBrowser.jsx'

const DISCHARGE_DIR_FIELD = { key: 'discharge_dir', label: 'Discharge Output Directory', type: 'directory', required: true, hint: 'Directory — file names auto-generated from input files' }

function getCoreFields(router) {
  const isChannelOnly = router === 'Muskingum'
  return [
    { key: 'params_file', label: 'Parameters File', type: 'file', required: true, hint: 'Parquet file with river_id, downstream_river_id, k, x columns' },
    {
      key: 'channel_state_init_file',
      label: 'Initial Channel State',
      type: 'file',
      required: isChannelOnly,
      hint: isChannelOnly
        ? 'Required parquet file with Q column'
        : 'Parquet file with Q column (optional warm start)',
    },
    { key: 'channel_state_final_file', label: 'Final Channel State Output', type: 'file', hint: 'Path to write final channel state parquet' },
  ]
}

function getDischargeFilesField(router) {
  return {
    key: 'discharge_files',
    label: 'Discharge Output Files',
    type: 'multifile',
    required: true,
    hint: router === 'Muskingum'
      ? 'Exactly one explicit output netCDF path'
      : 'Explicit output netCDF file paths, one per input file',
  }
}

const MUSKINGUM_FIELDS = [
  { key: 'dt_routing', label: 'Routing Timestep (seconds)', type: 'number', required: true },
  { key: 'dt_total', label: 'Total Simulation Duration (seconds)', type: 'number', required: true },
  { key: 'dt_discharge', label: 'Output Timestep (seconds)', type: 'number', hint: 'Defaults to dt_routing' },
  { key: 'start_datetime', label: 'Start Date', type: 'text', hint: 'ISO format, e.g. 2000-01-01' },
]

function getLateralModeFields(router) {
  const qlateralHint = router === 'UnitMuskingum'
    ? 'netCDF files with per-catchment runoff depths; variable qlateral'
    : 'netCDF files with per-catchment runoff volumes; variable qlateral'

  return {
    catchment: [
      { key: 'qlateral_files', label: 'Lateral Inflow Files', type: 'multifile', required: true, hint: qlateralHint },
    ],
    grid: [
      { key: 'grid_runoff_files', label: 'Runoff Grid Files', type: 'multifile', required: true, hint: 'netCDF gridded runoff depth files' },
      { key: 'grid_weights_file', label: 'Grid Weights File', type: 'file', required: true, hint: 'netCDF weights dataset with river_id, x_index, y_index, area_sqm, and proportion' },
    ],
  }
}

const TRANSFORM_TIME_FIELDS = [
  { key: 'dt_routing', label: 'Routing Timestep (seconds)', type: 'number', hint: 'Defaults to dt_runoff' },
  { key: 'dt_runoff', label: 'Runoff Timestep (seconds)', type: 'number', hint: 'Auto-detected from input files' },
  { key: 'dt_discharge', label: 'Output Timestep (seconds)', type: 'number', hint: 'Defaults to dt_runoff' },
  { key: 'dt_total', label: 'Total Duration (seconds)', type: 'number', hint: 'Auto-computed from input files' },
  { key: 'start_datetime', label: 'Start Date', type: 'text', hint: 'ISO format, e.g. 2000-01-01' },
]

const PROCESSING_FIELDS = [
  { key: 'runoff_processing_mode', label: 'Processing Mode', type: 'select', options: ['sequential', 'ensemble'] },
  { key: 'grid_accumulation_type', label: 'Accumulation Type', type: 'select', options: ['incremental', 'cumulative'] },
]

const UNIT_FIELDS = [
  { key: 'uh_kernel_file', label: 'Unit Hydrograph Kernel', type: 'file', required: true, hint: 'Scipy sparse npz kernel file' },
  { key: 'uh_state_init_file', label: 'Initial UH State', type: 'file', hint: 'Parquet state file (optional warm start)' },
  { key: 'uh_state_final_file', label: 'Final UH State Output', type: 'file', hint: 'Path to write final UH state' },
]

const RUNTIME_FIELDS = [
  { key: 'log', label: 'Enable Logging', type: 'boolean' },
  { key: 'progress_bar', label: 'Show Progress Bar', type: 'boolean' },
  { key: 'log_level', label: 'Log Level', type: 'select', options: ['DEBUG', 'INFO', 'PROGRESS', 'WARNING', 'ERROR', 'CRITICAL'], defaultValue: 'PROGRESS' },
  { key: 'log_stream', label: 'Log Stream', type: 'text', placeholder: 'stdout or /path/to/file.log' },
  { key: 'log_format', label: 'Log Format', type: 'text', placeholder: '%(levelname)s - %(asctime)s - %(message)s' },
]

const ADVANCED_FIELDS = [
  { key: 'var_river_id', label: 'River ID Variable', type: 'text', placeholder: 'river_id' },
  { key: 'var_discharge', label: 'Discharge Variable', type: 'text', placeholder: 'Q' },
  { key: 'var_x', label: 'X Variable', type: 'text', placeholder: 'x' },
  { key: 'var_y', label: 'Y Variable', type: 'text', placeholder: 'y' },
  { key: 'var_t', label: 'Time Variable', type: 'text', placeholder: 'time' },
  { key: 'var_grid_runoff', label: 'Grid Runoff Variable', type: 'text', placeholder: 'ro' },
]

/**
 * Valid config keys per router type — derived from docs/references/config-files.md.
 * Keys not listed for a router are stripped on router switch and omitted from code preview.
 */
export const VALID_KEYS = {
  Muskingum: new Set([
    '_router',
    // core + state + output
    'params_file', 'channel_state_init_file', 'channel_state_final_file',
    'discharge_dir', 'discharge_files',
    // time (Muskingum-specific: dt_routing & dt_total required, start_datetime optional)
    'dt_routing', 'dt_total', 'dt_discharge', 'start_datetime',
    // runtime
    'log', 'progress_bar', 'log_level', 'log_stream', 'log_format',
    // variable names
    'var_river_id', 'var_discharge', 'var_t',
  ]),
  RapidMuskingum: new Set([
    '_router',
    // core + state + output
    'params_file', 'channel_state_init_file', 'channel_state_final_file',
    'discharge_dir', 'discharge_files',
    // input data
    'qlateral_files', 'grid_runoff_files', 'grid_weights_file',
    // time
    'dt_routing', 'dt_runoff', 'dt_discharge', 'dt_total', 'start_datetime',
    // processing
    'runoff_processing_mode', 'grid_accumulation_type',
    // runtime
    'log', 'progress_bar', 'log_level', 'log_stream', 'log_format',
    // variable names (all)
    'var_river_id', 'var_discharge', 'var_x', 'var_y', 'var_t',
    'var_grid_runoff',
  ]),
  UnitMuskingum: new Set([
    '_router',
    // core + state + output
    'params_file', 'channel_state_init_file', 'channel_state_final_file',
    'discharge_dir', 'discharge_files',
    // input data
    'qlateral_files', 'grid_runoff_files', 'grid_weights_file',
    // unit hydrograph
    'uh_kernel_file', 'uh_state_init_file', 'uh_state_final_file',
    // time
    'dt_routing', 'dt_runoff', 'dt_discharge', 'dt_total', 'start_datetime',
    // processing
    'runoff_processing_mode', 'grid_accumulation_type',
    // runtime
    'log', 'progress_bar', 'log_level', 'log_stream', 'log_format',
    // variable names (all)
    'var_river_id', 'var_discharge', 'var_x', 'var_y', 'var_t',
    'var_grid_runoff',
  ]),
}

function PathField({ field, value, onChange }) {
  const [browserOpen, setBrowserOpen] = useState(false)
  return (
    <div class="form-group">
      <label class="form-label">
        {field.label}
        {field.required && <span style={{ color: 'var(--error)', marginLeft: '4px' }}>*</span>}
      </label>
      <div class="path-input-group">
        <input
          value={value || ''}
          onInput={(e) => onChange(field.key, e.target.value)}
          placeholder={field.hint || ''}
        />
        <button class="btn-secondary" onClick={() => setBrowserOpen(true)}>
          Browse
        </button>
      </div>
      <FileBrowser
        open={browserOpen}
        mode={field.type === 'directory' ? 'directory' : 'file'}
        onSelect={(path) => onChange(field.key, path)}
        onClose={() => setBrowserOpen(false)}
      />
    </div>
  )
}

function MultiFileField({ field, value, onChange }) {
  const [browserOpen, setBrowserOpen] = useState(false)
  const files = value || []

  const addFiles = (paths) => {
    // paths is an array from multi-select FileBrowser
    const existing = new Set(files)
    const newFiles = paths.filter(p => !existing.has(p))
    if (newFiles.length > 0) onChange(field.key, [...files, ...newFiles])
  }
  const removeFile = (idx) => {
    onChange(field.key, files.filter((_, i) => i !== idx))
  }

  return (
    <div class="form-group">
      <label class="form-label">
        {field.label}
        {field.required && <span style={{ color: 'var(--error)', marginLeft: '4px' }}>*</span>}
      </label>
      {files.map((f, i) => (
        <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
          <input value={f} readOnly style={{ flex: 1, fontSize: '12px', fontFamily: 'monospace' }} />
          <button class="btn-secondary" onClick={() => removeFile(i)} style={{ padding: '6px 14px', fontSize: '13px' }}>
            Remove
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
        <button class="btn-secondary" onClick={() => setBrowserOpen(true)}>
          + Add Files
        </button>
        {files.length > 0 && (
          <button class="btn-secondary" onClick={() => onChange(field.key, [])} style={{ padding: '6px 14px', fontSize: '13px' }}>
            Clear All
          </button>
        )}
      </div>
      <FileBrowser
        open={browserOpen}
        mode="file"
        multiSelect
        onSelect={addFiles}
        onClose={() => setBrowserOpen(false)}
      />
      {field.hint && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{field.hint}</div>}
    </div>
  )
}

function FormField({ field, value, onChange }) {
  if (field.type === 'file' || field.type === 'directory') {
    return <PathField field={field} value={value} onChange={onChange} />
  }
  if (field.type === 'multifile') {
    return <MultiFileField field={field} value={value} onChange={onChange} />
  }
  if (field.type === 'boolean') {
    const selected = value === undefined || value === null || value === '' ? true : Boolean(value)
    return (
      <div class="form-group">
        <label class="form-label">{field.label}</label>
        <select value={String(selected)} onChange={(e) => onChange(field.key, e.target.value === 'true')}>
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      </div>
    )
  }

  return (
    <div class="form-group">
      <label class="form-label">
        {field.label}
        {field.required && <span style={{ color: 'var(--error)', marginLeft: '4px' }}>*</span>}
      </label>
      {field.type === 'select' ? (
        <select
          value={value ?? field.defaultValue ?? field.options[0]}
          onChange={(e) => {
            let next = e.target.value
            const first = field.options[0]
            if (typeof first === 'number') next = Number(next)
            if (typeof first === 'boolean') next = next === 'true'
            onChange(field.key, next)
          }}
        >
          {field.options.map(opt => (
            <option key={String(opt)} value={String(opt)}>{String(opt)}</option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'number' ? 'number' : 'text'}
          value={value || ''}
          onInput={(e) => {
            const v = field.type === 'number' ? (e.target.value ? Number(e.target.value) : '') : e.target.value
            onChange(field.key, v)
          }}
          placeholder={field.placeholder || field.hint || ''}
        />
      )}
    </div>
  )
}

function FieldGroup({ title, fields, config, onChange }) {
  return (
    <div class="section">
      <div class="section-title">{title}</div>
      {fields.map(field => (
        <FormField
          key={field.key}
          field={field}
          value={config[field.key]}
          onChange={onChange}
        />
      ))}
    </div>
  )
}

function inferDischargeMode(config) {
  if (config.discharge_files && config.discharge_files.length > 0) return 'files'
  return 'directory'
}

function inferLateralMode(config) {
  const hasCatchment = config.qlateral_files && config.qlateral_files.length > 0
  const hasGrid = (config.grid_runoff_files && config.grid_runoff_files.length > 0) || config.grid_weights_file
  if (hasCatchment) return 'catchment'
  if (hasGrid) return 'grid'
  return 'catchment'
}

// Keys excluded from code preview / run based on active mode
const LATERAL_CATCHMENT_EXCLUDE = new Set(['grid_runoff_files', 'grid_weights_file'])
const LATERAL_GRID_EXCLUDE = new Set(['qlateral_files'])
const DISCHARGE_DIR_EXCLUDE = new Set(['discharge_files'])
const DISCHARGE_FILES_EXCLUDE = new Set(['discharge_dir'])

/** Returns a set of config keys to exclude based on the current mode selections. */
export function getExcludedKeys(config) {
  const excluded = new Set()
  const dm = config._dischargeMode || 'directory'
  if (dm === 'directory') DISCHARGE_DIR_EXCLUDE.forEach(k => excluded.add(k))
  else DISCHARGE_FILES_EXCLUDE.forEach(k => excluded.add(k))

  const lm = config._lateralMode || 'catchment'
  if (lm === 'catchment') LATERAL_CATCHMENT_EXCLUDE.forEach(k => excluded.add(k))
  else LATERAL_GRID_EXCLUDE.forEach(k => excluded.add(k))

  return excluded
}

export function RouterForm({ router, config, onChange }) {
  const lateralMode = config._lateralMode || inferLateralMode(config)
  const dischargeMode = config._dischargeMode || inferDischargeMode(config)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const validKeys = VALID_KEYS[router] || VALID_KEYS.Muskingum
  const filteredAdvanced = ADVANCED_FIELDS.filter(f => validKeys.has(f.key))
  const coreFields = getCoreFields(router)
  const dischargeFilesField = getDischargeFilesField(router)
  const lateralModeFields = getLateralModeFields(router)

  // Sync mode into config on first render if not set
  useEffect(() => {
    if (!config._lateralMode) onChange('_lateralMode', inferLateralMode(config))
    if (!config._dischargeMode) onChange('_dischargeMode', inferDischargeMode(config))
  }, [])

  // Update modes when config changes externally (e.g. JSON loaded)
  useEffect(() => {
    if (!config._lateralMode) onChange('_lateralMode', inferLateralMode(config))
  }, [config.qlateral_files, config.grid_runoff_files, config.grid_weights_file])

  useEffect(() => {
    if (!config._dischargeMode) onChange('_dischargeMode', inferDischargeMode(config))
  }, [config.discharge_files, config.discharge_dir])

  const setLateralMode = (mode) => onChange('_lateralMode', mode)
  const setDischargeMode = (mode) => onChange('_dischargeMode', mode)

  const isTransform = router === 'RapidMuskingum' || router === 'UnitMuskingum'

  return (
    <div>
      <FieldGroup title="Core Files" fields={coreFields} config={config} onChange={onChange} />

      <div class="section">
        <div class="section-title">Discharge Output</div>
        <div class="form-group">
          <label class="form-label">Output Mode</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              class={dischargeMode === 'directory' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setDischargeMode('directory')}
            >
              Directory
            </button>
            <button
              class={dischargeMode === 'files' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setDischargeMode('files')}
            >
              Explicit Files
            </button>
          </div>
        </div>
        {dischargeMode === 'directory' ? (
          <FormField field={DISCHARGE_DIR_FIELD} value={config.discharge_dir} onChange={onChange} />
        ) : (
          <FormField field={dischargeFilesField} value={config.discharge_files} onChange={onChange} />
        )}
      </div>

      {router === 'Muskingum' && (
        <FieldGroup title="Time Parameters" fields={MUSKINGUM_FIELDS} config={config} onChange={onChange} />
      )}

      {isTransform && (
        <>
          <div class="section">
            <div class="section-title">Lateral Inflow</div>
            <div class="form-group">
              <label class="form-label">Input Mode</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  class={lateralMode === 'catchment' ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => setLateralMode('catchment')}
                >
                  Catchment Files
                </button>
                <button
                  class={lateralMode === 'grid' ? 'btn-primary' : 'btn-secondary'}
                  onClick={() => setLateralMode('grid')}
                >
                  Grid + Weights
                </button>
              </div>
            </div>
            {lateralModeFields[lateralMode].map(field => (
              <FormField key={field.key} field={field} value={config[field.key]} onChange={onChange} />
            ))}
          </div>

          {router === 'UnitMuskingum' && (
            <FieldGroup title="Unit Hydrograph" fields={UNIT_FIELDS} config={config} onChange={onChange} />
          )}

          <FieldGroup title="Time Parameters" fields={TRANSFORM_TIME_FIELDS} config={config} onChange={onChange} />
          <FieldGroup title="Processing Options" fields={PROCESSING_FIELDS} config={config} onChange={onChange} />
        </>
      )}

      <FieldGroup title="Runtime & Logging" fields={RUNTIME_FIELDS} config={config} onChange={onChange} />

      <div>
        <div
          class="collapsible-header"
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          <span class={`collapsible-arrow ${advancedOpen ? 'open' : ''}`}>&#9654;</span>
          Advanced Options
        </div>
        {advancedOpen && (
          <div style={{ padding: '0 0 16px 0' }}>
            {filteredAdvanced.map(field => (
              <FormField key={field.key} field={field} value={config[field.key]} onChange={onChange} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
