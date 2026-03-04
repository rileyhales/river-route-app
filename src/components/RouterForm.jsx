import { useState, useEffect } from 'preact/hooks'
import { FileBrowser } from './FileBrowser.jsx'

// Field definitions per router type
const COMMON_FIELDS = [
  { key: 'params_file', label: 'Parameters File', type: 'file', required: true, hint: 'Parquet file with river_id, downstream_river_id, k, x columns' },
  { key: 'discharge_dir', label: 'Discharge Output Directory', type: 'directory', required: true, hint: 'Directory where output netCDF files will be written' },
  { key: 'channel_state_init_file', label: 'Initial Channel State', type: 'file', hint: 'Parquet file with Q column (optional warm start)' },
  { key: 'channel_state_final_file', label: 'Final Channel State Output', type: 'file', hint: 'Path to write final channel state parquet' },
]

const MUSKINGUM_FIELDS = [
  { key: 'dt_routing', label: 'Routing Timestep (seconds)', type: 'number', required: true },
  { key: 'dt_total', label: 'Total Simulation Duration (seconds)', type: 'number', required: true },
  { key: 'dt_discharge', label: 'Output Timestep (seconds)', type: 'number', hint: 'Defaults to dt_routing' },
  { key: 'start_datetime', label: 'Start Date', type: 'text', hint: 'ISO format, e.g. 2000-01-01' },
]

const LATERAL_MODE_FIELDS = {
  catchment: [
    { key: 'catchment_runoff_files', label: 'Catchment Runoff Files', type: 'multifile', required: true, hint: 'netCDF files with per-catchment runoff' },
  ],
  grid: [
    { key: 'runoff_grid_files', label: 'Runoff Grid Files', type: 'multifile', required: true, hint: 'netCDF gridded runoff depth files' },
    { key: 'grid_weights_file', label: 'Grid Weights File', type: 'file', required: true, hint: 'netCDF weight table mapping grid to catchments' },
  ],
}

const TRANSFORM_TIME_FIELDS = [
  { key: 'dt_routing', label: 'Routing Timestep (seconds)', type: 'number', hint: 'Defaults to dt_runoff' },
  { key: 'dt_runoff', label: 'Runoff Timestep (seconds)', type: 'number', hint: 'Auto-detected from input files' },
  { key: 'dt_discharge', label: 'Output Timestep (seconds)', type: 'number', hint: 'Defaults to dt_runoff' },
  { key: 'dt_total', label: 'Total Duration (seconds)', type: 'number', hint: 'Auto-computed from input files' },
]

const PROCESSING_FIELDS = [
  { key: 'runoff_processing_mode', label: 'Processing Mode', type: 'select', options: ['sequential', 'ensemble'] },
  { key: 'runoff_accumulation_type', label: 'Accumulation Type', type: 'select', options: ['incremental', 'cumulative'] },
]

const UNIT_FIELDS = [
  { key: 'transformer_kernel_file', label: 'Unit Hydrograph Kernel', type: 'file', required: true, hint: 'Parquet kernel file (n_basins x n_timesteps)' },
  { key: 'transformer_state_init_file', label: 'Initial Transformer State', type: 'file', hint: 'Parquet state file (optional warm start)' },
  { key: 'transformer_state_final_file', label: 'Final Transformer State Output', type: 'file', hint: 'Path to write final transformer state' },
]

