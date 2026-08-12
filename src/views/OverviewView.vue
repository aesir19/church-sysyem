<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import Button from '../components/ui/Button.vue'
import Alert from '../components/ui/Alert.vue'
import Icon from '../components/ui/icons/Icon.vue'
import { useActiveChurch } from '../composables/useActiveChurch'
import { useCurrentRole } from '../composables/useCurrentRole'
import { useCurrentUser } from '../composables/useCurrentUser'
import {
  fetchMemberCounts, fetchNeedsAttention, fetchRecentServices,
  fetchMonthFunds, fetchOpenService
} from '../lib/data/overview'

// The landing screen.
//
// WHAT IS DELIBERATELY MISSING. The mockup draws four stat tiles; this renders
// three. The fourth is "Follow-ups due", and there is no follow-up record in
// this database — no table, no column, nothing to count. The owner's rule for
// the redesign is that a screen shows what the data can honestly support and
// anything else becomes a planned feature, so the tile is gone rather than
// faked with a plausible-looking number. The follow-up worklist is filed as
// deferred work; when it lands, the fourth tile comes back.
//
// The "Your access" card enumerates the REAL capability set — seven roles, not
// the mockup's three. A card on the front page that told someone they could do
// something the database will refuse is a security defect wearing a design's
// clothes, so the visual language is the mockup's and the content is the app's.

const { activeChurchId, activeChurchName } = useActiveChurch()
const { caps, role } = useCurrentRole()
const { firstName, load: loadUser } = useCurrentUser()

const loading = ref(true)
const failed = ref(false)
const counts = ref({ active: 0, archived: 0 })
const attention = ref({ noOneToOne: 0, notBaptized: 0, inNoGroup: 0 })
const services = ref([])
const funds = ref({ total: 0 })
const openService = ref(null)

const now = new Date()

const greetingDate = computed(() =>
  now.toLocaleDateString('en-PH', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
)

const greeting = computed(() => {
  const h = now.getHours()
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  return firstName.value ? `${part}, ${firstName.value}` : part
})

const monthLabel = computed(() => now.toLocaleDateString('en-PH', { month: 'long' }))

const presentToday = computed(() => {
  const last = services.value[services.value.length - 1]
  return last?.present ?? 0
})

const averagePresent = computed(() => {
  if (!services.value.length) return 0
  const sum = services.value.reduce((a, s) => a + s.present, 0)
  return Math.round(sum / services.value.length)
})

const peak = computed(() => Math.max(1, ...services.value.map(s => s.present)))

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP', maximumFractionDigits: 0
})

const fundsShort = computed(() => {
  const t = funds.value.total
  if (t >= 1000) return `${peso.format(t / 1000).replace(/\.00$/, '')}k`.replace('₱', '₱')
  return peso.format(t)
})

// The permission chips. Granted and denied both render — the mockup's card
// states what you cannot do as plainly as what you can, which is the whole
// point of it.
const accessChips = computed(() => [
  { label: 'Member details', on: caps.value.canSeeMemberDetail },
  { label: 'Add & archive members', on: caps.value.canWriteMembers },
  { label: 'Attendance', on: caps.value.canViewAttendance },
  { label: 'Record attendance', on: caps.value.canManageAttendance },
  { label: 'Finance reports', on: caps.value.canViewFinance },
  { label: 'Finance entry', on: caps.value.canWriteFinance },
  { label: 'Small groups', on: caps.value.canManageSmallGroups }
])

const ROLE_LABEL = {
  super_admin: 'Super Admin',
  head_pastor: 'Head Pastor',
  pastor: 'Pastor',
  church_leader: 'Church Leader',
  finance: 'Finance',
  secretariat: 'Secretariat',
  welcome: 'Welcome Team'
}

const accessSentence = computed(() => {
  const name = ROLE_LABEL[role.value] || 'No role assigned'
  const church = activeChurchName.value || 'this church'
  if (!role.value) return `You have no role on ${church} yet. A pastor assigns one before the dashboard opens up.`
  if (caps.value.isCrossChurch) return `${name}. You can see every church in the network; you are looking at ${church}.`
  return `${name} of ${church}.`
})

