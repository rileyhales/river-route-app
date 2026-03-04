import { useState, useContext, useEffect, useCallback, useRef } from 'preact/hooks'
import { WsContext, ConfigContext, RunContext } from '../app.jsx'
import { resolveDischargeDir } from '../components/CodePreview.jsx'
import { HydrographChart } from '../components/HydrographChart.jsx'
import { FileBrowser } from '../components/FileBrowser.jsx'
import { parseCSV } from '../utils/parseCSV.js'

/** Compute cumulative discharged volume from uniform-timestep data */
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

/** Compute min, max, mean from a discharge array */
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

/** Get output files: prefer run result, fall back to resolved config paths */
function useOutputFiles() {
  const run = useContext(RunContext)
  const { config } = useContext(ConfigContext)

  if (run.result?.output_files?.length > 0) return run.result.output_files

  const resolved = resolveDischargeDir(config)
  if (resolved.discharge_files?.length > 0) return resolved.discharge_files

  return []
}

/** Left column: output file list, river ID input, Load button, comparison files */
export function ResultsBrowser() {
  const ws = useContext(WsContext)
  const { config } = useContext(ConfigContext)
  const files = useOutputFiles()

  const [riverId, setRiverId] = useState(() => {
    try { return sessionStorage.getItem('rr_river_id') || '' } catch { return '' }
  })
  const defaultPrimaryLabel = () => {
    const dir = config.discharge_dir || ''
    return dir.split('/').filter(Boolean).pop() || 'Primary'
  }
  const [primaryLabel, setPrimaryLabel] = useState(defaultPrimaryLabel)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [compDatasets, setCompDatasets] = useState([]) // [{ directory, files }]
  const [compDirInput, setCompDirInput] = useState('')
  const [compDirLoading, setCompDirLoading] = useState(false)
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false)
  const scanCallbackRef = useRef(null)

  // Persist river_id to sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem('rr_river_id', riverId) } catch {}
  }, [riverId])

  // Listen for result_data errors on this side too (ignore comparison responses)
  useEffect(() => {
    const unsub = ws.on('result_data', (data) => {
      if (data.source === 'comparison') return
      setLoading(false)
      if (data.error) {
        setError(data.error)
      } else {
        setError(null)
      }
    })
    return unsub
  }, [ws])

  // Scan a directory for .nc files using the existing browse_files endpoint
  const scanDirectory = useCallback((dirPath) => {
    if (!dirPath) return
    setCompDirLoading(true)
    setError(null)

    // Clean up any previous pending scan
    if (scanCallbackRef.current) scanCallbackRef.current()

    const timeout = setTimeout(() => {
      cleanup()
      setCompDirLoading(false)
      setError(`Timeout scanning: ${dirPath}`)
    }, 10000)

    // One-shot listener — accept the first browse_result that isn't from an open FileBrowser
    const unsub = ws.on('browse_result', (data) => {
      cleanup()
      setCompDirLoading(false)
      if (data.error) {
        setError(data.error)
        return
      }
      const ncFiles = (data.entries || [])
        .filter(e => e.type === 'file' && e.name.endsWith('.nc'))
        .map(e => `${data.path}/${e.name}`)
        .sort()
      if (ncFiles.length === 0) {
        setError(`No .nc files found in: ${data.path}`)
        return
      }
      setError(null)
      const absDir = data.path
      // Default label from last directory name
      const defaultLabel = absDir.split('/').filter(Boolean).pop() || 'Comparison'
      setCompDatasets(prev => {
        if (prev.some(d => d.directory === absDir)) return prev
        return [...prev, { directory: absDir, files: ncFiles, label: defaultLabel }]
      })
    })

    const cleanup = () => {
      clearTimeout(timeout)
      unsub()
      scanCallbackRef.current = null
    }
    scanCallbackRef.current = cleanup

    // Send with mode='file' so the response includes .nc files (not just directories)
    ws.send({ type: 'browse_files', path: dirPath, mode: 'file' })
  }, [ws])

  const loadRiver = useCallback(() => {
    if (!files.length || !riverId) return
    setLoading(true)
    setError(null)

    // Send primary request
    ws.send({
      type: 'read_results',
      files,
      river_id: Number(riverId),
      var_river_id: config.var_river_id || undefined,
      var_discharge: config.var_discharge || undefined,
      source: 'primary',
      label: primaryLabel,
    })

    // Send comparison requests — each dataset's files opened as mfdataset
    compDatasets.forEach((dataset) => {
      ws.send({
        type: 'read_results',
        files: dataset.files,
        river_id: Number(riverId),
        var_river_id: config.var_river_id || undefined,
        var_discharge: config.var_discharge || undefined,
        source: 'comparison',
        label: dataset.label,
      })
    })
  }, [ws, files, riverId, config, primaryLabel, compDatasets])

  const handleAddDir = useCallback(() => {
    const dirPath = compDirInput.trim()
    if (!dirPath) return
    scanDirectory(dirPath)
    setCompDirInput('')
  }, [compDirInput, scanDirectory])

  const handleBrowseSelect = useCallback((dirPath) => {
    if (dirPath) scanDirectory(dirPath)
  }, [scanDirectory])

  const removeCompDataset = (directory) => {
    setCompDatasets(prev => prev.filter(d => d.directory !== directory))
  }

  const renameCompDataset = (directory, label) => {
    setCompDatasets(prev => prev.map(d => d.directory === directory ? { ...d, label } : d))
  }

  return (
    <div style={styles.column}>
      <h2 style={styles.heading}>Results</h2>

      {/* River ID input + Load */}
      {files.length > 0 && (
        <div style={styles.inputSection}>
          <label style={styles.inputLabel}>River ID</label>
          <div style={styles.inputRow}>
            <input
              type="number"
              value={riverId}
              onInput={(e) => setRiverId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadRiver()}
              placeholder="Enter river ID"
            />
            <button
              class="btn-primary"
              onClick={loadRiver}
              disabled={!riverId || loading}
            >
              {loading ? 'Loading...' : 'Load'}
            </button>
          </div>
        </div>
      )}

      {/* Output file list */}
      {files.length > 0 ? (
        <div style={styles.fileSection}>
          <div style={styles.fileSectionTitle}>
            Output Files ({files.length})
          </div>
          <div style={styles.fileList}>
            {files.map((f, i) => (
              <div key={i} style={styles.filePath}>{f}</div>
            ))}
          </div>
          <div style={{ marginTop: '8px' }}>
            <label style={styles.inputLabel}>Dataset Label</label>
            <input
              type="text"
              value={primaryLabel}
              onInput={(e) => setPrimaryLabel(e.target.value)}
              style={styles.labelInput}
              placeholder="Primary"
            />
          </div>
        </div>
      ) : (
        <div style={styles.noFiles}>
          No output files — run a simulation or set discharge_dir in Config
        </div>
      )}

      {/* Comparison Datasets */}
      {files.length > 0 && (
        <div style={styles.fileSection}>
          <div style={styles.fileSectionTitle}>
            Comparison Datasets ({compDatasets.length})
          </div>
          {compDatasets.map((dataset) => (
            <div key={dataset.directory} style={{ marginBottom: '12px' }}>
              <div style={styles.compFileRow}>
                <input
                  type="text"
                  value={dataset.label}
                  onInput={(e) => renameCompDataset(dataset.directory, e.target.value)}
                  style={styles.labelInput}
                  placeholder="Dataset name"
                />
                <button
                  class="btn-secondary"
                  style={styles.removeBtn}
                  onClick={() => removeCompDataset(dataset.directory)}
                >
                  X
                </button>
              </div>
              <div style={styles.compDirPath}>{dataset.directory}</div>
              <div style={styles.fileList}>
                {dataset.files.map((f, i) => (
                  <div key={i} style={styles.filePath}>{f}</div>
                ))}
              </div>
            </div>
          ))}
          <div style={styles.inputRow}>
            <input
              type="text"
              value={compDirInput}
              onInput={(e) => setCompDirInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddDir()}
              placeholder="Directory path with .nc files"
              style={{ flex: 1 }}
            />
            <button
              class="btn-secondary"
              onClick={handleAddDir}
              disabled={!compDirInput.trim() || compDirLoading}
            >
              {compDirLoading ? 'Scanning...' : 'Add'}
            </button>
            <button
              class="btn-secondary"
              onClick={() => setFileBrowserOpen(true)}
              disabled={compDirLoading}
            >
              Browse
            </button>
          </div>
          <FileBrowser
            open={fileBrowserOpen}
            mode="directory"
            onSelect={handleBrowseSelect}
            onClose={() => setFileBrowserOpen(false)}
          />
        </div>
      )}

      {/* Error display */}
      {error && (
        <div style={styles.errorBlock}>{error}</div>
      )}
    </div>
  )
}

