import { useState, useContext } from 'preact/hooks'
import { ConfigContext } from '../app.jsx'
import { VALID_KEYS } from './RouterForm.jsx'

/**
 * Generate Python code string from the current config state.
 * Follows the docs style: import river_route as rr, chained parenthetical call.
 */
/**
 * Resolve discharge_dir into discharge_files, mirroring Configs._resolve_discharge_dir().
 *
 * - If discharge_dir is set and discharge_files is not:
 *   - If there are lateral input files: discharge_<basename(input)> for each
 *   - Otherwise (Muskingum): discharge.nc
 * - Returns a new config object with discharge_files populated and discharge_dir removed.
 */
export function resolveDischargeDir(config) {
  const dir = config.discharge_dir
  const files = config.discharge_files
  if (!dir || (files && files.length > 0)) return config

  const inputFiles = (config.catchment_runoff_files && config.catchment_runoff_files.length > 0)
    ? config.catchment_runoff_files
    : (config.runoff_grid_files && config.runoff_grid_files.length > 0)
      ? config.runoff_grid_files
      : []

  let resolved
  if (inputFiles.length > 0) {
    resolved = inputFiles.map(f => {
      const basename = f.split('/').pop()
      return dir.replace(/\/+$/, '') + '/discharge_' + basename
    })
  } else {
    resolved = [dir.replace(/\/+$/, '') + '/discharge.nc']
  }

  const out = { ...config, discharge_files: resolved }
  delete out.discharge_dir
  return out
}

function generateCode(config) {
  const router = config._router || 'Muskingum'

  // Resolve discharge_dir → discharge_files (same logic as Python Configs)
  const resolved = resolveDischargeDir(config)

  // Fields to include as constructor kwargs — skip empty/default values
  const SKIP = new Set(['_router'])
  const DEFAULT_STRINGS = new Set(['1970-01-01', ''])
  const DEFAULT_VARS = {
    var_river_id: 'river_id',
    var_discharge: 'Q',
    var_x: 'x',
    var_y: 'y',
    var_t: 'time',
    var_catchment_runoff_variable: 'runoff',
    var_runoff_depth: 'ro',
    log_level: 'INFO',
    runoff_processing_mode: 'sequential',
    runoff_accumulation_type: 'incremental',
  }

  const allowed = VALID_KEYS[router] || VALID_KEYS.Muskingum

  const args = []
  for (const [key, val] of Object.entries(resolved)) {
    if (SKIP.has(key)) continue
    if (!allowed.has(key)) continue
    if (val === null || val === undefined || val === '') continue
    if (Array.isArray(val) && val.length === 0) continue
    if (DEFAULT_VARS[key] !== undefined && val === DEFAULT_VARS[key]) continue
    if (typeof val === 'string' && DEFAULT_STRINGS.has(val)) continue

    args.push([key, val])
  }

  const lines = ['import river_route as rr', '']

  if (args.length === 0) {
    // Simple no-args call
    lines.push('(')
    lines.push('    rr')
    lines.push(`    .${router}()`)
    lines.push('    .route()')
    lines.push(')')
  } else {
    lines.push('(')
    lines.push('    rr')
    lines.push(`    .${router}(`)
    for (const [key, val] of args) {
      if (Array.isArray(val)) {
        if (val.length === 1) {
          lines.push(`        ${key}=[${formatValue(val[0])}],`)
        } else {
          lines.push(`        ${key}=[`)
          for (const v of val) {
            lines.push(`            ${formatValue(v)},`)
          }
          lines.push('        ],')
        }
      } else {
        lines.push(`        ${key}=${formatValue(val)},`)
      }
    }
    lines.push('    )')
    lines.push('    .route()')
    lines.push(')')
  }

  return lines.join('\n')
}

