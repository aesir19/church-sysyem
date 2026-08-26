<script setup>
// Roles & account linking (mockup 4a). Super Admin only.
//
// THE KEYSTONE SCREEN. Until this exists, `user_accounts.member_id` is never set by
// anything, so every sign-up lands on "Account setup in progress" and stays there
// permanently. Nothing else in the administration set does anything without it.
//
// WHY THE MATCH PANEL IS DRAWN BUT EMPTY. 4a proposes a member for each waiting
// account with a confidence percentage — 98%, 62%, a progress bar. Nothing computes
// that, and a fabricated number beside a real person's name is the most dangerous
// thing that could sit on this page: it invites an administrator to grant a stranger
// access to a church on the strength of a figure that means nothing. So the panel keeps
// its position in the layout and says the matching is coming, with no percentage and no
// proposed name. The working path is Search members, which is what 4d is for.
//
// A ZERO HERE IS NOT AN EMPTY QUEUE. list_accounts() returns no rows to anyone who is
// not a Super Admin rather than raising, deliberately, so a probe learns nothing. The
// data module reports `permitted` separately for exactly that reason, and this screen
// renders the refusal state rather than "nobody is waiting".

import { ref, computed, onMounted } from 'vue'
import { useCurrentRole } from '../../composables/useCurrentRole'
import {
  listAccounts, linkAccount, setUserRole,
  listPendingInvites, inviteAccount, resendInvite
} from '../../lib/data/admin'
import { showToast } from '../../composables/useToast'
import Badge from '../../components/ui/Badge.vue'
import Button from '../../components/ui/Button.vue'
import Avatar from '../../components/ui/Avatar.vue'
import Spinner from '../../components/ui/Spinner.vue'
import Soon from '../../components/ui/Soon.vue'
import LinkAccountModal from '../../components/settings/LinkAccountModal.vue'
import InviteUserModal from '../../components/settings/InviteUserModal.vue'
import NotYoursPanel from '../../components/settings/NotYoursPanel.vue'

const { caps } = useCurrentRole()

const loading = ref(true)
const permitted = ref(false)
const errorMessage = ref('')
const accounts = ref([])
const filter = ref('')

const linkTarget = ref(null)

// Inviting is the wider capability: a Super Admin manages the whole queue below,
// a Church Leader only invites and sees their own pending invites. `permitted`
// (the page) turns on for either; the management sections gate on isSuperAdmin.
const canManageAccounts = computed(() => !!caps.value.isSuperAdmin)
const canInvite = computed(() => !!caps.value.canInvite)

const inviteOpen = ref(false)
const inviteSending = ref(false)
const inviteError = ref('')
const pendingInvites = ref([])

// The roles a Super Admin may hand out on link. Secretary and Treasurer are absent
// on purpose: those are ministry memberships, granted by adding the person to the
// Finance or Secretariat ministry on the Groups page. Two ways to become Treasurer
// that can disagree with each other is worse than one that is slightly less obvious.
const ROLE_CHOICES = [
  { value: 'member', label: 'Member' },
  { value: 'church_leader', label: 'Church Leader' },
  { value: 'pastor', label: 'Pastor' },
  { value: 'head_pastor', label: 'Head Pastor' },
  { value: 'super_admin', label: 'Super Admin' }
]

const ROLE_LABEL = Object.fromEntries(ROLE_CHOICES.map(r => [r.value, r.label]))

const waiting = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  const rows = accounts.value.filter(a => !a.member_id)
  if (!needle) return rows
  return rows.filter(a =>
    (a.email || '').toLowerCase().includes(needle) ||
    (a.signup_name || '').toLowerCase().includes(needle)
  )
})

const linked = computed(() => accounts.value.filter(a => !!a.member_id))

async function load () {
  loading.value = true
  errorMessage.value = ''

  // The page opens for anyone who can invite; a Church Leader gets there without
  // being able to read the account queue, so permission is the invite capability.
  permitted.value = canInvite.value

  // The account queue and linked table are a Super Admin's. Only load them then —
  // a Church Leader would get zero rows and a `permitted: false` anyway.
  if (canManageAccounts.value) {
    const res = await listAccounts({ canManageAccounts: true })
    if (!res.ok) {
      errorMessage.value = res.permitted ? res.message : ''
      accounts.value = []
    } else {
      accounts.value = res.rows
    }
  } else {
    accounts.value = []
  }

  if (canInvite.value) {
    const pend = await listPendingInvites({ canInvite: true })
    pendingInvites.value = pend.ok ? pend.rows : []
  }

  loading.value = false
}

onMounted(load)

