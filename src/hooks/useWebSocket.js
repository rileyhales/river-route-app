import { useState, useEffect, useRef, useCallback } from 'preact/hooks'

function getWsUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}

export function useWebSocket() {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)
  const listenersRef = useRef({})
  const reconnectTimer = useRef(null)

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return

    const ws = new WebSocket(getWsUrl())

    ws.onopen = () => {
      setConnected(true)
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      // Auto reconnect after 2 seconds
      reconnectTimer.current = setTimeout(connect, 2000)
    }

    ws.onerror = () => {
      ws.close()
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        const type = data.type
        const callbacks = listenersRef.current[type]
        if (callbacks) {
          callbacks.forEach(cb => cb(data))
        }
        // Also fire a wildcard listener
        const wildcards = listenersRef.current['*']
        if (wildcards) {
          wildcards.forEach(cb => cb(data))
        }
      } catch (e) {
        console.error('WS message parse error:', e)
      }
    }

    wsRef.current = ws
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      if (wsRef.current) wsRef.current.close()
    }
  }, [connect])

  const send = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  const on = useCallback((type, callback) => {
    if (!listenersRef.current[type]) {
      listenersRef.current[type] = []
    }
    listenersRef.current[type].push(callback)
    // Return unsubscribe function
    return () => {
      listenersRef.current[type] = listenersRef.current[type].filter(cb => cb !== callback)
    }
  }, [])

  const off = useCallback((type, callback) => {
    if (listenersRef.current[type]) {
      listenersRef.current[type] = listenersRef.current[type].filter(cb => cb !== callback)
    }
  }, [])

  return { connected, send, on, off }
}
