import { useState, useEffect, useContext, useCallback, useRef } from 'preact/hooks'
import { WsContext, WorkdirContext } from '../app.jsx'

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    // '..' always first
    if (a.name === '..') return -1
    if (b.name === '..') return 1
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export function FileBrowser({ open, mode, multiSelect, initialPath, onSelect, onClose }) {
  const ws = useContext(WsContext)
  const { workdir } = useContext(WorkdirContext)
  const root = initialPath || workdir || '~'

  // columns: [{ path, entries, selected (entry name or null) }]
  const [columns, setColumns] = useState([])
  const [error, setError] = useState(null)
  const [pendingCol, setPendingCol] = useState(null)
  // Multi-select: track selected file names within a specific column
  const [multiSelected, setMultiSelected] = useState(new Set()) // set of full paths
  const [multiSelectCol, setMultiSelectCol] = useState(-1) // which column the selections are in
  const scrollRef = useRef(null)
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  const browseCleanupRef = useRef(null)

  const browse = useCallback((path, colIndex) => {
    setError(null)
    setPendingCol(colIndex)

    // Cancel any in-flight browse request
    if (browseCleanupRef.current) browseCleanupRef.current()

    browseCleanupRef.current = ws.request(
      { type: 'browse_files', path: path || root, mode: mode || 'file' },
      'browse_result',
      (data) => {
        browseCleanupRef.current = null
        if (data.error) {
          setError(data.error)
          setPendingCol(null)
          return
        }
        setError(null)
        const sorted = sortEntries(data.entries || [])
        setPendingCol(prev => {
          const idx = prev ?? 0
          setColumns(cols => {
            const updated = cols.slice(0, idx)
            updated.push({ path: data.path, entries: sorted, selected: null })
            return updated
          })
          return null
        })
      },
    )
  }, [ws, mode, root])

  useEffect(() => {
    if (!open) return

    // Only browse from root on first open — columns persist across close/reopen
    if (columnsRef.current.length === 0) {
      browse(root, 0)
    }

    return () => {
      if (browseCleanupRef.current) browseCleanupRef.current()
    }
  }, [open, browse, root])

  // Auto-scroll to rightmost column
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [columns.length])

  if (!open) return null

  const handleClick = (colIndex, entry) => {
    if (entry.name === '..') {
      // Navigate to parent: replace this column and remove any to the right
      const parentPath = columns[colIndex].path.replace(/\/[^/]+$/, '') || '/'
      browse(parentPath, colIndex)
      return
    }
    const fullPath = `${columns[colIndex].path}/${entry.name}`

    if (entry.type === 'directory') {
      // Mark selected in this column, browse into it as next column
      setColumns(cols => {
        const updated = cols.slice(0, colIndex + 1)
        updated[colIndex] = { ...updated[colIndex], selected: entry.name }
        return updated
      })
      browse(fullPath, colIndex + 1)
    } else {
      if (multiSelect) {
        // Toggle file in multi-select set
        if (colIndex !== multiSelectCol) {
          // Switched columns — reset selection to just this file
          setMultiSelectCol(colIndex)
          setMultiSelected(new Set([fullPath]))
        } else {
          setMultiSelected(prev => {
            const next = new Set(prev)
            if (next.has(fullPath)) next.delete(fullPath)
            else next.add(fullPath)
            return next
          })
        }
      }
      // File: select it if in file mode
      if (mode !== 'directory') {
        setColumns(cols => {
          const updated = cols.slice(0, colIndex + 1)
          updated[colIndex] = { ...updated[colIndex], selected: entry.name }
          return updated
        })
      }
    }
  }

  const handleDoubleClick = (colIndex, entry) => {
    if (entry.name === '..') {
      handleClick(colIndex, entry)
      return
    }
    const fullPath = `${columns[colIndex].path}/${entry.name}`
    if (mode === 'directory' && entry.type === 'directory') {
      onSelect(fullPath)
      onClose()
    } else if (mode !== 'directory' && entry.type === 'file' && !multiSelect) {
      onSelect(fullPath)
      onClose()
    }
  }

  // Determine what's currently selected for the confirm button
  const lastCol = columns[columns.length - 1]
  const selectedEntry = lastCol?.selected
    ? lastCol.entries.find(e => e.name === lastCol.selected)
    : null
  const selectedPath = lastCol && lastCol.selected
    ? `${lastCol.path}/${lastCol.selected}`
    : null

  const canConfirm = multiSelect
    ? multiSelected.size > 0
    : mode === 'directory'
      ? selectedEntry?.type === 'directory' || columns.length > 0
      : selectedEntry?.type === 'file'

  const handleConfirm = () => {
    if (multiSelect) {
      const sorted = [...multiSelected].sort()
      onSelect(sorted)
      setMultiSelected(new Set())
      setMultiSelectCol(-1)
    } else if (mode === 'directory') {
      // If a dir is selected, use it; otherwise use the deepest browsed path
      if (selectedEntry?.type === 'directory') {
        onSelect(selectedPath)
      } else if (lastCol) {
        onSelect(lastCol.path)
      }
    } else if (selectedEntry?.type === 'file') {
      onSelect(selectedPath)
    }
    onClose()
  }

  // Select all files in the deepest column
  const handleSelectAll = () => {
    if (!lastCol) return
    const ci = columns.length - 1
    const allFiles = lastCol.entries
      .filter(e => e.type === 'file')
      .map(e => `${lastCol.path}/${e.name}`)
    setMultiSelectCol(ci)
    setMultiSelected(prev => {
      // If all are already selected, deselect all
      const allSelected = allFiles.every(f => prev.has(f))
      if (allSelected) return new Set()
      return new Set(allFiles)
    })
  }

  // Display path — show the absolute path for the deepest column
  const deepestPath = lastCol?.path || root
  const [pathInput, setPathInput] = useState('')
  const [editingPath, setEditingPath] = useState(false)

  // Sync pathInput when deepestPath changes
  useEffect(() => {
    if (!editingPath) setPathInput(deepestPath)
  }, [deepestPath, editingPath])

  const handlePathSubmit = (e) => {
    e.preventDefault()
    const trimmed = pathInput.trim()
    if (trimmed) {
      browse(trimmed, 0)
    }
    setEditingPath(false)
  }

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.dialog} onClick={e => e.stopPropagation()}>
        {/* Title bar */}
        <div style={S.titleBar}>
          <span style={S.title}>
            {mode === 'directory' ? 'Select Directory' : multiSelect ? 'Select Files' : 'Select File'}
          </span>
          <form onSubmit={handlePathSubmit} style={{ flex: 1, display: 'flex' }}>
            <input
              type="text"
              value={pathInput}
              onInput={e => { setPathInput(e.target.value); setEditingPath(true) }}
              onBlur={() => { setEditingPath(false); setPathInput(deepestPath) }}
              onKeyDown={e => { if (e.key === 'Escape') { setEditingPath(false); setPathInput(deepestPath); e.target.blur() } }}
              style={S.pathInput}
              spellcheck={false}
            />
          </form>
          <button style={S.closeBtn} onClick={onClose}>&times;</button>
        </div>

        {error && <div style={S.error}>{error}</div>}

        {/* Column view */}
        <div style={S.columnsOuter} ref={scrollRef}>
          {columns.map((col, ci) => (
            <div key={ci} style={S.column}>
              {col.entries.length === 0 && (
                <div style={S.empty}>Empty</div>
              )}
              {col.entries.map(entry => {
                const fullEntryPath = `${col.path}/${entry.name}`
                const isSelected = col.selected === entry.name
                const isMultiSelected = multiSelect && ci === multiSelectCol && multiSelected.has(fullEntryPath)
                const isHighlighted = isSelected || isMultiSelected
                const isDir = entry.type === 'directory'
                return (
                  <div
                    key={entry.name}
                    style={{
                      ...S.row,
                      background: isHighlighted ? 'var(--accent)' : undefined,
                      color: isHighlighted ? '#fff' : undefined,
                    }}
                    onClick={() => handleClick(ci, entry)}
                    onDblClick={() => handleDoubleClick(ci, entry)}
                    onMouseEnter={e => { if (!isHighlighted) e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { if (!isHighlighted) e.currentTarget.style.background = 'transparent' }}
                  >
                    <span style={{ ...S.name, fontWeight: isDir ? 500 : 400 }}>
                      {entry.name}
                    </span>
                    {isDir ? (
                      <span style={{ ...S.chevron, color: isSelected ? '#fff' : undefined }}>&#9656;</span>
                    ) : (
                      <span style={{ ...S.size, color: isSelected ? 'rgba(255,255,255,0.7)' : undefined }}>
                        {formatSize(entry.size)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={S.footer}>
          {multiSelect && (
            <>
              <button class="btn-secondary" onClick={handleSelectAll}>
                Select All
              </button>
              {multiSelected.size > 0 && (
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {multiSelected.size} file{multiSelected.size !== 1 ? 's' : ''} selected
                </span>
              )}
            </>
          )}
          <div style={{ flex: 1 }} />
          <button class="btn-secondary" onClick={onClose}>Cancel</button>
          <button class="btn-primary" onClick={handleConfirm} disabled={!canConfirm}>
            {multiSelect && multiSelected.size > 0
              ? `Add ${multiSelected.size} File${multiSelected.size !== 1 ? 's' : ''}`
              : 'Select'}
          </button>
        </div>
      </div>
    </div>
  )
}

const S = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.25)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    width: '80vw',
    maxWidth: '80vw',
    minHeight: '50vh',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
  },
  titleBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 16px',
    borderBottom: '1px solid var(--border)',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--text-primary)',
    flexShrink: 0,
  },
  pathInput: {
    flex: 1,
    fontSize: '12px',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
    color: 'var(--text-primary)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '3px 8px',
    outline: 'none',
    width: '100%',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
    flexShrink: 0,
  },
  error: {
    padding: '8px 16px',
    fontSize: '12px',
    color: 'var(--error)',
  },
  columnsOuter: {
    display: 'flex',
    flex: 1,
    overflowX: 'auto',
    overflowY: 'hidden',
    minHeight: 0,
  },
  column: {
    minWidth: '260px',
    maxWidth: '340px',
    flex: '0 0 auto',
    overflowY: 'auto',
    borderRight: '1px solid var(--border)',
  },
  empty: {
    padding: '20px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '12px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '5px 10px',
    cursor: 'pointer',
    transition: 'background 0.06s',
  },
  name: {
    flex: 1,
    fontSize: '12px',
    color: 'inherit',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chevron: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  size: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  footer: {
    padding: '10px 16px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
}