async function load () {
  const id = activeChurchId.value
  if (!id) return
  loading.value = true
  failed.value = false
  try {
    const [c, a, s, f, open] = await Promise.all([
      fetchMemberCounts(id),
      fetchNeedsAttention(id),
      fetchRecentServices(id, 10),
      fetchMonthFunds(id, now),
      fetchOpenService(id)
    ])
    counts.value = c
    attention.value = a
    services.value = s
    funds.value = f
    openService.value = open
  } catch {
    // The message is deliberately not the error — a PostgREST error quotes the
    // offending row, and a row here is a member.
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => { loadUser(); load() })
watch(activeChurchId, load)

function shortDate (iso) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="ov">
    <!-- Greeting -->
    <header
      class="ov__head anim-rise"
      style="--i: 0"
    >
      <div class="ov__greet">
        <p class="ov__date">
          {{ greetingDate }}
        </p>
        <h1 class="ov__title">
          {{ greeting }}
        </h1>
        <p class="ov__sub">
          {{ activeChurchName }}<template v-if="openService">
            · a service is running right now.
          </template>
        </p>
      </div>
      <Button
        variant="primary"
        size="lg"
        to="/dashboard/attendance"
      >
        Open check-in
      </Button>
    </header>

    <Alert
      v-if="failed"
      tone="danger"
    >
      <strong>The dashboard could not be loaded.</strong>
      Nothing you recorded has been lost.
      <template #action>
        <Button
          size="sm"
          @click="load"
        >
          Try again
        </Button>
      </template>
    </Alert>

    <!-- Live check-in -->
    <Alert
      v-if="openService"
      tone="live"
      pulse
      class="anim-rise"
      style="--i: 1"
    >
      <strong>Check-in is open — {{ openService.label }}</strong>
      {{ presentToday }} recorded so far
      <template #action>
        <Button
          size="sm"
          to="/dashboard/attendance"
        >
          View roster
        </Button>
      </template>
    </Alert>

    <!-- Stat tiles -->
    <div class="ov__tiles">
      <Card
        class="tile anim-rise"
        style="--i: 2"
      >
        <div class="tile__top">
          <span class="tile__label">Active members</span>
          <span class="tile__icon"><Icon
            name="members"
            :size="15"
          /></span>
        </div>
        <p class="tile__figure">
          {{ loading ? '—' : counts.active }}
        </p>
        <p class="tile__note">
          <span
            v-if="counts.joinedThisMonth"
            class="tile__delta"
          >+{{ counts.joinedThisMonth }}</span>
          <span v-if="counts.joinedThisMonth">joined this month ·</span>
          {{ counts.archived }} archived
        </p>
        <div class="tile__track">
          <span
            class="tile__fill anim-grow"
            style="width: 100%"
          />
        </div>
      </Card>

      <Card
        class="tile anim-rise"
        style="--i: 3"
      >
        <div class="tile__top">
          <span class="tile__label">Present, last service</span>
          <span class="tile__icon tile__icon--green"><Icon
            name="attendance"
            :size="15"
          /></span>
        </div>
        <p class="tile__figure">
          {{ loading ? '—' : presentToday }}
        </p>
        <p class="tile__note">
          <span
            v-if="averagePresent"
            class="tile__delta"
            :class="{ 'is-down': presentToday < averagePresent }"
          >{{ presentToday >= averagePresent ? '+' : '' }}{{ Math.round(((presentToday - averagePresent) / averagePresent) * 100) }}%</span>
          vs average of {{ services.length }}
        </p>
        <div class="tile__track">
          <span
            class="tile__fill tile__fill--green anim-grow"
            :style="{ width: `${Math.min(100, (presentToday / peak) * 100)}%` }"
          />
        </div>
      </Card>

      <Card
        v-if="caps.canViewFinance"
        class="tile anim-rise"
        style="--i: 4"
      >
        <div class="tile__top">
          <span class="tile__label">{{ monthLabel }} funds</span>
          <span class="tile__icon"><Icon
            name="funds"
            :size="15"
          /></span>
        </div>
        <p class="tile__figure">
          {{ loading ? '—' : fundsShort }}
        </p>
        <p class="tile__note">
          tithes and offering received
        </p>
        <div class="tile__track">
          <span
            class="tile__fill anim-grow"
            style="width: 100%"
          />
        </div>
      </Card>
    </div>

    <!-- Chart + right column -->
    <div class="ov__split">
      <Card
        class="chart anim-rise"
        style="--i: 5"
      >
        <div class="chart__head">
          <h2 class="chart__title">
            Attendance, last {{ services.length }} services
          </h2>
          <span class="chart__meta">average {{ averagePresent }}</span>
        </div>

        <div
          v-if="services.length"
          class="chart__bars"
        >
          <div
            v-for="(s, i) in services"
            :key="s.id"
            class="bar"
            :style="`--i: ${i}`"
          >
            <span class="bar__value">{{ s.present }}</span>
            <span
              class="bar__col anim-tall"
              :class="{ 'is-latest': i === services.length - 1 }"
              :style="{ height: `${Math.max(4, (s.present / peak) * 100)}%`, '--i': i }"
            />
            <span class="bar__date">{{ shortDate(s.service_date) }}</span>
          </div>
        </div>

        <p
          v-else
          class="chart__empty"
        >
          No services recorded yet.
        </p>
      </Card>

      <div class="ov__aside">
        <Card
          class="attn anim-rise"
          style="--i: 6"
        >
          <h2 class="attn__title">
            Needs attention
          </h2>

          <ul class="attn__list">
            <li class="attn__row">
              <span class="attn__dot attn__dot--magenta" />
              <span class="attn__text">
                <span class="attn__name">One-to-one not started</span>
                <span class="attn__note">Joined more than 90 days ago</span>
              </span>
              <span class="attn__count attn__count--magenta">{{ attention.noOneToOne }}</span>
            </li>

            <li class="attn__row">
              <span class="attn__dot attn__dot--warning" />
              <span class="attn__text">
                <span class="attn__name">Not yet baptized</span>
                <span class="attn__note">Across all age groups</span>
              </span>
              <span class="attn__count attn__count--warning">{{ attention.notBaptized }}</span>
            </li>

            <li class="attn__row">
              <span class="attn__dot attn__dot--accent" />
              <span class="attn__text">
                <span class="attn__name">In no ministry or group</span>
                <span class="attn__note">Nobody is checking in on them</span>
              </span>
              <span class="attn__count attn__count--accent">{{ attention.inNoGroup }}</span>
            </li>
          </ul>
        </Card>

        <Card
          tint="dark"
          class="access anim-rise"
          style="--i: 7"
        >
          <p class="access__eyebrow">
            Your access
          </p>
          <p class="access__body">
            {{ accessSentence }}
          </p>
          <ul class="access__chips">
            <li
              v-for="chip in accessChips"
              :key="chip.label"
            >
              <Badge
                :tone="chip.on ? 'onDark' : 'neutral'"
                class="access__chip"
                :class="{ 'is-off': !chip.on }"
              >
                {{ chip.label }}<template v-if="!chip.on">
                  — no
                </template>
              </Badge>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ov { display: flex; flex-direction: column; gap: var(--sp-16); }

/* --- Greeting --------------------------------------------------------- */
.ov__head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-16); }