/** Right column: HydrographChart + stats cards, drag-and-drop overlays */
export function ResultsChart() {
  const ws = useContext(WsContext)
  const [resultData, setResultData] = useState(null)
  const [overlays, setOverlays] = useState([])
  const [dragOver, setDragOver] = useState(false)
  const dropRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    const unsub = ws.on('result_data', (data) => {
      if (data.error) {
        if (data.source !== 'comparison') setResultData(null)
        return
      }

      if (data.source === 'comparison') {
        // Use user-provided label, fall back to directory name from file path
        const fallbackLabel = (data.files?.[0] || '').split('/').slice(-2, -1)[0]
          || (data.files?.[0] || '').split('/').pop()
          || 'Comparison'
        const OVERLAY_COLORS = ['#f97316', '#a855f7', '#14b8a6', '#ef4444', '#eab308']
        setOverlays(prev => {
          const color = OVERLAY_COLORS[prev.length % OVERLAY_COLORS.length]
          return [...prev, {
            label: data.label || fallbackLabel,
            times: data.times,
            discharge: data.discharge,
            color,
          }]
        })
      } else {
        // Primary data — clear overlays, store label
        setResultData({ ...data, label: data.label || 'Primary' })
        setOverlays([])
      }
    })
    return unsub
  }, [ws])

  const removeOverlay = (index) => {
    setOverlays(prev => prev.filter((_, i) => i !== index))
  }

  const loadCSVFiles = (files) => {
    Array.from(files).forEach((file) => {
      if (!file.name.endsWith('.csv')) return
      const reader = new FileReader()
      reader.onload = () => {
        const overlay = parseCSV(reader.result, file.name.replace('.csv', ''))
        if (overlay) {
          setOverlays(prev => [...prev, overlay])
        }
      }
      reader.readAsText(file)
    })
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) loadCSVFiles(e.dataTransfer.files)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setDragOver(false)
  }

  const handleFileUpload = (e) => {
    if (e.target.files?.length) loadCSVFiles(e.target.files)
    e.target.value = ''
  }

  const csvControls = (
    <div style={styles.overlayControls}>
      <button
        class="btn-secondary"
        style={{ fontSize: '12px', padding: '4px 10px' }}
        onClick={() => fileInputRef.current?.click()}
      >
        Upload CSV Overlay
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />
      {overlays.length > 0 && overlays.map((o, i) => (
        <div key={i} style={styles.overlayItem}>
          <span style={{ ...styles.colorSwatch, background: o.color }} />
          <span style={styles.overlayLabel}>{o.label}</span>
          <button
            class="btn-secondary"
            style={styles.removeBtn}
            onClick={() => removeOverlay(i)}
          >
            X
          </button>
        </div>
      ))}
    </div>
  )

  if (!resultData && overlays.length === 0) {
    return (
      <div style={styles.column}>
        <div style={styles.emptyState}>
          <div style={styles.emptyText}>
            Enter a river ID and click Load to view a hydrograph
          </div>
        </div>
        {csvControls}
      </div>
    )
  }

  return (
    <div style={{ ...styles.column, overflow: 'auto' }}>
      <div
        ref={dropRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          ...styles.dropZone,
          ...(dragOver ? styles.dropZoneActive : {}),
        }}
      >
        {resultData ? (
          <HydrographChart
            times={resultData.times}
            discharge={resultData.discharge}
            riverId={resultData.river_id}
            overlays={overlays}
          />
        ) : (
          <HydrographChart
            times={overlays[0].times}
            discharge={overlays[0].discharge}
            riverId="CSV"
            overlays={overlays.slice(1)}
          />
        )}
        {dragOver && (
          <div style={styles.dropIndicator}>
            Drop CSV to overlay
          </div>
        )}
      </div>

      {csvControls}

      {/* Primary stats */}
      {resultData && (
        <div style={styles.statsBlock}>
          <div style={styles.statsBlockLabel}>
            <span style={{ ...styles.colorSwatch, background: '#6366f1' }} />
            {resultData.label}
          </div>
          <div style={styles.statRow}>
            <div style={styles.stat}>
              <div style={styles.statValue}>{resultData.stats.min.toFixed(2)}</div>
              <div style={styles.statLabel}>Min Q (m³/s)</div>
            </div>
            <div style={styles.stat}>
              <div style={styles.statValue}>{resultData.stats.max.toFixed(2)}</div>
              <div style={styles.statLabel}>Max Q (m³/s)</div>
            </div>
            <div style={styles.stat}>
              <div style={styles.statValue}>{resultData.stats.mean.toFixed(2)}</div>
              <div style={styles.statLabel}>Mean Q (m³/s)</div>
            </div>
            <div style={styles.stat}>
              <div style={styles.statValue}>{resultData.times.length}</div>
              <div style={styles.statLabel}>Timesteps</div>
            </div>
            <div style={styles.stat}>
              <div style={styles.statValue}>{formatVolume(resultData.times, resultData.discharge)}</div>
              <div style={styles.statLabel}>Cumulative Volume</div>
            </div>
          </div>
        </div>
      )}

      {/* Comparison overlay stats */}
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
              <div style={styles.stat}>
                <div style={styles.statValue}>{s.min.toFixed(2)}</div>
                <div style={styles.statLabel}>Min Q (m³/s)</div>
              </div>
              <div style={styles.stat}>
                <div style={styles.statValue}>{s.max.toFixed(2)}</div>
                <div style={styles.statLabel}>Max Q (m³/s)</div>
              </div>
              <div style={styles.stat}>
                <div style={styles.statValue}>{s.mean.toFixed(2)}</div>
                <div style={styles.statLabel}>Mean Q (m³/s)</div>
              </div>
              <div style={styles.stat}>
                <div style={styles.statValue}>{overlay.times?.length ?? '—'}</div>
                <div style={styles.statLabel}>Timesteps</div>
              </div>
              <div style={styles.stat}>
                <div style={styles.statValue}>{formatVolume(overlay.times, overlay.discharge)}</div>
                <div style={styles.statLabel}>Cumulative Volume</div>
              </div>
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
  fileSection: {
    flexShrink: 0,
    marginBottom: '16px',
  },
  fileSectionTitle: {
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
  noFiles: {
    fontSize: '15px',
    color: 'var(--text-muted)',
    marginBottom: '16px',
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
    fontSize: '11px',
    padding: '2px 6px',
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
  dropZone: {
    position: 'relative',
    borderRadius: '8px',
    transition: 'border-color 0.15s',
  },
  dropZoneActive: {
    border: '2px dashed #38bdf8',
    background: 'rgba(56, 189, 248, 0.04)',
  },
  dropIndicator: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '8px',
    color: '#38bdf8',
    fontSize: '16px',
    fontWeight: '600',
    pointerEvents: 'none',
  },
  overlayControls: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '8px',
    alignItems: 'center',
    flexShrink: 0,
  },
  overlayItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'var(--bg-elevated)',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '12px',
  },
  colorSwatch: {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    borderRadius: '2px',
    flexShrink: 0,
  },
  overlayLabel: {
    color: 'var(--text-secondary)',
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
}