async function onInvite ({ email, memberId, memberName, role }) {
  inviteSending.value = true
  inviteError.value = ''

  const res = await inviteAccount({ email, memberId, role })

  inviteSending.value = false
  if (!res.ok) {
    // Keep the dialog open with the reason, so a duplicate e-mail or an already
    // linked member can be corrected without retyping everything.
    inviteError.value = res.message
    return
  }

  showToast(`Invitation sent to ${email} for ${memberName}.`)
  inviteOpen.value = false
  await load()
}

async function onResend (invite) {
  const res = await resendInvite({ email: invite.email })
  showToast(res.ok ? `Invitation resent to ${invite.email}.` : res.message)
  if (res.ok) await load()
}

function openInvite () {
  inviteError.value = ''
  inviteOpen.value = true
}

async function onLinked ({ accountId, memberId, memberName, role }) {
  const res = await linkAccount({ accountId, memberId })
  if (!res.ok) {
    showToast(res.message)
    return
  }

  // Role is a second call because they are two different grants: a member record says
  // who you are, a role says what you may do. Reporting the link as failed because the
  // role did not take would be a lie — the link happened.
  if (role && role !== 'unassigned') {
    const roleRes = await setUserRole({ accountId, role })
    if (!roleRes.ok) {
      showToast(`Linked to ${memberName}, but the role could not be set.`)
      await load()
      return
    }
  }

  showToast(`Linked to ${memberName}.`)
  linkTarget.value = null
  await load()
}

async function onUnlink (account) {
  const res = await linkAccount({ accountId: account.account_id, memberId: null })
  showToast(res.ok ? `${account.email} unlinked.` : res.message)
  if (res.ok) await load()
}

// Change the role of an already-linked account. Same grant as the link dialog
// hands out, just after the fact — a member record says who you are, a role says
// what you may do, and this is the second one on its own. Super Admin only, which
// this table already is. The row is disabled while the change is in flight so a
// second pick cannot race the first.
const roleSavingId = ref(null)

async function onSetRole (account, role) {
  if (role === account.role) return
  roleSavingId.value = account.account_id

  const res = await setUserRole({ accountId: account.account_id, role })
  roleSavingId.value = null

  if (!res.ok) {
    showToast(res.message)
    await load() // reload so the select snaps back to the real, unchanged role
    return
  }

  showToast(`${account.email} is now ${ROLE_LABEL[role] || role}.`)
  await load()
}
</script>

