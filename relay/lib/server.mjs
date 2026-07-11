/**
 * WS-транспорт relay: hello за device_token → subscribe/envelope-кадри.
 *
 * Кадри — JSON: клієнт → `{kind:"hello", device_token}` (перший),
 * `{kind:"subscribe", root}`, `{kind:"envelope", root, envelope}`;
 * relay → `{kind:"ok"|"error", ...}`, `{kind:"envelope"|"event", ...}`.
 * Ліміт кадру — 2 МБ (stack.md). Помилки авторизації/ролей — `error`-кадр,
 * зʼєднання не рветься (клієнт може виправитись).
 */
import { once } from 'node:events'
import { promisify } from 'node:util'

import { WebSocketServer } from 'ws'

/** Ліміт WS-кадру (stack.md: «кадр ≤ 2 MB»). */
export const FRAME_LIMIT = 2 * 1024 * 1024

/**
 * Обробляє один JSON-кадр клієнта.
 * @param {import('./relay.mjs').RelayCore} core ядро relay
 * @param {{ device: object | null, subscriptions: Map<string, () => void> }} state стан зʼєднання
 * @param {object} frame розібраний кадр
 * @param {(frame: object) => void} send доставка кадрів клієнту
 * @returns {void}
 */
function handleFrame(core, state, frame, send) {
  if (frame.kind === 'hello') {
    state.device = core.connectDevice(frame.device_token)
    send({ kind: 'ok', device_id: state.device.device_id })
    return
  }
  if (!state.device) throw new Error('спершу hello з device_token')
  if (frame.kind === 'subscribe') {
    state.subscriptions.get(frame.root)?.()
    state.subscriptions.set(frame.root, core.subscribe(state.device, frame.root, send))
    send({ kind: 'ok', subscribed: frame.root })
  } else if (frame.kind === 'envelope') {
    core.clientEnvelope(state.device, frame.root, frame.envelope)
  }
  // Невідомі kind ігноруються (forward-compatibility).
}

/**
 * Обробляє WS-зʼєднання: авторизація hello → кадри → cleanup підписок.
 * @param {import('./relay.mjs').RelayCore} core ядро relay
 * @param {import('ws').WebSocket} socket зʼєднання
 * @returns {void}
 */
function handleConnection(core, socket) {
  /** @type {{ device: object | null, subscriptions: Map<string, () => void> }} */
  const state = { device: null, subscriptions: new Map() }

  /**
   * Надсилає JSON-кадр клієнту.
   * @param {object} frame кадр
   * @returns {void}
   */
  const send = frame => socket.send(JSON.stringify(frame))

  socket.on('message', raw => {
    let frame
    try {
      frame = JSON.parse(String(raw))
    } catch {
      send({ kind: 'error', message: 'невалідний JSON-кадр' })
      return
    }
    try {
      handleFrame(core, state, frame, send)
    } catch (error) {
      send({ kind: 'error', message: String(error?.message ?? error) })
    }
  })

  socket.on('close', () => {
    for (const unsubscribe of state.subscriptions.values()) unsubscribe()
    state.subscriptions.clear()
  })
}

/**
 * Стартує WS-сервер relay поверх ядра.
 * @param {import('./relay.mjs').RelayCore} core ядро relay
 * @param {{ port?: number }} [options] порт (0 — ефемерний)
 * @returns {Promise<{ port: number, close: () => Promise<void> }>} адреса і зупинка
 */
export async function startRelayServer(core, options = {}) {
  const server = new WebSocketServer({
    port: options.port ?? 0,
    maxPayload: FRAME_LIMIT
  })
  server.on('connection', socket => handleConnection(core, socket))
  await once(server, 'listening')
  const address = /** @type {{port: number}} */ (server.address())
  return { port: address.port, close: promisify(server.close.bind(server)) }
}
