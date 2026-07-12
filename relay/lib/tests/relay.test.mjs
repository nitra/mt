import { beforeEach, describe, expect, test } from 'vitest'

import { RelayCore } from '../relay.mjs'
import { Rooms } from '../rooms.mjs'
import { InMemoryStore, roleAtLeast } from '../store.mjs'

const RE_NOT_MEMBER = /не учасник/
const RE_VIEWER = /viewer/
const RE_OWNER_ONLY = /owner/
const RE_FOREIGN_ACCOUNT = /іншому акаунту/
const RE_ALREADY_PROCESSED = /оброблене/

/** @type {InMemoryStore} */
let store
/** @type {RelayCore} */
let core
/** @type {Record<string, object>} акаунти фікстури */
let accounts
/** @type {Record<string, object>} пристрої фікстури (повні записи) */
let devices

/**
 * Реєструє пристрій і повертає повний запис (для викликів ядра).
 * @param {string} accountId акаунт-власник
 * @param {string} name імʼя пристрою
 * @returns {object} запис пристрою
 */
function device(accountId, name) {
  const { device_token } = store.registerDevice(accountId, {
    name,
    role: 'client',
    pubkey: `pk-${name}`
  })
  return store.deviceByToken(device_token)
}

/**
 * Підписка з накопиченням кадрів у масив.
 * @param {object[]} inbox приймач кадрів
 * @returns {(frame: object) => void} колбек доставки
 */
function collectInto(inbox) {
  return frame => {
    inbox.push(frame)
  }
}

beforeEach(() => {
  store = new InMemoryStore()
  core = new RelayCore({ store })
  accounts = {
    owner: store.createAccount({ email: 'owner@x' }),
    approver: store.createAccount({ email: 'approver@x' }),
    viewer: store.createAccount({ email: 'viewer@x' }),
    outsider: store.createAccount({ email: 'outsider@x' })
  }
  store.createTask('root-1', accounts.owner.account_id)
  store.setMemberRole('root-1', accounts.approver.account_id, 'approver')
  store.setMemberRole('root-1', accounts.viewer.account_id, 'viewer')
  store.createTask('root-2', accounts.outsider.account_id)
  devices = {
    owner: device(accounts.owner.account_id, 'mac-owner'),
    approver: device(accounts.approver.account_id, 'phone-approver'),
    viewer: device(accounts.viewer.account_id, 'tab-viewer'),
    outsider: device(accounts.outsider.account_id, 'pc-outsider')
  }
})

describe('membership-роутінг кімнат', () => {
  test('підписка лише учасникам кореня; конверт доходить лише у свою кімнату', () => {
    const inbox1 = []
    const inbox2 = []
    core.subscribe(devices.viewer, 'root-1', collectInto(inbox1))
    core.subscribe(devices.outsider, 'root-2', collectInto(inbox2))

    core.clientEnvelope(devices.owner, 'root-1', { seq: 0, node_hash: 'root-1' })

    expect(inbox1).toHaveLength(1)
    expect(inbox2).toHaveLength(0)
    expect(() => core.subscribe(devices.outsider, 'root-1', collectInto([]))).toThrow(RE_NOT_MEMBER)
  })

  test('viewer не шле клієнтські події; approver шле (ApprovalResponse)', () => {
    expect(() => core.clientEnvelope(devices.viewer, 'root-1', { seq: 0 })).toThrow(RE_VIEWER)
    expect(() => core.clientEnvelope(devices.approver, 'root-1', { seq: 0 })).not.toThrow()
    expect(() => core.clientEnvelope(devices.outsider, 'root-1', { seq: 0 })).toThrow(RE_NOT_MEMBER)
  })
})

describe('membership API', () => {
  test('invite (лише owner) → accept → запис у members + broadcast MemberChanged', () => {
    const inbox = []
    core.subscribe(devices.owner, 'root-1', collectInto(inbox))
    const invited = store.createAccount({ email: 'new@x' })

    expect(() => core.invite(accounts.viewer.account_id, 'root-1', { email: 'new@x', role: 'host' })).toThrow(
      RE_OWNER_ONLY
    )

    const invitation = core.invite(accounts.owner.account_id, 'root-1', {
      email: 'new@x',
      role: 'host'
    })
    // Чужий акаунт не може прийняти.
    expect(() => core.accept(invitation.invitation_id, accounts.viewer.account_id)).toThrow(RE_FOREIGN_ACCOUNT)
    const membership = core.accept(invitation.invitation_id, invited.account_id)

    expect(membership).toEqual({ root_node_hash: 'root-1', role: 'host' })
    expect(store.memberRole('root-1', invited.account_id)).toBe('host')
    expect(inbox.at(-1)).toEqual({
      kind: 'event',
      event: { type: 'MemberChanged', account_id: invited.account_id, role: 'host' }
    })
    // Повторний accept — відмова (не pending).
    expect(() => core.accept(invitation.invitation_id, invited.account_id)).toThrow(RE_ALREADY_PROCESSED)
  })

  test('transfer ownership: новий owner, попередній стає host', () => {
    core.transferOwnership('root-1', accounts.owner.account_id, accounts.approver.account_id)
    expect(store.memberRole('root-1', accounts.approver.account_id)).toBe('owner')
    expect(store.memberRole('root-1', accounts.owner.account_id)).toBe('host')
    // Колишній owner більше не передає.
    expect(() => core.transferOwnership('root-1', accounts.owner.account_id, accounts.viewer.account_id)).toThrow(
      RE_OWNER_ONLY
    )
  })
})

describe('буфер кімнати', () => {
  test('обрізається до ліміту; підписка реплеїть хвіст', () => {
    const rooms = new Rooms(3)
    const smallCore = new RelayCore({ store, rooms })
    for (let i = 0; i < 5; i++) {
      smallCore.clientEnvelope(devices.owner, 'root-1', { seq: i })
    }
    const inbox = []
    smallCore.subscribe(devices.owner, 'root-1', collectInto(inbox))
    expect(inbox.map(f => f.envelope.seq)).toEqual([2, 3, 4])
  })
})

describe('from_host', () => {
  test('ставиться relay-єм за роллю пристрою, не з кадру клієнта', () => {
    const hostDevice = store.deviceByToken(
      store.registerDevice(accounts.owner.account_id, {
        name: 'host-mac',
        role: 'host',
        pubkey: 'pk-host'
      }).device_token
    )
    const inbox = []
    core.subscribe(devices.viewer, 'root-1', collectInto(inbox))

    core.clientEnvelope(hostDevice, 'root-1', { seq: 1 })
    core.clientEnvelope(devices.approver, 'root-1', { seq: 0 })

    expect(inbox.map(f => f.from_host)).toEqual([true, false])
  })
})

describe('pubkeys', () => {
  test('лише пристрої approver+; доступ лише учасникам', () => {
    const pubkeys = core.pubkeys(devices.viewer, 'root-1')
    expect(pubkeys.map(k => k.pubkey).toSorted()).toEqual(['pk-mac-owner', 'pk-phone-approver'])
    expect(() => core.pubkeys(devices.outsider, 'root-1')).toThrow(RE_NOT_MEMBER)
  })
})

describe('roleAtLeast', () => {
  test('ієрархія owner ⊃ host ⊃ approver ⊃ viewer', () => {
    expect(roleAtLeast('owner', 'viewer')).toBe(true)
    expect(roleAtLeast('viewer', 'approver')).toBe(false)
    expect(roleAtLeast(null, 'viewer')).toBe(false)
  })
})