<template>
  <section class="rl">
    <nav
      class="rl__crumbs"
      aria-label="Breadcrumb"
    >
      <span>Settings</span>
      <span aria-hidden="true">/</span>
      <span class="rl__crumb-here">Invite user</span>
    </nav>

    <header class="rl__head">
      <div>
        <h1 class="rl__title">
          Invite user
        </h1>
        <p class="rl__lede">
          Invite someone to their account and attach the member record it belongs to.
          <template v-if="canManageAccounts">
            A sign-in grants nothing until it has a member record and a role.
          </template>
        </p>
      </div>
      <div class="rl__head-actions">
        <Button
          v-if="canInvite"
          variant="primary"
          size="sm"
          @click="openInvite"
        >
          Invite user
        </Button>
        <template v-if="canManageAccounts">
          <Button
            size="sm"
            disabled
            title="there is no audit log yet"
          >
            Audit log
          </Button>
          <Soon waiting-on="there is no audit log yet" />
        </template>
      </div>
    </header>

    <NotYoursPanel v-if="!loading && !permitted" />

    <template v-else>
      <!-- Pending invites — sent but not yet accepted. Shown to everyone who can
           invite: a Super Admin sees all, a Church Leader only their own church's
           (the RPC scopes it). This is the whole surface for a Church Leader. -->
      <section class="rl__pending">
        <div class="rl__section-head">
          <div>
            <h2 class="rl__h2">
              Pending invites
            </h2>
            <p class="rl__sub">
              Invitations that have been sent but not yet accepted. Resend if one did
              not arrive.
            </p>
          </div>
        </div>

        <p
          v-if="loading"
          class="rl__state"
        >
          <Spinner /> Loading invites…
        </p>
        <p
          v-else-if="!pendingInvites.length"
          class="rl__state"
        >
          No invitations are pending.
        </p>
        <div
          v-else
          class="rl__table-wrap"
        >
          <table class="rl__table">
            <thead>
              <tr>
                <th scope="col">
                  E-mail
                </th>
                <th scope="col">
                  Member
                </th>
                <th scope="col">
                  Role
                </th>
                <th scope="col">
                  <span class="rl__sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="invite in pendingInvites"
                :key="invite.id"
              >
                <td class="rl__cell-strong">
                  {{ invite.email }}
                </td>
                <td>{{ invite.full_name }}</td>
                <td>
                  <Badge :tone="invite.role && invite.role !== 'unassigned' ? 'accent' : 'neutral'">
                    {{ invite.role && invite.role !== 'unassigned' ? (ROLE_LABEL[invite.role] || invite.role) : 'No role yet' }}
                  </Badge>
                </td>
                <td class="rl__cell-right">
                  <Button
                    size="sm"
                    @click="onResend(invite)"
                  >
                    Resend
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Everything below is the Super Admin's account queue and linked table. A
           Church Leader can invite but not read accounts, so it is withheld. -->
      <template v-if="canManageAccounts">
        <div class="rl__tiles">
          <article class="rl__tile">
            <span class="rl__tile-label">Accounts awaiting a link</span>
            <span
              class="rl__tile-figure rl__tile-figure--alert"
            >{{ loading ? '—' : waiting.length }}</span>
            <span class="rl__tile-note">They can sign in but see nothing</span>
          </article>
          <article class="rl__tile">
            <span class="rl__tile-label">Linked accounts</span>
            <span class="rl__tile-figure">{{ loading ? '—' : linked.length }}</span>
            <span class="rl__tile-note">With a member record and a role</span>
          </article>
          <article class="rl__tile">
            <span class="rl__tile-label">Member records</span>
            <span class="rl__tile-figure rl__tile-figure--soon"><Soon waiting-on="the member count is not wired up here yet" /></span>
            <span class="rl__tile-note">Counted on the Members page</span>
          </article>
        </div>

        <div class="rl__section-head">
          <div>
            <h2 class="rl__h2">
              Accounts awaiting a member record
            </h2>
            <p class="rl__sub">
              Pick the person each sign-in belongs to. Two members can share a name — check
              the birthdate before linking.
            </p>
          </div>
          <input
            v-model="filter"
            type="search"
            class="rl__filter"
            placeholder="Filter by e-mail or name"
            aria-label="Filter accounts by e-mail or name"
          >
        </div>

        <p
          v-if="loading"
          class="rl__state"
        >
          <Spinner /> Loading accounts…
        </p>

        <p
          v-else-if="errorMessage"
          class="rl__state rl__state--error"
        >
          {{ errorMessage }}
        </p>

        <p
          v-else-if="!waiting.length"
          class="rl__state"
        >
          {{ filter ? 'No waiting account matches that.' : 'Nobody is waiting. Every account has a member record.' }}
        </p>

        <ul
          v-else
          class="rl__queue"
        >
          <li
            v-for="account in waiting"
            :key="account.account_id"
            class="rl__card"
          >
            <div class="rl__card-top">
              <div class="rl__who">
                <Avatar
                  :name="account.signup_name || account.email"
                  :size="32"
                />
                <span class="rl__who-text">
                  <span class="rl__email">{{ account.email }}</span>
                  <span class="rl__signup">{{ account.signup_name ? `Signed up as “${account.signup_name}”` : 'No name given' }}</span>
                </span>
              </div>
              <div class="rl__chips">
                <Badge>Unassigned · no record</Badge>
                <Badge v-if="account.provider">
                  {{ account.provider === 'email' ? 'E-mail & password' : `${account.provider} sign-in` }}
                </Badge>
              </div>
            </div>

            <!-- 4a's match panel, keeping its position and carrying no invented figure. -->
            <div class="rl__match">
              <Soon
                variant="block"
                waiting-on="nothing proposes a member yet — use Search members"
              />
            </div>

            <div class="rl__actions">
              <Button
                variant="primary"
                size="sm"
                @click="linkTarget = account"
              >
                Search members…
              </Button>
            </div>
          </li>
        </ul>

        <h2 class="rl__h2 rl__h2--spaced">
          Linked accounts
        </h2>

        <div class="rl__table-wrap">
          <table class="rl__table">
            <thead>
              <tr>
                <th scope="col">
                  Account
                </th>
                <th scope="col">
                  Member record
                </th>
                <th scope="col">
                  Role
                </th>
                <th scope="col">
                  <span class="rl__sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!linked.length && !loading">
                <td
                  colspan="4"
                  class="rl__empty"
                >
                  No account is linked yet.
                </td>
              </tr>
              <tr
                v-for="account in linked"
                :key="account.account_id"
              >
                <td class="rl__cell-strong">
                  {{ account.email }}
                </td>
                <td>{{ account.member_name }}</td>
                <td>
                  <select
                    class="rl__role-select"
                    :value="account.role"
                    :disabled="roleSavingId === account.account_id"
                    :aria-label="`Role for ${account.email}`"
                    @change="onSetRole(account, $event.target.value)"
                  >
                    <option value="unassigned">
                      No role
                    </option>
                    <option
                      v-for="choice in ROLE_CHOICES"
                      :key="choice.value"
                      :value="choice.value"
                    >
                      {{ choice.label }}
                    </option>
                  </select>
                </td>
                <td class="rl__cell-right">
                  <Button
                    size="sm"
                    @click="onUnlink(account)"
                  >
                    Unlink
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>

    <LinkAccountModal
      :open="!!linkTarget"
      :account="linkTarget"
      :role-choices="ROLE_CHOICES"
      @update:open="linkTarget = null"
      @link="onLinked"
    />

    <InviteUserModal
      :open="inviteOpen"
      :can-set-role="canManageAccounts"
      :role-choices="ROLE_CHOICES"
      :sending="inviteSending"
      :error-message="inviteError"
      @update:open="inviteOpen = $event"
      @invite="onInvite"
    />
  </section>
