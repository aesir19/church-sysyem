<script setup>
// Pastor assignment (mockup 4b). Super Admin and Head Pastor.
//
// WHERE THIS DEPARTS FROM THE MOCKUP, AND WHY.
// 4b is built on "each church has exactly one pastor" and turns every change into a
// handover: pick the successor, choose where the outgoing pastor lands, confirm. Our
// model says otherwise — a church may have several pastors, and a person's church comes
// from their member record rather than from the role. So:
//
//   * the row lists the pastors a church has, or says it has none;
//   * assignment is additive, removal is its own action, and there is no successor;
//   * step 2 ("where Eduardo lands") disappears — removal drops the person to `member`;
//   * "Handover history" has no table behind it and is drawn as Soon.
//
// What is kept is everything visual: the compact one-line church rows, the accent
// border and dashed inset panel when a row is expanded, the radio list of candidates,
// and the "Who may assign" card.
//
// A HEAD PASTOR MUST BE ABLE TO USE THIS. They cannot call list_accounts() — it carries
// every e-mail in the system — so the candidate list comes from list_church_accounts(),
// which returns names and roles and no PII. That function exists because this screen
// would otherwise be empty for the one role it most serves.

import { ref, computed, onMounted } from 'vue'
import { useCurrentRole } from '../../composables/useCurrentRole'
import { listChurches, listChurchAccounts, setUserRole } from '../../lib/data/admin'
import { showToast } from '../../composables/useToast'
import Badge from '../../components/ui/Badge.vue'
import Button from '../../components/ui/Button.vue'
import Avatar from '../../components/ui/Avatar.vue'
import Spinner from '../../components/ui/Spinner.vue'
import Soon from '../../components/ui/Soon.vue'
import NotYoursPanel from '../../components/settings/NotYoursPanel.vue'
import ConfirmPastorModal from '../../components/settings/ConfirmPastorModal.vue'

const { caps } = useCurrentRole()

const loading = ref(true)
const permitted = ref(false)
const errorMessage = ref('')
const churches = ref([])
const accounts = ref([])

const expanded = ref(null)
const picked = ref(null)
const confirming = ref(null)

const canAssignPastors = computed(() => !!caps.value.isSuperAdmin || !!caps.value.isHeadPastor)

const byChurch = computed(() => {
  const map = new Map()
  for (const church of churches.value) map.set(church.id, { ...church, pastors: [], candidates: [] })

  for (const account of accounts.value) {
    const entry = map.get(account.church_id)
    if (!entry) continue
    if (account.role === 'pastor') entry.pastors.push(account)
    // Anyone linked and not already pastoring here can be made one. Head Pastors and
    // Super Admins are excluded: appointing them would demote a senior role, which
    // set_user_role refuses anyway — offering it would be an action that always fails.
    else if (account.role !== 'head_pastor' && account.role !== 'super_admin') entry.candidates.push(account)
  }

  return [...map.values()]
})

async function load () {
  loading.value = true
  errorMessage.value = ''

  const [churchRes, accountRes] = await Promise.all([
    listChurches({ canAssignPastors: canAssignPastors.value }),
    listChurchAccounts({ canAssignPastors: canAssignPastors.value })
  ])

  permitted.value = churchRes.permitted
  if (!churchRes.ok || !accountRes.ok) {
    errorMessage.value = churchRes.permitted ? (churchRes.message || accountRes.message) : ''
    churches.value = []
    accounts.value = []
  } else {
    churches.value = churchRes.rows
    accounts.value = accountRes.rows
  }

  loading.value = false
}

onMounted(load)

function toggle (churchId) {
  expanded.value = expanded.value === churchId ? null : churchId
  picked.value = null
}

function review (church) {
  const account = church.candidates.find(c => c.account_id === picked.value)
  if (!account) return
  confirming.value = { church, account, action: 'assign' }
}

function reviewRemoval (church, account) {
  confirming.value = { church, account, action: 'remove' }
}

async function apply () {
  const { church, account, action } = confirming.value
  const res = await setUserRole({
    accountId: account.account_id,
    role: action === 'assign' ? 'pastor' : 'member'
  })

  confirming.value = null

  if (!res.ok) {
    showToast(res.message)
    return
  }

  showToast(action === 'assign'
    ? `${account.full_name} is now a pastor of ${church.name}.`
    : `${account.full_name} is no longer a pastor of ${church.name}.`)

  expanded.value = null
  picked.value = null
  await load()
}
</script>