.ov__greet { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }

.ov__date {
  font-size: var(--text-eyebrow);
  font-weight: 800;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--accent-text);
}

.ov__title {
  font-size: var(--text-h1);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: var(--leading-h1);
}

.ov__sub { font-size: var(--text-body); color: var(--ink-4); }

/* --- Tiles ------------------------------------------------------------ */
.ov__tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-16); }

.tile { display: flex; flex-direction: column; gap: var(--sp-10); }

.tile__top { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-10); }

.tile__label { font-size: var(--text-body-sm); font-weight: 600; color: var(--ink-4); }

.tile__icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--r-tag);
  background: var(--accent-tint);
  color: var(--accent);
}
.tile__icon--green { background: var(--success-tint); color: var(--success); }

.tile__figure {
  font-size: var(--text-figure);
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.tile__note {
  display: flex;
  align-items: baseline;
  gap: var(--sp-5);
  font-size: var(--text-meta);
  color: var(--ink-5);
}

/* The delta is the only coloured thing in a tile. Green up, magenta down —
   magenta is this design's "worth your attention", not merely its error red. */
.tile__delta { font-weight: 800; color: var(--success); font-variant-numeric: tabular-nums; }
.tile__delta.is-down { color: var(--magenta); }

.tile__track { height: 4px; border-radius: var(--r-pill); background: var(--divider); overflow: hidden; }
.tile__fill { display: block; height: 100%; border-radius: var(--r-pill); background: var(--accent); }
.tile__fill--green { background: var(--success); }

/* --- Split ------------------------------------------------------------ */
.ov__split { display: grid; grid-template-columns: 1.55fr 1fr; gap: var(--sp-16); align-items: start; }

.ov__aside { display: flex; flex-direction: column; gap: var(--sp-16); }

/* --- Chart ------------------------------------------------------------ */
.chart { display: flex; flex-direction: column; gap: var(--sp-18); }

.chart__head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-10); }