</template>

<style scoped>
.rl { display: flex; flex-direction: column; }

.rl__crumbs {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--text-meta);
  font-weight: 600;
  color: var(--ink-4);
}
.rl__crumb-here { color: var(--ink-2); }

.rl__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.rl__head-actions { display: flex; align-items: center; gap: var(--sp-8); }

.rl__title {
  margin: 0;
  font-size: var(--text-h1);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: var(--leading-h1);
}

.rl__lede {
  margin: 5px 0 0;
  max-width: 70ch;
  font-size: var(--text-body-sm);
  color: var(--ink-3);
}

.rl__tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-14);
  margin-top: 20px;
}

.rl__tile {
  display: flex;
  flex-direction: column;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--surface);
  box-shadow: var(--shadow-card);
}

.rl__tile-label { font-size: var(--text-meta); font-weight: 700; color: var(--ink-3); }

.rl__tile-figure {
  margin-top: var(--sp-8);
  font-size: var(--text-figure);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  font-variant-numeric: tabular-nums;
}
.rl__tile-figure--alert { color: var(--magenta); }
.rl__tile-figure--soon { display: flex; align-items: center; min-height: 34px; }

.rl__tile-note { font-size: var(--text-meta); color: var(--ink-4); }

.rl__section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 26px;
}

.rl__h2 {
  margin: 0;
  font-size: var(--text-h2);
  font-weight: 800;
  letter-spacing: var(--tracking-h2);
}
.rl__h2--spaced { margin-top: 30px; }

.rl__sub {
  margin: 4px 0 0;
  max-width: 72ch;
  font-size: var(--text-meta);
  color: var(--ink-3);
}

.rl__filter {
  width: 220px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-control);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-meta);
}

.rl__state {
  display: flex;
  align-items: center;
  gap: var(--sp-8);
  margin-top: 16px;
  font-size: var(--text-body-sm);
  color: var(--ink-3);
}
.rl__state--error { color: var(--magenta-darkest); }

.rl__queue {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-14);
}

.rl__card {
  display: grid;
  /* 4a's signature: identity on the left, what we know on the right, split by a rule. */
  grid-template-columns: 1fr 1.15fr;
  gap: 22px;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--surface);
  box-shadow: var(--shadow-card);
}

.rl__card-top { min-width: 0; }

.rl__who { display: flex; align-items: center; gap: 11px; min-width: 0; }
.rl__who-text { display: flex; flex-direction: column; line-height: 1.3; min-width: 0; }

.rl__email {
  font-weight: 700;
  font-size: var(--text-body);
  overflow-wrap: anywhere;
}
.rl__signup { font-size: var(--text-meta); color: var(--ink-4); }

.rl__chips { display: flex; gap: 7px; margin-top: 12px; flex-wrap: wrap; }

.rl__match {
  padding-left: 22px;
  border-left: 1px solid var(--divider);
}

.rl__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  padding-top: 14px;
  border-top: 1px solid var(--divider);
}

.rl__table-wrap {
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  overflow-x: auto;
}

.rl__table { width: 100%; border-collapse: collapse; font-size: var(--text-body-sm); }

.rl__table th {
  text-align: left;
  padding: 11px 20px;
  background: var(--surface-subtle);
  font-size: var(--text-eyebrow);
  font-weight: 700;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--ink-4);
}

.rl__table td {
  padding: 12px 20px;
  border-top: 1px solid var(--divider);
  color: var(--ink-2);
}

.rl__cell-strong { font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
.rl__cell-right { text-align: right; }
.rl__empty { color: var(--ink-4); }

.rl__role-select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-control);
  background: var(--surface);
  font-family: inherit;
  font-size: var(--text-meta);
  font-weight: 600;
  color: var(--ink-2);
  cursor: pointer;
}
.rl__role-select:focus-visible { outline: var(--ring-focus); outline-offset: 1px; }
.rl__role-select:disabled { opacity: 0.6; cursor: progress; }

.rl__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}

@media (max-width: 900px) {
  .rl__tiles { grid-template-columns: 1fr; }
  .rl__card { grid-template-columns: 1fr; }
  .rl__match { padding-left: 0; border-left: 0; border-top: 1px solid var(--divider); padding-top: 14px; }
}
</style>
