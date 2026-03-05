import { useState, useEffect, useContext, useCallback, useRef } from 'preact/hooks'
import { WsContext, ConfigContext } from '../app.jsx'
import { resolveDischargeDir } from '../components/CodePreview.jsx'
import { FileBrowser } from '../components/FileBrowser.jsx'
import { HydrographChart } from '../components/HydrographChart.jsx'
import { OVERLAY_COLORS } from '../utils/colors.js'
import { parseCSV } from '../utils/parseCSV.js'

function MetricCard({ label, value, good }) {
  const color = good === true ? 'var(--success)'
    : good === false ? 'var(--error)'
    : 'var(--accent-bright)'
  return (
    <div style={S.stat}>
      <div style={{ ...S.statValue, color }}>{value}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  )
}

function isGoodMetric(key, val) {
  if (val === null || val === undefined || isNaN(val)) return undefined
  if (key === 'kge' || key === 'nse') return val > 0.5
  if (key === 'pbias') return Math.abs(val) < 25
  return undefined
}

/** Left panel: file inputs and controls */
export function ValidationControls() {
  const ws = useContext(WsContext)
  const { config } = useContext(ConfigContext)

  const [simFiles, setSimFiles] = useState(() => {
    const resolved = resolveDischargeDir(config)
    return resolved.discharge_files || []
  })
  const [refMode, setRefMode] = useState('netcdf') // 'netcdf' | 'csv'
  const [refFiles, setRefFiles] = useState([])
  const [refCsvText, setRefCsvText] = useState('')
  const [csvRiverId, setCsvRiverId] = useState('')
  const [riverIdsInput, setRiverIdsInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)
  const [simBrowserOpen, setSimBrowserOpen] = useState(false)
  const [refBrowserOpen, setRefBrowserOpen] = useState(false)
  const [selectedRiver, setSelectedRiver] = useState(null)
  const csvInputRef = useRef(null)

  const handleLoadSimFromConfig = () => {
    const resolved = resolveDischargeDir(config)
    if (resolved.discharge_files?.length > 0) {
      setSimFiles(resolved.discharge_files)
    }
  }

  const handleCsvUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setRefCsvText(reader.result)
    reader.readAsText(file)
    e.target.value = ''
  }

  const runValidation = useCallback(() => {
    if (simFiles.length === 0) {
      setError('No simulation files specified')
      return
    }
    if (refMode === 'netcdf' && refFiles.length === 0) {
      setError('No reference files specified')
      return
    }
    if (refMode === 'csv' && !refCsvText.trim()) {
      setError('No CSV reference data provided')
      return
    }
    if (refMode === 'csv' && !csvRiverId.trim()) {
      setError('Enter a river ID for the CSV data')
      return
    }

    setLoading(true)
    setError(null)
    setResults(null)

    const parsedRiverIds = riverIdsInput.trim()
      ? riverIdsInput.split(/[,\s]+/).map(s => s.trim()).filter(Boolean).map(Number).filter(n => !isNaN(n) && n > 0)
      : undefined

    ws.request(
      {
        type: 'validate_results',
        sim_files: simFiles,
        ref_files: refMode === 'netcdf' ? refFiles : [],
        ref_csv: refMode === 'csv' ? refCsvText : undefined,
        csv_river_id: refMode === 'csv' && csvRiverId ? Number(csvRiverId) : undefined,
        river_ids: parsedRiverIds,
        var_river_id: config.var_river_id || undefined,
        var_discharge: config.var_discharge || undefined,
      },
      'validation_result_data',
      (data) => {
        setLoading(false)
        if (data.error) {
          setError(data.error)
        } else {
          setResults(data)
        }
      },
      { timeout: 120000 },
    )
  }, [ws, simFiles, refFiles, refMode, refCsvText, config])

  // Load hydrograph for a specific river from validation
  const loadRiverHydrograph = useCallback((riverId) => {
    setSelectedRiver(riverId)
    // Load sim data
    ws.send({
      type: 'read_results',
      files: simFiles,
      river_id: riverId,
      var_river_id: config.var_river_id || undefined,
      var_discharge: config.var_discharge || undefined,
      source: 'validation-sim',
      label: 'Simulation',
    })
    // Load ref data (netcdf only)
    if (refMode === 'netcdf' && refFiles.length > 0) {
      ws.send({
        type: 'read_results',
        files: refFiles,
        river_id: riverId,
        var_river_id: config.var_river_id || undefined,
        var_discharge: config.var_discharge || undefined,
        source: 'validation-ref',
        label: 'Reference',
      })
    }
  }, [ws, simFiles, refFiles, refMode, config])

  return (
    <div style={S.column}>
      <h2 style={S.heading}>Validation</h2>

      {/* Simulation files */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Simulation Files ({simFiles.length})</div>
        <div style={S.fileList}>
          {simFiles.map((f, i) => (
            <div key={i} style={S.filePath}>{f}</div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          <button class="btn-secondary" onClick={() => setSimBrowserOpen(true)}>
            Browse
          </button>
          <button class="btn-secondary" onClick={handleLoadSimFromConfig}>
            From Config
          </button>
          {simFiles.length > 0 && (
            <button class="btn-secondary" onClick={() => setSimFiles([])} style={{ padding: '6px 14px', fontSize: '13px' }}>
              Clear
            </button>
          )}
        </div>
        <FileBrowser
          open={simBrowserOpen}
          mode="file"
          multiSelect
          onSelect={(paths) => setSimFiles(prev => {
            const existing = new Set(prev)
            const newFiles = paths.filter(p => !existing.has(p))
            return newFiles.length > 0 ? [...prev, ...newFiles] : prev
          })}
          onClose={() => setSimBrowserOpen(false)}
        />
      </div>

      {/* Reference data */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Reference / Observed Data</div>
        <div class="form-group">
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button
              class={refMode === 'netcdf' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setRefMode('netcdf')}
            >
              NetCDF Files
            </button>
            <button
              class={refMode === 'csv' ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setRefMode('csv')}
            >
              CSV Upload
            </button>
          </div>
        </div>

        {refMode === 'netcdf' ? (
          <>
            <div style={S.fileList}>
              {refFiles.map((f, i) => (
                <div key={i} style={S.filePath}>{f}</div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button class="btn-secondary" onClick={() => setRefBrowserOpen(true)}>
                Browse
              </button>
              {refFiles.length > 0 && (
                <button class="btn-secondary" onClick={() => setRefFiles([])} style={{ padding: '6px 14px', fontSize: '13px' }}>
                  Clear
                </button>
              )}
            </div>
            <FileBrowser
              open={refBrowserOpen}
              mode="file"
              multiSelect
              onSelect={(paths) => setRefFiles(prev => {
                const existing = new Set(prev)
                const newFiles = paths.filter(p => !existing.has(p))
                return newFiles.length > 0 ? [...prev, ...newFiles] : prev
              })}
              onClose={() => setRefBrowserOpen(false)}
            />
          </>
        ) : (
          <>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
              CSV format: datetime, discharge (with header row)
            </div>
            <div class="form-group">
              <label class="form-label">River ID</label>
              <input
                type="number"
                value={csvRiverId}
                onInput={(e) => setCsvRiverId(e.target.value)}
                placeholder="River ID for this CSV"
              />
            </div>
            <button class="btn-secondary" onClick={() => csvInputRef.current?.click()}>
              Upload CSV
            </button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={handleCsvUpload}
            />
            {refCsvText && (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                CSV loaded ({refCsvText.split('\n').length - 1} rows)
              </div>
            )}
          </>
        )}
      </div>

      {/* River IDs filter */}
      <div class="form-group" style={{ marginBottom: '12px' }}>
        <label class="form-label">River IDs (optional — leave blank for all common IDs)</label>
        <input
          type="text"
          value={riverIdsInput}
          onInput={(e) => setRiverIdsInput(e.target.value)}
          placeholder="e.g. 12345, 67890 or blank for all"
        />
      </div>

      {/* Run validation */}
      <div style={{ marginBottom: '16px' }}>
        <button
          class="btn-primary"
          onClick={runValidation}
          disabled={loading}
          style={{ width: '100%' }}
        >
          {loading ? 'Computing Metrics...' : 'Run Validation'}
        </button>
      </div>

      {error && <div style={S.errorBlock}>{error}</div>}

      {/* Results table */}
      {results && (
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <div style={S.sectionTitle}>
            Results — {results.n_rivers} river{results.n_rivers !== 1 ? 's' : ''}
          </div>

          {/* Summary stats */}
          {results.results?.length > 0 && (() => {
            const valid = results.results.filter(r => !r.error)
            if (valid.length === 0) return null
            const avg = (key) => valid.reduce((s, r) => s + (r[key] || 0), 0) / valid.length
            return (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Average Metrics ({valid.length} rivers)
                </div>
                <div style={S.statRow}>
                  <MetricCard label="KGE" value={avg('kge').toFixed(3)} good={isGoodMetric('kge', avg('kge'))} />
                  <MetricCard label="KGE 2012" value={avg('kge_2012').toFixed(3)} good={isGoodMetric('kge', avg('kge_2012'))} />
                  <MetricCard label="NSE" value={avg('nse').toFixed(3)} good={isGoodMetric('nse', avg('nse'))} />
                  <MetricCard label="RMSE" value={avg('rmse').toFixed(2)} />
                  <MetricCard label="% Bias" value={avg('pbias').toFixed(1) + '%'} good={isGoodMetric('pbias', avg('pbias'))} />
                </div>
              </div>
            )
          })()}

          {/* Per-river table */}
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>River ID</th>
                  <th style={S.th}>KGE</th>
                  <th style={S.th}>KGE '12</th>
                  <th style={S.th}>NSE</th>
                  <th style={S.th}>RMSE</th>
                  <th style={S.th}>% Bias</th>
                  <th style={S.th}>r</th>
                  <th style={S.th}>N</th>
                </tr>
              </thead>
              <tbody>
                {results.results?.map((r, i) => (
                  <tr
                    key={i}
                    style={{
                      ...S.tr,
                      background: selectedRiver === r.river_id ? 'var(--accent)' : undefined,
                      color: selectedRiver === r.river_id ? '#fff' : undefined,
                      cursor: r.error ? 'default' : 'pointer',
                    }}
                    onClick={() => !r.error && loadRiverHydrograph(r.river_id)}
                  >
                    <td style={S.td}>{r.river_id}</td>
                    {r.error ? (
                      <td style={{ ...S.td, color: 'var(--error)' }} colSpan={7}>{r.error}</td>
                    ) : (
                      <>
                        <td style={{ ...S.td, color: isGoodMetric('kge', r.kge) === true ? 'var(--success)' : isGoodMetric('kge', r.kge) === false ? 'var(--error)' : undefined }}>{r.kge?.toFixed(3)}</td>
                        <td style={{ ...S.td, color: isGoodMetric('kge', r.kge_2012) === true ? 'var(--success)' : isGoodMetric('kge', r.kge_2012) === false ? 'var(--error)' : undefined }}>{r.kge_2012?.toFixed(3)}</td>
                        <td style={{ ...S.td, color: isGoodMetric('nse', r.nse) === true ? 'var(--success)' : isGoodMetric('nse', r.nse) === false ? 'var(--error)' : undefined }}>{r.nse?.toFixed(3)}</td>
                        <td style={S.td}>{r.rmse?.toFixed(2)}</td>
                        <td style={{ ...S.td, color: isGoodMetric('pbias', r.pbias) === true ? 'var(--success)' : isGoodMetric('pbias', r.pbias) === false ? 'var(--error)' : undefined }}>{r.pbias?.toFixed(1)}%</td>
                        <td style={S.td}>{r.r?.toFixed(3)}</td>
                        <td style={S.td}>{r.n_common}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/** Right panel: hydrograph for selected river */
export function ValidationChart() {
  const ws = useContext(WsContext)
  const [simData, setSimData] = useState(null)
  const [refData, setRefData] = useState(null)

  // Listen for validation-specific result_data
  useEffect(() => {
    const unsub = ws.on('result_data', (data) => {
      if (data.source === 'validation-sim') {
        if (!data.error) setSimData(data)
      } else if (data.source === 'validation-ref') {
        if (!data.error) setRefData(data)
      }
    })
    return unsub
  }, [ws])

  if (!simData) {
    return (
      <div style={S.column}>
        <div style={S.emptyState}>
          <div style={S.emptyText}>
            Run validation and click a river row to view its hydrograph
          </div>
        </div>
      </div>
    )
  }

  const overlays = []
  if (refData) {
    overlays.push({
      label: 'Reference',
      times: refData.times,
      discharge: refData.discharge,
      color: OVERLAY_COLORS[0],
    })
  }

  return (
    <div style={{ ...S.column, overflow: 'auto' }}>
      <HydrographChart
        times={simData.times}
        discharge={simData.discharge}
        riverId={simData.river_id}
        overlays={overlays}
      />
      <div style={S.statRow}>
        <MetricCard label="Sim Mean" value={simData.stats?.mean?.toFixed(2) ?? '—'} />
        <MetricCard label="Sim Max" value={simData.stats?.max?.toFixed(2) ?? '—'} />
        {refData && <MetricCard label="Ref Mean" value={refData.stats?.mean?.toFixed(2) ?? '—'} />}
        {refData && <MetricCard label="Ref Max" value={refData.stats?.max?.toFixed(2) ?? '—'} />}
      </div>
    </div>
  )
}

const S = {
  column: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    padding: '16px',
    overflow: 'hidden',
    minHeight: 0,
  },
  heading: {
    fontSize: '16px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    marginBottom: '16px',
    flexShrink: 0,
  },
  section: {
    marginBottom: '16px',
    flexShrink: 0,
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px',
  },
  fileList: {
    maxHeight: '120px',
    overflowY: 'auto',
  },
  filePath: {
    fontSize: '13px',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
    color: 'var(--text-secondary)',
    padding: '4px 8px',
    background: 'var(--bg-elevated)',
    borderRadius: '4px',
    marginBottom: '4px',
    wordBreak: 'break-all',
  },
  errorBlock: {
    fontSize: '14px',
    color: '#fb7185',
    background: 'rgba(251, 113, 133, 0.1)',
    border: '1px solid rgba(251, 113, 133, 0.3)',
    borderRadius: '6px',
    padding: '10px 12px',
    flexShrink: 0,
    marginBottom: '12px',
  },
  statRow: {
    display: 'flex',
    gap: '10px',
    flexShrink: 0,
    marginTop: '12px',
  },
  stat: {
    flex: '1',
    background: 'var(--bg-elevated)',
    borderRadius: '6px',
    padding: '10px',
    textAlign: 'center',
  },
  statValue: {
    fontSize: '17px',
    fontWeight: '700',
    color: 'var(--accent-bright)',
  },
  statLabel: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    marginTop: '2px',
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  emptyText: {
    color: 'var(--text-muted)',
    fontSize: '15px',
  },
  tableWrap: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  th: {
    textAlign: 'left',
    padding: '6px 10px',
    borderBottom: '2px solid var(--border)',
    color: 'var(--text-muted)',
    fontWeight: '600',
    fontSize: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    whiteSpace: 'nowrap',
  },
  tr: {
    transition: 'background 0.06s',
  },
  td: {
    padding: '5px 10px',
    borderBottom: '1px solid var(--border)',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
    fontSize: '13px',
    whiteSpace: 'nowrap',
  },
}
