import { useState, useContext, useEffect, useCallback, useRef } from 'preact/hooks'
import { WsContext, ConfigContext } from '../app.jsx'
import { resolveDischargeDir } from '../components/CodePreview.jsx'
import { HydrographChart } from '../components/HydrographChart.jsx'
import { FileBrowser } from '../components/FileBrowser.jsx'
import { OVERLAY_COLORS } from '../utils/colors.js'

function formatVolume(times, discharge) {
  if (!times || times.length < 2 || !discharge) return '—'
  const t0 = new Date(times[0]).getTime() / 1000
  const t1 = new Date(times[1]).getTime() / 1000
  const dt = Math.abs(t1 - t0)
  if (dt === 0) return '—'
  let volume = 0
  for (let i = 0; i < discharge.length; i++) {
    volume += (discharge[i] || 0) * dt
  }
  if (volume >= 1e9) return `${(volume / 1e9).toFixed(2)} km³`
  if (volume >= 1e6) return `${(volume / 1e6).toFixed(2)} Mm³`
  if (volume >= 1e3) return `${(volume / 1e3).toFixed(1)} thousand m³`
  return `${volume.toFixed(1)} m³`
}

function computeStats(discharge) {
  if (!discharge || discharge.length === 0) return null
  let min = Infinity, max = -Infinity, sum = 0
  for (let i = 0; i < discharge.length; i++) {
    const v = discharge[i] || 0
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  return { min, max, mean: sum / discharge.length }
}

function MetricCard({ label, value, good }) {
  const color = good === true ? 'var(--success)'
    : good === false ? 'var(--error)'
    : 'var(--accent-bright)'
  return (
    <div style={styles.stat}>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  )
}

function isGoodMetric(key, val) {
  if (val === null || val === undefined || isNaN(val)) return undefined
  if (key === 'kge' || key === 'nse') return val > 0.5
  if (key === 'pbias') return Math.abs(val) < 25
  return undefined
}

/** Left panel: discharge files, river IDs, reference data, comparisons, validation */
export function ResultsBrowser() {
  const ws = useContext(WsContext)
  const { config } = useContext(ConfigContext)

  // Primary discharge files
  const [files, setFiles] = useState([])
  const [primaryDir, setPrimaryDir] = useState('')
  const [primaryBrowserOpen, setPrimaryBrowserOpen] = useState(false)
  const [primaryLabel, setPrimaryLabel] = useState('Primary')

  // River IDs
  const [riverIdInput, setRiverIdInput] = useState(() => {
    try { return sessionStorage.getItem('rr_river_id') || '' } catch { return '' }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // River ID browser
  const [allRiverIds, setAllRiverIds] = useState(null)
  const [riverIdFilter, setRiverIdFilter] = useState('')
  const [riverIdBrowserOpen, setRiverIdBrowserOpen] = useState(false)
  const [loadingIds, setLoadingIds] = useState(false)

  // Reference data
  const [refMode, setRefMode] = useState('csv') // 'netcdf' | 'csv'
  const [refFiles, setRefFiles] = useState([])
  const [refCsvText, setRefCsvText] = useState('')
  const [csvRiverId, setCsvRiverId] = useState('')
  const [refBrowserOpen, setRefBrowserOpen] = useState(false)
  const csvInputRef = useRef(null)

  // Comparison datasets
  const [compDatasets, setCompDatasets] = useState([])
  const [compDirInput, setCompDirInput] = useState('')
  const [compDirLoading, setCompDirLoading] = useState(false)
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false)
  const scanCleanupRef = useRef(null)

  // Validation
  const [validating, setValidating] = useState(false)
  const [validationResults, setValidationResults] = useState(null)
  const [selectedRiver, setSelectedRiver] = useState(null)

  useEffect(() => {
    try { sessionStorage.setItem('rr_river_id', riverIdInput) } catch {}
  }, [riverIdInput])

  useEffect(() => {
    const unsub = ws.on('result_data', (data) => {
      if (data.source === 'comparison' || data.source === 'validation-sim' || data.source === 'validation-ref') return
      setLoading(false)
      if (data.error) setError(data.error)
      else setError(null)
    })
    return unsub
  }, [ws])

  // Scan primary directory
  const scanPrimaryDir = useCallback((dirPath) => {
    if (!dirPath) return
    setError(null)
    ws.request(
      { type: 'browse_files', path: dirPath, mode: 'file' },
      'browse_result',
      (data) => {
        if (data.error) { setError(data.error); return }
        const ncFiles = (data.entries || [])
          .filter(e => e.type === 'file' && e.name.endsWith('.nc'))
          .map(e => `${data.path}/${e.name}`)
          .sort()
        if (ncFiles.length === 0) { setError(`No .nc files found in: ${data.path}`); return }
        setFiles(ncFiles)
        setPrimaryDir(data.path)
        setPrimaryLabel(data.path.split('/').filter(Boolean).pop() || 'Primary')
      },
    )
  }, [ws])

  const loadFromConfig = useCallback(() => {
    const resolved = resolveDischargeDir(config)
    if (resolved.discharge_files?.length > 0) {
      setFiles(resolved.discharge_files)
      setPrimaryLabel(config._router || 'Primary')
      setPrimaryDir('')
      return
    }
    if (config.discharge_dir) { scanPrimaryDir(config.discharge_dir); return }
    setError('No discharge files or directory set in current config')
  }, [config, scanPrimaryDir])

  // Scan comparison directory
  const scanDirectory = useCallback((dirPath) => {
    if (!dirPath) return
    setCompDirLoading(true)
    setError(null)
    if (scanCleanupRef.current) scanCleanupRef.current()
    scanCleanupRef.current = ws.request(
      { type: 'browse_files', path: dirPath, mode: 'file' },
      'browse_result',
      (data) => {
        scanCleanupRef.current = null
        setCompDirLoading(false)
        if (data.error) { setError(data.error); return }
        const ncFiles = (data.entries || [])
          .filter(e => e.type === 'file' && e.name.endsWith('.nc'))
          .map(e => `${data.path}/${e.name}`)
          .sort()
        if (ncFiles.length === 0) { setError(`No .nc files found in: ${data.path}`); return }
        const absDir = data.path
        const defaultLabel = absDir.split('/').filter(Boolean).pop() || 'Comparison'
        setCompDatasets(prev => {
          if (prev.some(d => d.directory === absDir)) return prev
          return [...prev, { directory: absDir, files: ncFiles, label: defaultLabel }]
        })
      },
    )
  }, [ws])

  const parseRiverIds = (input) => {
    return input.split(/[,\s]+/).map(s => s.trim()).filter(Boolean).map(Number).filter(n => !isNaN(n) && n > 0)
  }

  const loadRiver = useCallback(() => {
    const ids = parseRiverIds(riverIdInput)
    if (!files.length || ids.length === 0) return
    setLoading(true)
    setError(null)

    ids.forEach((rid, i) => {
      ws.send({
        type: 'read_results',
        files,
        river_id: rid,
        source: i === 0 ? 'primary' : 'multi-river',
        label: i === 0 ? primaryLabel : `River ${rid}`,
      })
    })

    ids.forEach((rid) => {
      compDatasets.forEach((dataset) => {
        ws.send({
          type: 'read_results',
          files: dataset.files,
          river_id: rid,
          source: 'comparison',
          label: `${dataset.label} (${rid})`,
        })
      })
    })
  }, [ws, files, riverIdInput, primaryLabel, compDatasets])

  const loadRiverIds = useCallback(() => {
    if (!files.length) return
    setLoadingIds(true)
    ws.request(
      { type: 'list_river_ids', files },
      'river_id_list',
      (data) => {
        setLoadingIds(false)
        if (data.error) setError(data.error)
        else { setAllRiverIds(data.ids || []); setRiverIdBrowserOpen(true) }
      },
    )
  }, [ws, files])

  // Reference CSV upload
  const handleCsvUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setRefCsvText(reader.result)
    reader.readAsText(file)
    e.target.value = ''
  }

  // Run validation
  const runValidation = useCallback(() => {
    if (files.length === 0) { setError('No discharge files specified'); return }
    if (refMode === 'netcdf' && refFiles.length === 0) { setError('No reference files specified'); return }
    if (refMode === 'csv' && !refCsvText.trim()) { setError('No CSV reference data provided'); return }
    if (refMode === 'csv' && !csvRiverId.trim()) { setError('Enter a river ID for the CSV data'); return }

    setValidating(true)
    setError(null)
    setValidationResults(null)

    const parsedRiverIds = riverIdInput.trim()
      ? parseRiverIds(riverIdInput)
      : undefined

    ws.request(
      {
        type: 'validate_results',
        sim_files: files,
        ref_files: refMode === 'netcdf' ? refFiles : [],
        ref_csv: refMode === 'csv' ? refCsvText : undefined,
        csv_river_id: refMode === 'csv' && csvRiverId ? Number(csvRiverId) : undefined,
        river_ids: parsedRiverIds,
      },
      'validation_result_data',
      (data) => {
        setValidating(false)
        if (data.error) setError(data.error)
        else setValidationResults(data)
      },
      { timeout: 120000 },
    )
  }, [ws, files, refFiles, refMode, refCsvText, csvRiverId, riverIdInput])

  // Load hydrograph for a river from validation table
  const loadRiverHydrograph = useCallback((riverId) => {
    setSelectedRiver(riverId)
    ws.send({ type: 'read_results', files, river_id: riverId, source: 'validation-sim', label: 'Simulation' })
    if (refMode === 'netcdf' && refFiles.length > 0) {
      ws.send({ type: 'read_results', files: refFiles, river_id: riverId, source: 'validation-ref', label: 'Reference' })
    }
  }, [ws, files, refFiles, refMode])

  const handleAddDir = useCallback(() => {
    const dirPath = compDirInput.trim()
    if (!dirPath) return
    scanDirectory(dirPath)
    setCompDirInput('')
  }, [compDirInput, scanDirectory])

  const handleBrowseSelect = useCallback((dirPath) => {
    if (dirPath) scanDirectory(dirPath)
  }, [scanDirectory])

  const hasRef = (refMode === 'csv' && refCsvText.trim()) || (refMode === 'netcdf' && refFiles.length > 0)

  return (
    <div style={styles.column}>
      <h2 style={styles.heading}>Results</h2>

      {/* Primary discharge files */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>
          Discharge Files {files.length > 0 ? `(${files.length})` : ''}
        </div>
        <div style={styles.inputRow}>
          <input
            type="text"
            value={primaryDir}
            onInput={(e) => setPrimaryDir(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && scanPrimaryDir(primaryDir.trim())}
            placeholder="Directory path with .nc files"
            style={{ flex: 1 }}
          />
          <button class="btn-secondary" onClick={() => setPrimaryBrowserOpen(true)}>Browse</button>
          <button class="btn-secondary" onClick={loadFromConfig} title="Use discharge files from current config">From Config</button>
        </div>
        <FileBrowser
          open={primaryBrowserOpen}
          mode="directory"
          onSelect={(path) => { if (path) scanPrimaryDir(path) }}
          onClose={() => setPrimaryBrowserOpen(false)}
        />
        {files.length > 0 && (
          <>
            <div style={{ ...styles.fileList, marginTop: '8px' }}>
              {files.map((f, i) => <div key={i} style={styles.filePath}>{f}</div>)}
            </div>
            <div style={{ marginTop: '8px' }}>
              <label style={styles.inputLabel}>Dataset Label</label>
              <input type="text" value={primaryLabel} onInput={(e) => setPrimaryLabel(e.target.value)} style={styles.labelInput} placeholder="Primary" />
            </div>
          </>
        )}
      </div>

      {/* River ID input */}
      <div style={styles.section}>
        <label style={styles.inputLabel}>River IDs (comma-separated for multi-river)</label>
        <div style={styles.inputRow}>
          <input
            type="text"
            value={riverIdInput}
            onInput={(e) => setRiverIdInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadRiver()}
            placeholder="e.g. 12345 or 12345, 67890"
          />
          <button class="btn-primary" onClick={loadRiver} disabled={!riverIdInput.trim() || loading}>
            {loading ? 'Loading...' : 'Load'}
          </button>
          <button class="btn-secondary" onClick={loadRiverIds} disabled={loadingIds || !files.length} title="Scan files for available river IDs">
            {loadingIds ? '...' : 'Scan'}
          </button>
        </div>

        {riverIdBrowserOpen && allRiverIds && (
          <div style={styles.idBrowser}>
            <div style={styles.idBrowserHeader}>
              <input
                type="text"
                value={riverIdFilter}
                onInput={(e) => setRiverIdFilter(e.target.value)}
                placeholder={`Filter ${allRiverIds.length} river IDs...`}
                style={{ flex: 1 }}
              />
              <button class="btn-secondary" style={styles.removeBtn} onClick={() => setRiverIdBrowserOpen(false)}>X</button>
            </div>
            <div style={styles.idList}>
              {allRiverIds
                .filter(id => !riverIdFilter || String(id).includes(riverIdFilter))
                .slice(0, 200)
                .map(id => (
                  <button key={id} style={styles.idBtn} onClick={() => {
                    const current = riverIdInput.trim()
                    if (!current) setRiverIdInput(String(id))
                    else {
                      const existing = parseRiverIds(current)
                      if (!existing.includes(id)) setRiverIdInput(current + ', ' + id)
                    }
                  }}>{id}</button>
                ))
              }
              {allRiverIds.filter(id => !riverIdFilter || String(id).includes(riverIdFilter)).length > 200 && (
                <div style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  ...and {allRiverIds.filter(id => !riverIdFilter || String(id).includes(riverIdFilter)).length - 200} more
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Reference / Observed Data */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Reference / Observed Data</div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <button class={refMode === 'csv' ? 'btn-primary' : 'btn-secondary'} onClick={() => setRefMode('csv')}>CSV Upload</button>
          <button class={refMode === 'netcdf' ? 'btn-primary' : 'btn-secondary'} onClick={() => setRefMode('netcdf')}>NetCDF Files</button>
        </div>

        {refMode === 'csv' ? (
          <>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
              CSV format: datetime, discharge (with header row)
            </div>
            <div class="form-group">
              <label class="form-label">River ID</label>
              <input type="number" value={csvRiverId} onInput={(e) => setCsvRiverId(e.target.value)} placeholder="River ID for this CSV" />
            </div>
            <button class="btn-secondary" onClick={() => csvInputRef.current?.click()}>Upload CSV</button>
            <input ref={csvInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCsvUpload} />
            {refCsvText && (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                CSV loaded ({refCsvText.split('\n').length - 1} rows)
              </div>
            )}
          </>
        ) : (
          <>
            <div style={styles.fileList}>
              {refFiles.map((f, i) => <div key={i} style={styles.filePath}>{f}</div>)}
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button class="btn-secondary" onClick={() => setRefBrowserOpen(true)}>Browse</button>
              {refFiles.length > 0 && (
                <button class="btn-secondary" onClick={() => setRefFiles([])} style={{ padding: '6px 14px', fontSize: '13px' }}>Clear</button>
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
        )}

        {hasRef && files.length > 0 && (
          <div style={{ marginTop: '10px' }}>
            <button
              class="btn-primary"
              onClick={runValidation}
              disabled={validating}
              style={{ width: '100%' }}
            >
              {validating ? 'Computing Metrics...' : 'Validate'}
            </button>
          </div>
        )}
      </div>

      {/* Validation results */}
      {validationResults && (
        <div style={{ ...styles.section, flex: 1, overflow: 'auto', minHeight: 0 }}>
          <div style={styles.sectionTitle}>
            Metrics — {validationResults.n_rivers} river{validationResults.n_rivers !== 1 ? 's' : ''}
          </div>

          {validationResults.results?.length > 0 && (() => {
            const valid = validationResults.results.filter(r => !r.error)
            if (valid.length === 0) return null
            const avg = (key) => valid.reduce((s, r) => s + (r[key] || 0), 0) / valid.length
            return (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Average ({valid.length} rivers)
                </div>
                <div style={styles.statRow}>
                  <MetricCard label="KGE" value={avg('kge').toFixed(3)} good={isGoodMetric('kge', avg('kge'))} />
                  <MetricCard label="NSE" value={avg('nse').toFixed(3)} good={isGoodMetric('nse', avg('nse'))} />
                  <MetricCard label="RMSE" value={avg('rmse').toFixed(2)} />
                  <MetricCard label="% Bias" value={avg('pbias').toFixed(1) + '%'} good={isGoodMetric('pbias', avg('pbias'))} />
                </div>
              </div>
            )
          })()}

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>River ID</th>
                  <th style={styles.th}>KGE</th>
                  <th style={styles.th}>NSE</th>
                  <th style={styles.th}>RMSE</th>
                  <th style={styles.th}>% Bias</th>
                  <th style={styles.th}>r</th>
                  <th style={styles.th}>N</th>
                </tr>
              </thead>
              <tbody>
                {validationResults.results?.map((r, i) => (
                  <tr
                    key={i}
                    style={{
                      ...styles.tr,
                      background: selectedRiver === r.river_id ? 'var(--accent)' : undefined,
                      color: selectedRiver === r.river_id ? '#fff' : undefined,
                      cursor: r.error ? 'default' : 'pointer',
                    }}
                    onClick={() => !r.error && loadRiverHydrograph(r.river_id)}
                  >
                    <td style={styles.td}>{r.river_id}</td>
                    {r.error ? (
                      <td style={{ ...styles.td, color: 'var(--error)' }} colSpan={6}>{r.error}</td>
                    ) : (
                      <>
                        <td style={{ ...styles.td, color: isGoodMetric('kge', r.kge) === true ? 'var(--success)' : isGoodMetric('kge', r.kge) === false ? 'var(--error)' : undefined }}>{r.kge?.toFixed(3)}</td>
                        <td style={{ ...styles.td, color: isGoodMetric('nse', r.nse) === true ? 'var(--success)' : isGoodMetric('nse', r.nse) === false ? 'var(--error)' : undefined }}>{r.nse?.toFixed(3)}</td>
                        <td style={styles.td}>{r.rmse?.toFixed(2)}</td>
                        <td style={{ ...styles.td, color: isGoodMetric('pbias', r.pbias) === true ? 'var(--success)' : isGoodMetric('pbias', r.pbias) === false ? 'var(--error)' : undefined }}>{r.pbias?.toFixed(1)}%</td>
                        <td style={styles.td}>{r.r?.toFixed(3)}</td>
                        <td style={styles.td}>{r.n_common}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Comparison Datasets */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>Comparison Datasets ({compDatasets.length})</div>
        {compDatasets.map((dataset) => (
          <div key={dataset.directory} style={{ marginBottom: '12px' }}>
            <div style={styles.compFileRow}>
              <input type="text" value={dataset.label} onInput={(e) => setCompDatasets(prev => prev.map(d => d.directory === dataset.directory ? { ...d, label: e.target.value } : d))} style={styles.labelInput} placeholder="Dataset name" />
              <button class="btn-secondary" style={styles.removeBtn} onClick={() => setCompDatasets(prev => prev.filter(d => d.directory !== dataset.directory))}>X</button>
            </div>
            <div style={styles.compDirPath}>{dataset.directory}</div>
            <div style={styles.fileList}>
              {dataset.files.map((f, i) => <div key={i} style={styles.filePath}>{f}</div>)}
            </div>
          </div>
        ))}
        <div style={styles.inputRow}>
          <input type="text" value={compDirInput} onInput={(e) => setCompDirInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddDir()} placeholder="Directory path with .nc files" style={{ flex: 1 }} />
          <button class="btn-secondary" onClick={handleAddDir} disabled={!compDirInput.trim() || compDirLoading}>{compDirLoading ? 'Scanning...' : 'Add'}</button>
          <button class="btn-secondary" onClick={() => setFileBrowserOpen(true)} disabled={compDirLoading}>Browse</button>
        </div>
        <FileBrowser open={fileBrowserOpen} mode="directory" onSelect={handleBrowseSelect} onClose={() => setFileBrowserOpen(false)} />
      </div>

      {error && <div style={styles.errorBlock}>{error}</div>}
    </div>
  )
}

/** Right panel: hydrograph chart + stats */
export function ResultsChart() {
  const ws = useContext(WsContext)
  const [resultData, setResultData] = useState(null)
  const [overlays, setOverlays] = useState([])

  // Validation-specific data
  const [valSimData, setValSimData] = useState(null)
  const [valRefData, setValRefData] = useState(null)

  useEffect(() => {
    const unsub = ws.on('result_data', (data) => {
      if (data.error) {
        if (data.source !== 'comparison' && data.source !== 'validation-sim' && data.source !== 'validation-ref') {
          setResultData(null)
        }
        return
      }

      if (data.source === 'validation-sim') {
        setValSimData(data)
        setValRefData(null)
      } else if (data.source === 'validation-ref') {
        setValRefData(data)
      } else if (data.source === 'comparison') {
        const fallbackLabel = (data.files?.[0] || '').split('/').slice(-2, -1)[0] || 'Comparison'
        setOverlays(prev => {
          const color = OVERLAY_COLORS[prev.length % OVERLAY_COLORS.length]
          return [...prev, { label: data.label || fallbackLabel, times: data.times, discharge: data.discharge, color, source: 'comparison' }]
        })
      } else if (data.source === 'multi-river') {
        setOverlays(prev => {
          const color = OVERLAY_COLORS[prev.length % OVERLAY_COLORS.length]
          return [...prev, { label: data.label || `River ${data.river_id}`, times: data.times, discharge: data.discharge, color, source: 'multi-river' }]
        })
      } else {
        setResultData({ ...data, label: data.label || 'Primary' })
        setOverlays([])
        setValSimData(null)
        setValRefData(null)
      }
    })
    return unsub
  }, [ws])

  const removeOverlay = (index) => setOverlays(prev => prev.filter((_, i) => i !== index))

  // Show validation hydrograph if selected from table
  if (valSimData) {
    const valOverlays = []
    if (valRefData) {
      valOverlays.push({ label: 'Reference', times: valRefData.times, discharge: valRefData.discharge, color: OVERLAY_COLORS[0] })
    }
    return (
      <div style={{ ...styles.column, overflow: 'auto' }}>
        <HydrographChart times={valSimData.times} discharge={valSimData.discharge} riverId={valSimData.river_id} overlays={valOverlays} />
        <div style={styles.statRow}>
          <MetricCard label="Sim Mean" value={valSimData.stats?.mean?.toFixed(2) ?? '—'} />
          <MetricCard label="Sim Max" value={valSimData.stats?.max?.toFixed(2) ?? '—'} />
          {valRefData && <MetricCard label="Ref Mean" value={valRefData.stats?.mean?.toFixed(2) ?? '—'} />}
          {valRefData && <MetricCard label="Ref Max" value={valRefData.stats?.max?.toFixed(2) ?? '—'} />}
        </div>
      </div>
    )
  }

  if (!resultData && overlays.length === 0) {
    return (
      <div style={styles.column}>
        <div style={styles.emptyState}>
          <div style={styles.emptyText}>Enter a river ID and click Load to view a hydrograph</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ ...styles.column, overflow: 'auto' }}>
      {resultData ? (
        <HydrographChart times={resultData.times} discharge={resultData.discharge} riverId={resultData.river_id} overlays={overlays} />
      ) : (
        <HydrographChart times={overlays[0].times} discharge={overlays[0].discharge} riverId={overlays[0].label} overlays={overlays.slice(1)} />
      )}

      {resultData && (
        <div style={styles.statsBlock}>
          <div style={styles.statsBlockLabel}>
            <span style={{ ...styles.colorSwatch, background: '#6366f1' }} />
            {resultData.label}
          </div>
          <div style={styles.statRow}>
            <MetricCard label="Min Q (m³/s)" value={resultData.stats.min.toFixed(2)} />
            <MetricCard label="Max Q (m³/s)" value={resultData.stats.max.toFixed(2)} />
            <MetricCard label="Mean Q (m³/s)" value={resultData.stats.mean.toFixed(2)} />
            <MetricCard label="Timesteps" value={resultData.times.length} />
            <MetricCard label="Volume" value={formatVolume(resultData.times, resultData.discharge)} />
          </div>
        </div>
      )}

      {overlays.map((overlay, i) => {
        const s = computeStats(overlay.discharge)
        if (!s) return null
        return (
          <div key={i} style={styles.statsBlock}>
            <div style={styles.statsBlockLabel}>
              <span style={{ ...styles.colorSwatch, background: overlay.color }} />
              {overlay.label}
            </div>
            <div style={styles.statRow}>
              <MetricCard label="Min Q (m³/s)" value={s.min.toFixed(2)} />
              <MetricCard label="Max Q (m³/s)" value={s.max.toFixed(2)} />
              <MetricCard label="Mean Q (m³/s)" value={s.mean.toFixed(2)} />
              <MetricCard label="Timesteps" value={overlay.times?.length ?? '—'} />
              <MetricCard label="Volume" value={formatVolume(overlay.times, overlay.discharge)} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

const styles = {
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
    flexShrink: 0,
    marginBottom: '16px',
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
    maxHeight: '200px',
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
    flex: 1,
  },
  inputSection: {
    flexShrink: 0,
    marginBottom: '16px',
  },
  inputLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '500',
    color: 'var(--text-secondary)',
    marginBottom: '4px',
  },
  inputRow: {
    display: 'flex',
    gap: '8px',
  },
  compFileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '4px',
  },
  labelInput: {
    flex: 1,
    fontSize: '14px',
    fontWeight: '600',
    padding: '4px 8px',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
  },
  compDirPath: {
    fontSize: '11px',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
    color: 'var(--text-muted)',
    padding: '0 8px 4px',
    wordBreak: 'break-all',
  },
  removeBtn: {
    fontSize: '13px',
    padding: '6px 14px',
    flexShrink: 0,
  },
  errorBlock: {
    fontSize: '14px',
    color: '#fb7185',
    background: 'rgba(251, 113, 133, 0.1)',
    border: '1px solid rgba(251, 113, 133, 0.3)',
    borderRadius: '6px',
    padding: '10px 12px',
    flexShrink: 0,
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
  colorSwatch: {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    borderRadius: '2px',
    flexShrink: 0,
  },
  statsBlock: {
    marginTop: '16px',
    flexShrink: 0,
  },
  statsBlockLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    marginBottom: '6px',
  },
  statRow: {
    display: 'flex',
    gap: '10px',
    flexShrink: 0,
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
  idBrowser: {
    marginTop: '8px',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    background: 'var(--bg-surface)',
    overflow: 'hidden',
  },
  idBrowserHeader: {
    display: 'flex',
    gap: '6px',
    padding: '6px',
    borderBottom: '1px solid var(--border)',
  },
  idList: {
    maxHeight: '200px',
    overflowY: 'auto',
    padding: '4px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    alignContent: 'flex-start',
  },
  idBtn: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '13px',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    lineHeight: '1.6',
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