const ADVANCED_FIELDS = [
  { key: 'var_river_id', label: 'River ID Variable', type: 'text', placeholder: 'river_id' },
  { key: 'var_discharge', label: 'Discharge Variable', type: 'text', placeholder: 'Q' },
  { key: 'var_x', label: 'X Variable', type: 'text', placeholder: 'x' },
  { key: 'var_y', label: 'Y Variable', type: 'text', placeholder: 'y' },
  { key: 'var_t', label: 'Time Variable', type: 'text', placeholder: 'time' },
  { key: 'var_catchment_runoff_variable', label: 'Catchment Runoff Variable', type: 'text', placeholder: 'runoff' },
  { key: 'var_runoff_depth', label: 'Runoff Depth Variable', type: 'text', placeholder: 'ro' },
  { key: 'log_level', label: 'Log Level', type: 'select', options: ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'] },
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
    // variable names (only universal ones — no lateral inflow vars)
    'var_river_id', 'var_discharge', 'log_level',
  ]),
  RapidMuskingum: new Set([
    '_router',
    // core + state + output
    'params_file', 'channel_state_init_file', 'channel_state_final_file',
    'discharge_dir', 'discharge_files',
    // input data
    'catchment_runoff_files', 'runoff_grid_files', 'grid_weights_file',
    // time (all optional for Rapid — NO start_datetime per docs)
    'dt_routing', 'dt_runoff', 'dt_discharge', 'dt_total',
    // processing
    'runoff_processing_mode', 'runoff_accumulation_type',
    // variable names (all)
    'var_river_id', 'var_discharge', 'var_x', 'var_y', 'var_t',
    'var_catchment_runoff_variable', 'var_runoff_depth', 'log_level',
  ]),
  UnitMuskingum: new Set([
    '_router',
    // core + state + output
    'params_file', 'channel_state_init_file', 'channel_state_final_file',
    'discharge_dir', 'discharge_files',
    // input data
    'catchment_runoff_files', 'runoff_grid_files', 'grid_weights_file',
    // unit hydrograph
    'transformer_kernel_file', 'transformer_state_init_file', 'transformer_state_final_file',
    // time (all optional — NO start_datetime per docs)
    'dt_routing', 'dt_runoff', 'dt_discharge', 'dt_total',
    // processing
    'runoff_processing_mode', 'runoff_accumulation_type',
    // variable names (all)
    'var_river_id', 'var_discharge', 'var_x', 'var_y', 'var_t',
    'var_catchment_runoff_variable', 'var_runoff_depth', 'log_level',
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

  const addFile = (path) => {
    onChange(field.key, [...files, path])
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
      <button class="btn-secondary" onClick={() => setBrowserOpen(true)} style={{ marginTop: '4px' }}>
        + Add File
      </button>
      <FileBrowser
        open={browserOpen}
        mode="file"
        onSelect={addFile}
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

  return (
    <div class="form-group">
      <label class="form-label">
        {field.label}
        {field.required && <span style={{ color: 'var(--error)', marginLeft: '4px' }}>*</span>}
      </label>
      {field.type === 'select' ? (
        <select
          value={value || field.options[0]}
          onChange={(e) => onChange(field.key, e.target.value)}
        >
          {field.options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
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

function inferLateralMode(config) {
  const hasCatchment = config.catchment_runoff_files && config.catchment_runoff_files.length > 0
  const hasGrid = (config.runoff_grid_files && config.runoff_grid_files.length > 0) || config.grid_weights_file
  if (hasCatchment) return 'catchment'
  if (hasGrid) return 'grid'
  return 'catchment'
}

export function RouterForm({ router, config, onChange }) {
  const [lateralMode, setLateralMode] = useState(() => inferLateralMode(config))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const validKeys = VALID_KEYS[router] || VALID_KEYS.Muskingum
  const filteredAdvanced = ADVANCED_FIELDS.filter(f => validKeys.has(f.key))

  // Update lateral mode when config changes (e.g. JSON loaded)
  useEffect(() => {
    setLateralMode(inferLateralMode(config))
  }, [config.catchment_runoff_files, config.runoff_grid_files, config.grid_weights_file])
  const isTransform = router === 'RapidMuskingum' || router === 'UnitMuskingum'

  return (
    <div>
      <FieldGroup title="Core Files" fields={COMMON_FIELDS} config={config} onChange={onChange} />

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
            {LATERAL_MODE_FIELDS[lateralMode].map(field => (
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
