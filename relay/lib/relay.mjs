/**
 * Ядро relay (M2, mission control): membership-гейти кімнат, ролі,
 * запрошення, transfer ownership, роздача pubkey-ів (access.md).
 *
 * Межі (access.md): relay координує і пересилає — НЕ зберігає журнали
 * сесій, НЕ проксіює git, НЕ видає lease (істина — git claim), НЕ виконує
 * агентів. Транспортний шар (WS) — server.mjs; тут — чиста логіка.
 */
import { Rooms } from './rooms.mjs'
import { roleAtLeast } from './store.mjs'

/** Ядро relay поверх store + rooms. */
export class RelayCore {
  /**
   * @param {{ store: import('./store.mjs').InMemoryStore, rooms?: Rooms }} deps залежності
   */
  constructor({ store, rooms = new Rooms() }) {
    this.store = store
    this.rooms = rooms
  }

  /**
   * Авторизує WS-підключення за device_token.
   * @param {string} deviceToken токен пристрою
   * @returns {object} запис пристрою
   * @throws {Error} невідомий токен
   */
  connectDevice(deviceToken) {
    const device = this.store.deviceByToken(deviceToken)
    if (!device) throw new Error('invalid device token')
    device.last_seen = new Date().toISOString()
    return device
  }

  /**
   * Підписка на кімнату задачі: дозволена лише пристроям акаунтів-учасників
   * кореня (access.md, «Membership прив'язане до кореневого вузла»).
   * @param {object} device запис пристрою
   * @param {string} root кореневий вузол задачі
   * @param {(frame: object) => void} send доставка кадрів пристрою
   * @returns {() => void} відписка
   * @throws {Error} не учасник
   */
  subscribe(device, root, send) {
    const role = this.store.memberRole(root, device.account_id)
    if (!role) throw new Error(`subscribe відхилено: акаунт не учасник задачі ${root}`)
    return this.rooms.subscribe(root, { deviceId: device.device_id, send })
  }

  /**
   * Клієнтський Envelope у кімнату. Viewer НЕ шле клієнтські події
   * (access.md: «relay відхиляє клієнтські події viewer-а, включно з
   * CancelTurn»); host+ і approver шлють (approver — ApprovalResponse).
   * @param {object} device запис пристрою
   * @param {string} root кореневий вузол задачі
   * @param {object} envelope конверт (opaque — далі роутінгових полів не парситься)
   * @returns {void}
   * @throws {Error} viewer або не учасник
   */
  clientEnvelope(device, root, envelope) {
    const role = this.store.memberRole(root, device.account_id)
    if (!role) throw new Error(`envelope відхилено: акаунт не учасник задачі ${root}`)
    if (!roleAtLeast(role, 'approver')) {
      throw new Error('envelope відхилено: роль viewer не шле клієнтські події')
    }
    this.rooms.publish(root, { kind: 'envelope', envelope })
  }

  /**
   * Запрошення учасника (лише owner). Push отримувачу — окремий модуль
   * (заглушка до FCM-задачі).
   * @param {string} ownerAccount акаунт-запрошувач
   * @param {string} root кореневий вузол задачі
   * @param {{ email: string, role: string }} params кого і з якою роллю
   * @returns {object} запис запрошення (status: pending)
   * @throws {Error} не owner
   */
  invite(ownerAccount, root, { email, role }) {
    if (this.store.memberRole(root, ownerAccount) !== 'owner') {
      throw new Error('invite відхилено: запрошує лише owner')
    }
    return this.store.createInvitation(root, ownerAccount, email, role)
  }

  /**
   * Прийняття запрошення: запис у task_members + broadcast MemberChanged
   * у кімнату (access.md, «Membership API relay»).
   * @param {string} invitationId id запрошення
   * @param {string} accountId акаунт, що приймає (email мусить збігатись)
   * @returns {{root_node_hash: string, role: string}} членство
   * @throws {Error} невідоме/не pending/чужий email
   */
  accept(invitationId, accountId) {
    const invitation = this.store.invitationById(invitationId)
    if (!invitation || invitation.status !== 'pending') {
      throw new Error('accept відхилено: запрошення не існує або вже оброблене')
    }
    const account = this.store.accounts.get(accountId)
    if (!account || account.email !== invitation.to_email) {
      throw new Error('accept відхилено: запрошення адресоване іншому акаунту')
    }
    invitation.status = 'accepted'
    this.store.setMemberRole(invitation.root_node_hash, accountId, invitation.role)
    this.rooms.publish(invitation.root_node_hash, {
      kind: 'event',
      event: { type: 'MemberChanged', account_id: accountId, role: invitation.role }
    })
    return { root_node_hash: invitation.root_node_hash, role: invitation.role }
  }

  /**
   * Відхилення запрошення отримувачем.
   * @param {string} invitationId id запрошення
   * @param {string} accountId акаунт, що відхиляє
   * @returns {void}
   * @throws {Error} невідоме/чужий email
   */
  decline(invitationId, accountId) {
    const invitation = this.store.invitationById(invitationId)
    const account = this.store.accounts.get(accountId)
    if (!invitation || !account || account.email !== invitation.to_email) {
      throw new Error('decline відхилено: запрошення не існує або адресоване іншому')
    }
    invitation.status = 'declined'
  }

  /**
   * Transfer ownership: поточний owner передає роль; сам стає host
   * (штатний шлях succession — access.md).
   * @param {string} root кореневий вузол задачі
   * @param {string} fromAccount поточний owner
   * @param {string} toAccount новий owner (мусить бути учасником)
   * @returns {void}
   * @throws {Error} не owner / отримувач не учасник
   */
  transferOwnership(root, fromAccount, toAccount) {
    if (this.store.memberRole(root, fromAccount) !== 'owner') {
      throw new Error('transfer відхилено: передає лише owner')
    }
    if (!this.store.memberRole(root, toAccount)) {
      throw new Error('transfer відхилено: отримувач не учасник задачі')
    }
    this.store.setMemberRole(root, toAccount, 'owner')
    this.store.setMemberRole(root, fromAccount, 'host')
    this.rooms.publish(root, {
      kind: 'event',
      event: { type: 'MemberChanged', account_id: toAccount, role: 'owner' }
    })
  }

  /**
   * Pubkey-и пристроїв учасників approver+ — для перевірки підписів
   * approvals хостом. Доступ лише пристроям учасників (access.md).
   * @param {object} device запис пристрою-запитувача
   * @param {string} root кореневий вузол задачі
   * @returns {{device_id: string, account_id: string, pubkey: string}[]} pubkey-и
   * @throws {Error} не учасник
   */
  pubkeys(device, root) {
    if (!this.store.memberRole(root, device.account_id)) {
      throw new Error('pubkeys відхилено: акаунт не учасник задачі')
    }
    return this.store.pubkeysFor(root)
  }
}