<template>
  <section class="pa">
    <nav
      class="pa__crumbs"
      aria-label="Breadcrumb"
    >
      <span>Settings</span>
      <span aria-hidden="true">/</span>
      <span class="pa__crumb-here">Pastor assignment</span>
    </nav>

    <h1 class="pa__title">
      Pastors across your churches
    </h1>
    <p class="pa__lede">
      A pastor is a member of the church they pastor, so the church follows from their
      member record. A church may have more than one.
    </p>

    <NotYoursPanel
      v-if="!loading && !permitted"
      detail="Only a Super Admin or a Head Pastor assigns pastors. Ask an administrator if something needs changing."
    />

    <template v-else>
      <div class="pa__banner">
        <span
          class="pa__dot"
          aria-hidden="true"
        />
        <strong>{{ caps.isSuperAdmin ? 'You can assign a pastor in every church' : 'You can assign a pastor in every church you oversee' }}</strong>
        <span class="pa__banner-note">Each change is confirmed one church at a time.</span>
      </div>

      <p
        v-if="loading"
        class="pa__state"
      >
        <Spinner /> Loading churches…
      </p>

      <p
        v-else-if="errorMessage"
        class="pa__state pa__state--error"
      >
        {{ errorMessage }}
      </p>

      <ul
        v-else
        class="pa__list"
      >
        <li
          v-for="church in byChurch"
          :key="church.id"
          class="pa__card"
          :class="{ 'is-open': expanded === church.id }"
        >
          <div class="pa__row">
            <!-- A church gets a rounded square, a person gets a circle. 4b draws that
                 distinction and it is worth keeping: they are not the same kind of thing. -->
            <span
              class="pa__tile"
              aria-hidden="true"
            >{{ church.name.slice(0, 2).toUpperCase() }}</span>
            <span class="pa__church">
              <span class="pa__church-name">{{ church.name }}</span>
              <span class="pa__church-note">{{ church.pastors.length }} {{ church.pastors.length === 1 ? 'pastor' : 'pastors' }}</span>
            </span>

            <span
              class="pa__rule"
              aria-hidden="true"
            />

            <ul
              v-if="church.pastors.length"
              class="pa__pastors"
            >
              <li
                v-for="pastor in church.pastors"
                :key="pastor.account_id"
                class="pa__pastor"
              >
                <Avatar
                  :name="pastor.full_name"
                  :size="30"
                />
                <span class="pa__pastor-name">{{ pastor.full_name }}</span>
                <Button
                  size="sm"
                  variant="dangerQuiet"
                  @click="reviewRemoval(church, pastor)"
                >
                  Remove
                </Button>
              </li>
            </ul>
            <span
              v-else
              class="pa__none"
            >No pastor assigned</span>

            <Button
              variant="primary"
              size="sm"
              class="pa__assign"
              @click="toggle(church.id)"
            >
              {{ expanded === church.id ? 'Close' : 'Assign a pastor' }}
            </Button>
          </div>

          <!-- 4b's dashed inset panel, kept. Step 2 is gone: there is no outgoing
               pastor to place, because assignment is additive. -->
          <div
            v-if="expanded === church.id"
            class="pa__panel"
          >
            <p class="pa__step">
              Who pastors {{ church.name }}
            </p>
            <p class="pa__step-note">
              Only people with a sign-in linked to a member record <em>of this church</em>
              can hold it.
              <RouterLink
                v-if="caps.isSuperAdmin"
                to="/dashboard/settings/roles"
              >
                Link an account first
              </RouterLink>
              <span v-else>Ask a Super Admin to link an account if someone is missing.</span>
            </p>

            <p
              v-if="!church.candidates.length"
              class="pa__state"
            >
              Nobody in this church has a linked sign-in yet.
            </p>

            <div
              v-else
              class="pa__choices"
            >
              <label
                v-for="candidate in church.candidates"
                :key="candidate.account_id"
                class="pa__choice"
                :class="{ 'is-picked': picked === candidate.account_id }"
              >
                <input
                  v-model="picked"
                  type="radio"
                  :value="candidate.account_id"
                  :name="`pastor-${church.id}`"
                >
                <Avatar
                  :name="candidate.full_name"
                  :size="28"
                />
                <span class="pa__choice-name">{{ candidate.full_name }}</span>
                <Badge>{{ candidate.role === 'church_leader' ? 'Church Leader' : 'Member' }}</Badge>
              </label>
            </div>

            <div class="pa__panel-actions">
              <Button
                size="sm"
                @click="toggle(church.id)"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                :disabled="!picked"
                @click="review(church)"
              >
                Review the change
              </Button>
            </div>
          </div>
        </li>
      </ul>

      <div class="pa__cards">
        <article class="pa__info">
          <h2 class="pa__h2">
            Who may assign
          </h2>
          <div class="pa__info-row">
            <span
              class="pa__dot"
              aria-hidden="true"
            />
            <span><strong>Super Admin</strong><span>Every church — assign and remove at any time</span></span>
          </div>
          <div class="pa__info-row">
            <span
              class="pa__dot"
              aria-hidden="true"
            />
            <span><strong>Head Pastor</strong><span>Every church, as the role that oversees church administration</span></span>
          </div>
          <div class="pa__info-row">
            <span
              class="pa__dot pa__dot--muted"
              aria-hidden="true"
            />
            <span><strong>Everyone else</strong><span>Cannot assign. A Pastor cannot appoint another pastor.</span></span>
          </div>
          <p class="pa__info-note">
            Removing a pastor makes them a plain member. It never removes them from the
            church roll.
          </p>
        </article>

        <article class="pa__info">
          <h2 class="pa__h2">
            Handover history
            <Soon waiting-on="changes are not recorded to a log yet" />
          </h2>
          <Soon
            variant="block"
            waiting-on="there is no audit log behind this yet"
          />
        </article>
      </div>
    </template>

    <ConfirmPastorModal
      :open="!!confirming"
      :subject="confirming"
      @update:open="confirming = null"
      @confirm="apply"
    />
  </section>