.chart__title { font-size: var(--text-h3); font-weight: 800; letter-spacing: var(--tracking-h3); }
.chart__meta { font-size: var(--text-meta); color: var(--ink-5); }

.chart__bars {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: var(--sp-10);
  height: 150px;
}

.bar {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: var(--sp-6);
  align-items: end;
  justify-items: center;
  min-width: 0;
}

.bar__value {
  font-size: var(--text-meta);
  font-weight: 700;
  color: var(--ink-4);
  font-variant-numeric: tabular-nums;
}

.bar__col {
  width: 100%;
  border-radius: var(--r-tag) var(--r-tag) 3px 3px;
  background: var(--divider);
  align-self: end;
}
.bar__col.is-latest { background: linear-gradient(180deg, var(--accent), var(--accent-deep)); }

.bar__date { font-size: var(--text-meta-sm); color: var(--ink-6); white-space: nowrap; }

.chart__empty { font-size: var(--text-body-sm); color: var(--ink-5); }

/* --- Needs attention -------------------------------------------------- */
.attn { display: flex; flex-direction: column; gap: var(--sp-14); }

.attn__title { font-size: var(--text-h3); font-weight: 800; letter-spacing: var(--tracking-h3); }

.attn__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }

.attn__row {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-10);
  padding: var(--sp-12) 0;
  border-bottom: 1px solid var(--divider);
}
.attn__row:last-child { border-bottom: 0; padding-bottom: 0; }
.attn__row:first-child { padding-top: 0; }

.attn__dot { width: 7px; height: 7px; border-radius: var(--r-pill); margin-top: 6px; flex: none; }
.attn__dot--magenta { background: var(--magenta); }
.attn__dot--warning { background: var(--warning); }
.attn__dot--accent  { background: var(--accent); }

.attn__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.attn__name { font-size: var(--text-body-sm); font-weight: 700; color: var(--ink); }
.attn__note { font-size: var(--text-meta); color: var(--ink-5); }

.attn__count {
  font-size: var(--text-body-sm);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.attn__count--magenta { color: var(--magenta); }
.attn__count--warning { color: var(--warning); }
.attn__count--accent  { color: var(--accent-text); }

/* --- Your access ------------------------------------------------------ */
.access { display: flex; flex-direction: column; gap: var(--sp-12); }

.access__eyebrow {
  font-size: var(--text-eyebrow);
  font-weight: 800;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--accent-on-dark);
}

.access__body { font-size: var(--text-body-sm); color: var(--dark-panel-ink-2); line-height: 1.55; }

.access__chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--sp-7); }

.access__chip { font-size: var(--text-meta-sm); }
.access__chip.is-off {
  background: rgba(255, 255, 255, .05);
  color: rgba(255, 255, 255, .45);
}

@media (max-width: 1100px) {
  .ov__split { grid-template-columns: 1fr; }
  .ov__tiles { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 700px) {
  .ov__head { flex-direction: column; align-items: stretch; }
  .ov__tiles { grid-template-columns: 1fr; }
}
</style>
