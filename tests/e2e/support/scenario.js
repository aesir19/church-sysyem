import { seedSession, SUPERADMIN_USER } from './session.js'
import { installSupabaseMock } from './mockSupabase.js'

// Shared setup for the authed dashboard specs, so each module's file only spells
// out the data that is particular to its screen. The three RPCs below (role +
// church context) are resolved on every dashboard route; user_accounts is
// defaulted inside installSupabaseMock.

export const CHURCH = { id: 'church-cogon', name: 'Cogon' }

// A SuperAdmin — the widest role, so a single account can drive every module's
// write paths. A spec that needs to prove a narrower role's gating overrides
// `rpc.get_my_permissions` with its own row.
export const SUPERADMIN_PERMS = {
  role: 'super_admin',
  is_super_admin: true,
  is_head_pastor: false,
  is_pastor: false,
  is_church_leader: false,
  is_finance: false,
  is_secretariat: false,
  is_welcome: false,
  is_small_group_leader: false,
}

export { SUPERADMIN_USER }

export function baseRpc(extra = {}) {
  return {
    get_my_permissions: SUPERADMIN_PERMS,
    get_my_church: CHURCH,
    list_churches: [CHURCH],
    ...extra,
  }
}

/**
 * Seed a signed-in SuperAdmin, mock the network, then navigate. `rpc`/`tables`/
 * `onWrite` are the screen-specific fixtures, merged over the base context.
 */
export async function authedGoto(page, path, { rpc = {}, tables = {}, onWrite } = {}) {
  await seedSession(page, SUPERADMIN_USER)
  await installSupabaseMock(page, {
    user: SUPERADMIN_USER,
    rpc: baseRpc(rpc),
    tables,
    onWrite,
  })
  await page.goto(path)
}