</template>

<style scoped>
.pa { display: flex; flex-direction: column; }

.pa__crumbs {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--text-meta);
  font-weight: 600;
  color: var(--ink-4);
}
.pa__crumb-here { color: var(--ink-2); }

.pa__title {
  margin: 10px 0 0;
  font-size: var(--text-h1);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: var(--leading-h1);
}

.pa__lede {
  margin: 5px 0 0;
  max-width: 72ch;
  font-size: var(--text-body-sm);
  color: var(--ink-3);
}

.pa__banner {
  display: flex;
  align-items: center;
  gap: 11px;
  flex-wrap: wrap;
  margin-top: 18px;
  padding: 12px 15px;
  border: 1px solid var(--accent-border);
  border-radius: 13px;
  background: var(--accent-tint);
  font-size: var(--text-body-sm);
  color: var(--accent-darkest);
}

.pa__banner-note { color: var(--ink-3); font-size: var(--text-meta); }

.pa__dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: var(--r-pill);
  background: var(--accent);
}
.pa__dot--muted { background: var(--ink-4); }

.pa__state {
  display: flex;
  align-items: center;
  gap: var(--sp-8);
  margin-top: 16px;
  font-size: var(--text-body-sm);
  color: var(--ink-3);
}
.pa__state--error { color: var(--magenta-darkest); }

.pa__list {
  list-style: none;
  margin: 18px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-14);
}

.pa__card {
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--surface);
  box-shadow: var(--shadow-card);
  transition: border-color var(--dur-state);
}
.pa__card.is-open { border-color: var(--accent); }

.pa__row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }

.pa__tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 11px;
  background: var(--accent-tint);
  color: var(--accent-darkest);
  font-weight: 800;
  font-size: var(--text-meta);
}

.pa__church { display: flex; flex-direction: column; line-height: 1.3; min-width: 150px; }
.pa__church-name { font-weight: 800; font-size: var(--text-h3-sm); letter-spacing: var(--tracking-h3); }
.pa__church-note { font-size: var(--text-meta); color: var(--ink-4); }

.pa__rule { width: 1px; height: 34px; flex: none; background: var(--divider); }

.pa__pastors { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 14px; }
.pa__pastor { display: flex; align-items: center; gap: var(--sp-8); }
.pa__pastor-name { font-weight: 700; font-size: var(--text-body-sm); }

.pa__none { font-size: var(--text-body-sm); color: var(--ink-4); }

.pa__assign { margin-left: auto; }

.pa__panel {
  margin-top: 16px;
  padding: 16px;
  border: 1px dashed var(--border);
  border-radius: 13px;
}

.pa__step {
  margin: 0;
  font-size: var(--text-eyebrow);
  font-weight: 700;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--ink-3);
}

.pa__step-note { margin: 5px 0 0; font-size: var(--text-meta); color: var(--ink-4); }

.pa__choices { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }

.pa__choice {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-inset);
  background: var(--surface);
  cursor: pointer;
}
.pa__choice.is-picked { border-color: var(--accent); background: var(--accent-tint); }
.pa__choice input { accent-color: var(--accent); width: 15px; height: 15px; }
.pa__choice-name { flex: 1; font-weight: 700; font-size: var(--text-body-sm); }

.pa__panel-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 18px; }

.pa__cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-top: 26px;
  align-items: start;
}

.pa__info {
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--surface);
  box-shadow: var(--shadow-card);
}

.pa__h2 {
  display: flex;
  align-items: center;
  gap: var(--sp-8);
  margin: 0 0 12px;
  font-size: var(--text-h3-sm);
  font-weight: 800;
  letter-spacing: var(--tracking-h3);
}

.pa__info-row {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 9px 0;
  border-bottom: 1px solid var(--divider);
}
.pa__info-row .pa__dot { margin-top: 6px; }
.pa__info-row strong { display: block; font-size: var(--text-body-sm); }
.pa__info-row span span { display: block; font-size: var(--text-meta); color: var(--ink-4); text-wrap: pretty; }

.pa__info-note { margin: 12px 0 0; font-size: var(--text-meta); color: var(--ink-4); }

@media (max-width: 900px) {
  .pa__cards { grid-template-columns: 1fr; }
  .pa__assign { margin-left: 0; }
}
</style>