function formatValue(val) {
  if (typeof val === 'string') return `'${val.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  if (typeof val === 'boolean') return val ? 'True' : 'False'
  return String(val)
}

function generateJSON(config) {
  const resolved = resolveDischargeDir(config)
  const cleaned = {}
  for (const [key, val] of Object.entries(resolved)) {
    if (val === null || val === undefined || val === '') continue
    if (Array.isArray(val) && val.length === 0) continue
    cleaned[key] = val
  }
  return JSON.stringify(cleaned, null, 2)
}

/**
 * Tokenize a Python code string into spans for syntax highlighting.
 */
function highlightLine(line) {
  const parts = []
  let remaining = line

  // Regex patterns for tokens
  const patterns = [
    { type: 'comment', re: /^(#.*)/ },
    { type: 'keyword', re: /^(import|as|from|True|False|None)\b/ },
    { type: 'string', re: /^('[^']*'|"[^"]*")/ },
    { type: 'number', re: /^(\d+(?:\.\d+)?)/ },
    { type: 'paren', re: /^([\[\]\(\)])/ },
    { type: 'punct', re: /^([,=])/ },
    { type: 'method', re: /^(\.\w+)/ },
    { type: 'class', re: /^([A-Z]\w*)/ },
    { type: 'ident', re: /^(\w+)/ },
    { type: 'space', re: /^(\s+)/ },
  ]

  let safety = 0
  while (remaining.length > 0 && safety++ < 500) {
    let matched = false
    for (const { type, re } of patterns) {
      const m = remaining.match(re)
      if (m) {
        const text = m[1]
        parts.push({ type, text })
        remaining = remaining.slice(text.length)
        matched = true
        break
      }
    }
    if (!matched) {
      parts.push({ type: 'plain', text: remaining[0] })
      remaining = remaining.slice(1)
    }
  }

  return parts
}

function highlightJSON(line) {
  const parts = []
  let remaining = line
  const patterns = [
    { type: 'string', re: /^("[^"]*")/ },
    { type: 'number', re: /^(-?\d+(?:\.\d+)?)/ },
    { type: 'keyword', re: /^(true|false|null)\b/ },
    { type: 'paren', re: /^([\[\]{}])/ },
    { type: 'punct', re: /^([,:])/ },
    { type: 'space', re: /^(\s+)/ },
  ]
  let safety = 0
  while (remaining.length > 0 && safety++ < 500) {
    let matched = false
    for (const { type, re } of patterns) {
      const m = remaining.match(re)
      if (m) {
        const text = m[1]
        // Distinguish JSON keys (strings followed by colon) from string values
        if (type === 'string' && remaining.slice(text.length).trimStart().startsWith(':')) {
          parts.push({ type: 'key', text })
        } else {
          parts.push({ type, text })
        }
        remaining = remaining.slice(text.length)
        matched = true
        break
      }
    }
    if (!matched) {
      parts.push({ type: 'plain', text: remaining[0] })
      remaining = remaining.slice(1)
    }
  }
  return parts
}

const JSON_TOKEN_COLORS = {
  key: '#93c5fd',
  string: 'var(--code-string)',
  number: 'var(--code-number)',
  keyword: 'var(--code-keyword)',
  paren: '#94a3b8',
  punct: '#94a3b8',
  space: undefined,
  plain: 'var(--code-text)',
}

const TOKEN_COLORS = {
  keyword: 'var(--code-keyword)',
  string: 'var(--code-string)',
  comment: 'var(--code-comment)',
  number: 'var(--code-number)',
  class: '#fde68a',
  method: '#93c5fd',
  paren: '#94a3b8',
  punct: '#94a3b8',
  ident: 'var(--code-text)',
  space: undefined,
  plain: 'var(--code-text)',
}

export function CodePreview() {
  const { config } = useContext(ConfigContext)
  const [view, setView] = useState('python')
  const [copied, setCopied] = useState(false)

  const code = generateCode(config)
  const json = generateJSON(config)
  const content = view === 'python' ? code : json
  const lines = content.split('\n')
  const highlighter = view === 'python' ? highlightLine : highlightJSON
  const colors = view === 'python' ? TOKEN_COLORS : JSON_TOKEN_COLORS

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(view === 'python' ? styles.tabActive : {}) }}
            onClick={() => setView('python')}
          >
            Python
          </button>
          <button
            style={{ ...styles.tab, ...(view === 'json' ? styles.tabActive : {}) }}
            onClick={() => setView('json')}
          >
            JSON
          </button>
        </div>
        <button
          style={{ ...styles.copyBtn, ...(copied ? styles.copyBtnSuccess : {}) }}
          onClick={handleCopy}
          title="Copy to clipboard"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre style={styles.code}>
        {lines.map((line, i) => (
          <div key={i} style={styles.line}>
            <span style={styles.lineNum}>{i + 1}</span>
            <span>
              {highlighter(line).map((tok, j) => (
                <span key={j} style={{ color: colors[tok.type] }}>{tok.text}</span>
              ))}
            </span>
          </div>
        ))}
      </pre>
    </div>
  )
}

const styles = {
  container: {
    background: 'var(--code-bg)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 16px',
    borderBottom: '1px solid #334155',
  },
  tabs: {
    display: 'flex',
    gap: '2px',
  },
  tab: {
    background: 'transparent',
    color: '#64748b',
    border: 'none',
    borderRadius: '4px',
    padding: '6px 14px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  tabActive: {
    background: '#334155',
    color: '#e2e8f0',
  },
  copyBtn: {
    background: '#334155',
    color: '#cbd5e1',
    border: 'none',
    borderRadius: '4px',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.15s',
    minWidth: '64px',
  },
  copyBtnSuccess: {
    background: '#059669',
    color: '#fff',
  },
  code: {
    flex: '1',
    overflow: 'auto',
    padding: '12px 0',
    margin: '0',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
    fontSize: '13px',
    lineHeight: '1.6',
    color: 'var(--code-text)',
    cursor: 'text',
    userSelect: 'text',
    WebkitUserSelect: 'text',
  },
  line: {
    display: 'flex',
    padding: '0 16px',
  },
  lineNum: {
    color: '#475569',
    minWidth: '28px',
    textAlign: 'right',
    marginRight: '16px',
    userSelect: 'none',
    fontSize: '12px',
  },
}
