import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks'

let _reqCounter = 0

function getWsUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}

export function useWebSocket() {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef(null)
  const listenersRef = useRef({})
  const reconnectTimer = useRef(null)
  const reconnectAttempts = useRef(0)

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return

    const ws = new WebSocket(getWsUrl())

    ws.onopen = () => {
      setConnected(true)
      reconnectAttempts.current = 0
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      // Exponential backoff reconnect, capped at 10s
      reconnectAttempts.current += 1
      const wait = Math.min(10000, 1000 * (2 ** Math.min(reconnectAttempts.current - 1, 4)))
      reconnectTimer.current = setTimeout(connect, wait)
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

  /** Send a message. Returns true if sent, false if not connected. */
  const send = useCallback((data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
      return true
    }
    return false
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

  /**
   * Send a request and listen for a correlated response.
   * Attaches a unique _reqId to the message and only fires the callback
   * when a response with the matching _reqId arrives.
   *
   * @param {object} data - message to send (type + payload)
   * @param {string} responseType - the message type to listen for
   * @param {function} callback - called with the response data
   * @param {object} [options] - { timeout: ms, onError: fn }
   * @returns {function} cleanup/unsubscribe function
   */
  const request = useCallback((data, responseType, callback, options = {}) => {
    const reqId = `req_${++_reqCounter}_${Date.now()}`
    const { timeout = 15000, onError } = options

    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      unsubResponse()
      unsubError()
      clearTimeout(timer)
    }

    const unsubResponse = on(responseType, (resp) => {
      if (resp._reqId !== reqId) return
      cleanup()
      callback(resp)
    })

    const unsubError = on('error', (resp) => {
      if (resp._reqId !== reqId) return
      cleanup()
      if (onError) onError(resp)
      else callback(resp)
    })

    const timer = setTimeout(() => {
      cleanup()
      const err = { type: 'error', error: 'Request timed out' }
      if (onError) onError(err)
      else callback(err)
    }, timeout)

    const sent = send({ ...data, _reqId: reqId })
    if (!sent) {
      cleanup()
      const err = { type: 'error', error: 'Not connected to server' }
      if (onError) onError(err)
      else callback(err)
    }

    return cleanup
  }, [send, on])

  return useMemo(() => ({ connected, send, on, off, request }), [connected, send, on, off, request])
}
