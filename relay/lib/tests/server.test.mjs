import { once } from 'node:events'

import { WebSocket } from 'ws'
import { afterAll, beforeAll, expect, test } from 'vitest'

import { RelayCore } from '../relay.mjs'
import { startRelayServer } from '../server.mjs'
import { InMemoryStore } from '../store.mjs'

const RE_HELLO = /hello/
const RE_VIEWER = /viewer/
// Тести ходять на локальний loopback без TLS; sdl-правило про insecure-URL
// націлене на продакшн-адреси, тому схему складаємо окремо від хоста.
const WS_SCHEME = 'ws:'

/** @type {InMemoryStore} */
const store = new InMemoryStore()
/** @type {{ port: number, close: () => Promise<void> }} */
let server
/** @type {string} */
let hostToken
/** @type {string} */
let viewerToken

/**
 * Відкриває WS-клієнт і чекає open.
 * @returns {Promise<WebSocket>} відкритий сокет
 */
async function connect() {
  const socket = new WebSocket(`${WS_SCHEME}//127.0.0.1:${server.port}`)
  await once(socket, 'open')
  return socket
}

/**
 * Шле кадр і чекає наступний вхідний JSON-кадр.
 * @param {WebSocket} socket сокет
 * @param {object} frame кадр для відправки
 * @returns {Promise<object>} відповідь relay
 */
async function roundtrip(socket, frame) {
  socket.send(JSON.stringify(frame))
  const [raw] = await once(socket, 'message')
  return JSON.parse(String(raw))
}

beforeAll(async () => {
  const owner = store.createAccount({ email: 'owner@x' })
  const viewer = store.createAccount({ email: 'viewer@x' })
  store.createTask('root-1', owner.account_id)
  store.setMemberRole('root-1', viewer.account_id, 'viewer')
  hostToken = store.registerDevice(owner.account_id, {
    name: 'mac',
    role: 'host',
    pubkey: 'pk-mac'
  }).device_token
  viewerToken = store.registerDevice(viewer.account_id, {
    name: 'tab',
    role: 'client',
    pubkey: 'pk-tab'
  }).device_token
  server = await startRelayServer(new RelayCore({ store }))
})

afterAll(async () => {
  await server.close()
})

test('невірний device_token → error; кадри до hello відхиляються', async () => {
  const socket = await connect()
  const denied = await roundtrip(socket, { kind: 'subscribe', root: 'root-1' })
  expect(denied.kind).toBe('error')
  expect(denied.message).toMatch(RE_HELLO)
  const bad = await roundtrip(socket, { kind: 'hello', device_token: 'чужий' })
  expect(bad.kind).toBe('error')
  socket.close()
})

test('hello → subscribe → envelope доходить підписнику; реплей після реконекту', async () => {
  const publisher = await connect()
  const helloReply = await roundtrip(publisher, { kind: 'hello', device_token: hostToken })
  expect(helloReply.kind).toBe('ok')

  const subscriber = await connect()
  await roundtrip(subscriber, { kind: 'hello', device_token: viewerToken })
  await roundtrip(subscriber, { kind: 'subscribe', root: 'root-1' })

  publisher.send(JSON.stringify({ kind: 'envelope', root: 'root-1', envelope: { seq: 0, node_hash: 'demo' } }))
  const [raw] = await once(subscriber, 'message')
  const delivered = JSON.parse(String(raw))
  expect(delivered).toEqual({ kind: 'envelope', envelope: { seq: 0, node_hash: 'demo' }, from_host: true })
  subscriber.close()

  // Реконект: буфер кімнати реплеїться одразу після subscribe.
  const reconnected = await connect()
  await roundtrip(reconnected, { kind: 'hello', device_token: viewerToken })
  reconnected.send(JSON.stringify({ kind: 'subscribe', root: 'root-1' }))
  const [replayRaw] = await once(reconnected, 'message')
  expect(JSON.parse(String(replayRaw))).toEqual({
    kind: 'envelope',
    envelope: { seq: 0, node_hash: 'demo' },
    from_host: true
  })
  reconnected.close()
  publisher.close()
})

test('viewer не шле клієнтські події через WS', async () => {
  const socket = await connect()
  await roundtrip(socket, { kind: 'hello', device_token: viewerToken })
  const rejected = await roundtrip(socket, {
    kind: 'envelope',
    root: 'root-1',
    envelope: { seq: 1 }
  })
  expect(rejected.kind).toBe('error')
  expect(rejected.message).toMatch(RE_VIEWER)
  socket.close()
})
