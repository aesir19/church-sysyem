<script setup>
// The D-Group leader view (docs/specs/d-group-leader-view.md, Phase 1; mockups 13a–13f2).
// Reads only. Member figures come from d_group_dashboard() (0055), which is scoped in the
// database to the groups the signed-in person leads; the church section is the same
// calendar read the Overview uses, narrowed to services and events.
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import Card from '../../components/ui/Card.vue'
import Badge from '../../components/ui/Badge.vue'
import Button from '../../components/ui/Button.vue'
import Alert from '../../components/ui/Alert.vue'
import GroupMeetingsCard from '../../components/groups/GroupMeetingsCard.vue'
import GroupMeetingForm from '../../components/groups/GroupMeetingForm.vue'
import GroupMeetingDialogs from '../../components/groups/GroupMeetingDialogs.vue'
import { useActiveChurch } from '../../composables/useActiveChurch'
import { showToast } from '../../composables/useToast'
import { listGroupMeetings } from '../../lib/data/groupMeetings'
import { fetchDGroupDashboard, summarizeDGroup } from '../../lib/data/dGroup'
import { listServiceOccurrences } from '../../lib/data/events'
import { listCalendarOccurrences } from '../../lib/data/eventSeries'
import { slugify } from '../../lib/data/group'
import { addDays } from '../../lib/recurrence'
import { dayMonth as formatDayMonth } from '../../utils/dayMonth'

const dayMonth = d => formatDayMonth(d)
const dayMonthLong = d => formatDayMonth(d, { long: true })

const { activeChurchId, activeChurchName } = useActiveChurch()

const loading = ref(true)
const failed = ref(false)
const dashboard = ref({ groups: [], services: [], members: [] })
const groupId = ref(null)
const churchItems = ref([])
const churchFailed = ref(false)
// Phase 2: the group's own meetings (0056), and the form and dialogs that change them.
const meetings = ref([])
const meetingsLoading = ref(true)
const meetingsFailed = ref(false)
const form = ref({ open: false, mode: 'create', meeting: null })
const action = ref(null)
let generation = 0

const view = computed(() => summarizeDGroup(dashboard.value, { groupId: groupId.value }))
const groups = computed(() => dashboard.value.groups)
const multi = computed(() => groups.value.length > 1)
const shownGroups = computed(() => groupId.value ? groups.value.filter(g => g.id === groupId.value) : groups.value)
const memberCount = computed(() => view.value.progress.total)
const countFor = id => new Set(dashboard.value.members.filter(m => m.groupId === id).map(m => m.id)).size

const TZ = 'Asia/Manila'
const fmt = (value, opts) => new Date(value).toLocaleDateString('en-PH', { timeZone: TZ, ...opts })
const weekday = d => fmt(d, { weekday: 'short' })
const time = d => new Date(d).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })
const firstName = name => name.split(' ')[0]
const joinNames = names => names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

const title = computed(() => {
  if (shownGroups.value.length === 1) return shownGroups.value[0].name
  return joinNames(shownGroups.value.map(g => g.name))
})

const subtitle = computed(() => {
  const n = memberCount.value
  const members = `${n} member${n === 1 ? '' : 's'}`
  if (shownGroups.value.length > 1) return `${members} across ${shownGroups.value.length} groups`
  const started = shownGroups.value[0]?.startedAt
  if (started && Date.now() - Date.parse(started) < 30 * 86_400_000) return `${members} · started ${dayMonthLong(started)}`
  return `${members} · you lead this group`
})

const weekLabel = computed(() => {
  const { from, to } = view.value.week
  return `${weekday(from)} ${fmt(from, { day: 'numeric' })} – ${weekday(to)} ${dayMonth(to)}`
})

// Joins on the same day read as one line ("Paolo Lim and Rhea Sy"), as in 13f2.
const thisWeek = computed(() => {
  const out = []
  for (const item of view.value.thisWeek) {
    const prev = out.at(-1)
    if (item.kind === 'joined' && prev?.kind === 'joined' && dayMonth(prev.date) === dayMonth(item.date)) {
      prev.names.push(item.name)
      continue
    }
    out.push({ ...item, names: [item.name] })
  }
  return out
})

function weekText (item) {
  const group = multi.value && !groupId.value ? ` · ${item.groupName}` : ''
  if (item.kind === 'serving') return `${firstName(item.name)} · ${item.role}${group}`
  return `${joinNames(item.names)}${group}`
}
function weekWhen (item) {
  if (item.kind === 'serving') return weekday(item.date)
  if (item.kind === 'birthday') return `${weekday(item.date)} ${dayMonth(item.date)}`
  return dayMonth(item.date)
}

const noServiceYet = computed(() => !view.value.lastSunday || view.value.lastSunday.of === 0)
// Check on needs two Sunday services after joining before it can flag anyone.
const checkOnTooEarly = computed(() =>
  view.value.rows.every(m => m.attendance.filter(a => a.status !== 'not_in_group').length < 2))

const pct = n => memberCount.value ? Math.round((n / memberCount.value) * 100) : 0
const servedText = n => n === 0 ? 'Not served in the last 3 months' : `Served ${n} time${n === 1 ? '' : 's'} in the last 3 months`
const missedText = dates => `Missed Sunday service ${joinNames(dates.map(dayMonth))}`
const STATUS_LABEL = { present: 'present', missed: 'missed', not_in_group: 'not yet in group' }

function memberSub (m) {
  const parts = []
  if (multi.value || !m.isNewJoiner) parts.push(m.groupName)
  if (m.isNewJoiner) parts.push(`joined ${dayMonth(m.joinedAt)}`)
  return parts.join(' · ')
}

// Null until the church name is in: the group page's path needs it, and the router
// refuses a link without it.
function groupLink (name) {
  const church = slugify(activeChurchName.value || '')
  if (!church || !name) return null
  return { name: 'GroupDetail', params: { church, group: slugify(name) } }
}

async function load () {
  const g = ++generation
  loading.value = true
  failed.value = false
  churchFailed.value = false
  const churchId = activeChurchId.value
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  const to = addDays(from, 7)

  const [d, events, services] = await Promise.all([
    fetchDGroupDashboard(),
    churchId ? listCalendarOccurrences({ churchId, from: from.toISOString(), to: to.toISOString() }) : Promise.resolve({ ok: true, items: [] }),
    churchId ? listServiceOccurrences({ churchId, from: from.toISOString(), to: to.toISOString() }).catch(() => []) : Promise.resolve([])
  ])
  if (g !== generation) return

  failed.value = !d.ok
  dashboard.value = d.ok ? d : { groups: [], services: [], members: [] }
  if (groupId.value && !dashboard.value.groups.some(x => x.id === groupId.value)) groupId.value = null
  churchFailed.value = !events.ok
  churchItems.value = [...(events.ok ? events.items : []), ...services]
    // Toned down: what the church has published, never another team's drafts — and never
    // a Group meeting, which the leader can see (0056) but is not a church event.
    .filter(item => (item.isService || item.status === 'published') && item.kind !== 'group_meeting')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  loading.value = false
  loadMeetings()
}

async function loadMeetings () {
  const ids = dashboard.value.groups.map(x => x.id)
  meetingsLoading.value = true
  const r = await listGroupMeetings({ groupIds: ids })
  meetingsFailed.value = !r.ok
  meetings.value = r.meetings
  meetingsLoading.value = false
}

const shownMeetings = computed(() => groupId.value ? meetings.value.filter(m => m.groupId === groupId.value) : meetings.value)
const groupNames = computed(() => Object.fromEntries(groups.value.map(x => [x.id, x.name])))

function openForm (mode = 'create', meeting = null) {
  form.value = { open: true, mode, meeting }
}
function onMeetingAction ({ kind, meeting }) {
  if (kind === 'edit' || kind === 'from-here') openForm(kind, meeting)
  else action.value = { kind, meeting }
}
function onMeetingSaved (message) {
  showToast(message)
  loadMeetings()
}

onMounted(load)
watch(activeChurchId, load)
</script>

<template>
  <div class="dg">
    <header
      class="dg-head anim-rise"
      style="--i:0"
    >
      <Button
        v-if="!loading && groups.length"
        class="dg-head__add"
        variant="primary"
        @click="openForm()"
      >
        + Group meeting
      </Button>
      <p class="eyebrow">
        {{ multi && !groupId ? 'My D-Groups' : 'My D-Group' }}
      </p>
      <h1>{{ loading ? 'My D-Group' : title }}</h1>
      <p v-if="!loading && groups.length">
        {{ subtitle }}
      </p>
    </header>

    <Alert
      v-if="failed"
      tone="danger"
    >
      Your D-Group could not be loaded. Please try again.
    </Alert>

    <div
      v-if="multi"
      class="filter"
      role="tablist"
      aria-label="Show group"
    >
      <span class="filter__label">Show</span>
      <div class="seg">
        <button
          type="button"
          role="tab"
          class="seg__opt"
          :class="{ 'is-on': !groupId }"
          :aria-selected="!groupId"
          @click="groupId = null"
        >
          All groups · {{ new Set(dashboard.members.map(m => m.id)).size }}
        </button>
        <button
          v-for="g in groups"
          :key="g.id"
          type="button"
          role="tab"
          class="seg__opt"
          :class="{ 'is-on': groupId === g.id }"
          :aria-selected="groupId === g.id"
          @click="groupId = g.id"
        >
          {{ g.name }} · {{ countFor(g.id) }}
        </button>
      </div>
    </div>

    <div class="layout">
      <main class="main">
        <div
          v-if="loading"
          class="skeleton-list"
          aria-label="Loading your D-Group"
        >
          <span
            v-for="n in 3"
            :key="n"
            class="skeleton"
          />
        </div>

        <Card
          v-else-if="!failed && !groups.length"
          class="empty-card"
        >
          <strong>You don't lead a D-Group</strong>
          <p>Once you're assigned as a D-Group leader, your group shows here.</p>
        </Card>

        <Card
          v-else-if="!failed && memberCount === 0"
          class="empty-card anim-rise"
          style="--i:1"
        >
          <strong>No members in this group yet</strong>
          <p>Once members are added on the group page, this view fills in: who was at Sunday service, who to check on, birthdays and serving this week, and discipleship progress.</p>
          <div>
            <Button
              v-if="groupLink(shownGroups[0]?.name)"
              variant="secondary"
              :to="groupLink(shownGroups[0]?.name)"
            >
              Open group page
            </Button>
          </div>
        </Card>

        <template v-else-if="!failed">
          <div class="pair o-pair">
            <Card
              class="anim-rise"
              style="--i:1"
            >
              <h2>Sunday attendance</h2>
              <template v-if="!noServiceYet">
                <p class="big">
                  {{ view.lastSunday.present }} of {{ view.lastSunday.of }}
                </p>
                <p class="muted">
                  at the last recorded service · {{ dayMonth(view.lastSunday.date) }}
                </p>
                <p
                  v-if="view.staleSince"
                  class="stale"
                >
                  No attendance recorded since {{ dayMonth(view.staleSince) }}.
                </p>
                <template v-if="view.lastSunday.notThere.length">
                  <p class="label">
                    Not there
                  </p>
                  <ul class="chips">
                    <li
                      v-for="name in view.lastSunday.notThere"
                      :key="name"
                    >
                      {{ name }}
                    </li>
                  </ul>
                </template>
              </template>
              <p
                v-else
                class="muted note"
              >
                No Sunday service since this group started. The first count shows after Sunday, {{ dayMonthLong(view.nextSunday) }}.
              </p>
            </Card>

            <Card
              class="check anim-rise"
              style="--i:2"
            >
              <h2>Check on</h2>
              <p class="muted">
                Missed 2 or more of the last 4 Sunday services since joining.
              </p>
              <p
                v-if="view.staleSince && view.checkOn.length"
                class="stale"
              >
                No attendance recorded since {{ dayMonth(view.staleSince) }}, so these absences may be out of date.
              </p>
              <ul
                v-if="view.checkOn.length"
                class="check__list"
              >
                <li
                  v-for="m in view.checkOn"
                  :key="m.id + m.groupName"
                >
                  <strong>{{ m.name }}<template v-if="multi && !groupId"> · {{ m.groupName }}</template></strong>
                  <span>{{ missedText(m.missedDates) }}</span>
                </li>
              </ul>
              <p
                v-else
                class="muted note"
              >
                {{ checkOnTooEarly ? 'Nobody yet — this needs at least two Sunday services after a member joins.' : 'Nobody to check on right now.' }}
              </p>
            </Card>
          </div>

          <Card
            class="o-week anim-rise"
            style="--i:3"
          >
            <div class="section-head">
              <h2>This week</h2>
              <span class="muted">{{ weekLabel }}</span>
            </div>
            <ul
              v-if="thisWeek.length"
              class="week"
            >
              <li
                v-for="(item, i) in thisWeek"
                :key="item.kind + item.id + i"
              >
                <span
                  class="kind"
                  :class="`kind--${item.kind}`"
                >{{ item.kind }}</span>
                <span class="week__text">{{ weekText(item) }}</span>
                <span class="muted">{{ weekWhen(item) }}</span>
              </li>
            </ul>
            <p
              v-else
              class="muted note"
            >
              No birthdays, serving or new members this week.
            </p>
            <p class="muted foot">
              New members are shown for 30 days after they join.
            </p>
          </Card>

          <Card
            class="o-progress anim-rise"
            style="--i:4"
          >
            <div class="section-head">
              <h2>Discipleship progress</h2>
              <span class="muted">Recorded on the group page</span>
            </div>
            <div class="progress">
              <div
                v-for="p in [['Baptized', view.progress.baptized], ['One-to-one started', view.progress.oneToOne], ['Turning point', view.progress.turningPoint]]"
                :key="p[0]"
              >
                <span class="label">{{ p[0] }}</span>
                <strong>{{ p[1] }} of {{ memberCount }}</strong>
                <span class="bar"><span :style="{ width: pct(p[1]) + '%' }" /></span>
              </div>
            </div>
          </Card>

          <Card
            class="o-members anim-rise"
            style="--i:5"
          >
            <div class="section-head">
              <h2>My members</h2>
              <span class="legend muted">
                <span><i class="dot dot--present" /> present</span>
                <span><i class="dot dot--missed" /> missed</span>
                <span><i class="dot dot--not_in_group" /> not yet in group</span>
              </span>
            </div>
            <p class="muted">
              Last 4 Sunday services, oldest first · tap a member to open the group page
            </p>
            <ul class="members">
              <li
                v-for="m in view.rows"
                :key="m.id + m.groupId"
              >
                <component
                  :is="groupLink(m.groupName) ? RouterLink : 'div'"
                  :to="groupLink(m.groupName) || undefined"
                  class="member"
                >
                  <span class="member__name"><strong>{{ m.name }}</strong><small>{{ memberSub(m) }}</small></span>
                  <span
                    class="dots"
                    :aria-label="m.attendance.map(a => STATUS_LABEL[a.status]).join(', ')"
                  >
                    <i
                      v-for="a in m.attendance"
                      :key="a.serviceId"
                      class="dot"
                      :class="`dot--${a.status}`"
                    />
                  </span>
                  <span class="member__served">{{ servedText(m.servedRecent) }}</span>
                  <span class="badges">
                    <Badge
                      v-if="m.isBaptized"
                      tone="accent"
                    >Baptized</Badge>
                    <Badge
                      v-if="m.isOneToOneCompleted"
                      tone="accent"
                    >One-to-one</Badge>
                    <Badge
                      v-if="m.isTurningPointCompleted"
                      tone="accent"
                    >Turning point</Badge>
                  </span>
                </component>
              </li>
            </ul>
          </Card>
        </template>
      </main>

      <aside class="aside">
        <GroupMeetingsCard
          v-if="groups.length"
          class="o-meetings anim-rise"
          style="--i:2"
          :meetings="shownMeetings"
          :group-names="groupNames"
          :show-group="multi && !groupId"
          :loading="meetingsLoading"
          :failed="meetingsFailed"
          @add="openForm()"
          @action="onMeetingAction"
        />
        <Card
          class="church o-church anim-rise"
          style="--i:2"
        >
          <div class="section-head">
            <h2>Church · next 7 days</h2>
            <RouterLink
              to="/dashboard/calendar"
              class="link"
            >
              Calendar →
            </RouterLink>
          </div>
          <p
            v-if="churchFailed"
            class="muted note"
          >
            The calendar could not be loaded.
          </p>
          <ul
            v-else-if="churchItems.length"
            class="church__list"
          >
            <li
              v-for="item in churchItems"
              :key="item.id + item.starts_at"
            >
              <span>{{ weekday(item.starts_at) }} {{ fmt(item.starts_at, { day: 'numeric' }) }}</span>
              <span>{{ item.title }} · {{ time(item.starts_at) }}</span>
            </li>
          </ul>
          <p
            v-else-if="!loading"
            class="muted note"
          >
            Nothing scheduled in the next seven days.
          </p>
        </Card>
      </aside>
    </div>

    <GroupMeetingForm
      v-model:open="form.open"
      :mode="form.mode"
      :meeting="form.meeting"
      :groups="groupId ? shownGroups : groups"
      :default-group-id="groupId || groups[0]?.id || null"
      :church-id="activeChurchId"
      @saved="onMeetingSaved"
    />
    <GroupMeetingDialogs
      :action="action"
      @close="action = null"
      @saved="onMeetingSaved"
    />
  </div>
</template>

<style scoped>
.dg { display:flex; flex-direction:column; gap:var(--sp-16); }
.dg-head h1 { font-size:var(--text-h1); font-weight:800; letter-spacing:var(--tracking-h1); }
.dg-head p:last-child { color:var(--ink-4); }
.eyebrow { color:var(--accent-text); font-size:var(--text-eyebrow); font-weight:800; letter-spacing:var(--tracking-eyebrow); text-transform:uppercase; }
.layout { display:grid; grid-template-columns:minmax(0,1.65fr) minmax(260px,.7fr); gap:var(--sp-16); }
.main,.aside { display:flex; flex-direction:column; gap:var(--sp-16); }
/* Side by side only when each card gets 240px; the main column is narrow beside the sidebar and the rail. */
.pair { display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:var(--sp-16); }
h2 { font-size:var(--text-h3); font-weight:800; color:var(--ink); }
.section-head { display:flex; align-items:baseline; justify-content:space-between; gap:var(--sp-12); flex-wrap:wrap; }
.muted { color:var(--ink-5); font-size:var(--text-meta); }
.note { margin-top:var(--sp-10); }
.stale { margin-top:var(--sp-8); padding:6px 10px; border:1px solid var(--warning-border); border-radius:var(--r-tag); background:var(--warning-tint); color:var(--warning-deep); font-size:var(--text-meta); font-weight:600; }
.foot { margin-top:var(--sp-8); }
.label { display:block; color:var(--ink-5); font-size:var(--text-meta); margin-top:var(--sp-12); }
.big { margin-top:var(--sp-10); color:var(--ink); font-size:2rem; font-weight:800; line-height:1; font-variant-numeric:tabular-nums; }
.chips { display:flex; flex-wrap:wrap; gap:var(--sp-6); list-style:none; margin:var(--sp-8) 0 0; padding:0; }
.chips li { padding:4px 10px; border-radius:999px; background:var(--surface-subtle-2); color:var(--ink-2); font-size:var(--text-meta); font-weight:600; }
.check { border-color:var(--magenta-border); }
.check__list { list-style:none; margin:var(--sp-10) 0 0; padding:0; }
.check__list li { display:flex; flex-direction:column; gap:2px; padding:var(--sp-10) 0 var(--sp-10) var(--sp-16); border-top:1px solid var(--divider); position:relative; }
.check__list li::before { content:''; position:absolute; left:2px; top:17px; width:6px; height:6px; border-radius:50%; background:var(--magenta); }
.check__list strong { color:var(--ink); font-size:var(--text-body-sm); }
.check__list span { color:var(--ink-4); font-size:var(--text-meta); }
.week { list-style:none; margin:var(--sp-10) 0 0; padding:0; }
.week li { display:grid; grid-template-columns:88px 1fr auto; gap:var(--sp-10); align-items:center; padding:var(--sp-10) 0; border-top:1px solid var(--divider); }
.kind { font-size:var(--text-meta-sm); font-weight:800; letter-spacing:var(--tracking-eyebrow); text-transform:uppercase; color:var(--ink-4); }
.kind--birthday { color:var(--magenta); }
.kind--serving { color:var(--accent-text); }
.week__text { color:var(--ink); font-size:var(--text-body-sm); font-weight:600; }
/* The three columns share rows (subgrid), so a label that wraps on a phone
   ("One-to-one started") cannot push its number and bar below the others. */
.progress { display:grid; grid-template-columns:repeat(3,1fr); grid-template-rows:auto auto auto; column-gap:var(--sp-16); margin-top:var(--sp-12); }
.progress > div { display:grid; grid-row:span 3; grid-template-rows:subgrid; row-gap:0; }
.progress strong { display:block; color:var(--ink); font-size:1.4rem; font-weight:800; font-variant-numeric:tabular-nums; }
.progress .label { margin-top:0; align-self:end; }
.bar { display:block; height:4px; margin-top:var(--sp-6); border-radius:999px; background:var(--divider); overflow:hidden; }
.bar span { display:block; height:100%; background:var(--accent); }
.legend { display:flex; gap:var(--sp-10); align-items:center; }
.legend span { display:inline-flex; align-items:center; gap:4px; }
.members { list-style:none; margin:var(--sp-10) 0 0; padding:0; }
.member { display:grid; grid-template-columns:minmax(120px,1.1fr) 72px minmax(0,1.2fr) minmax(0,1.3fr); gap:var(--sp-12); align-items:center; padding:var(--sp-12) 0; border-top:1px solid var(--divider); color:inherit; text-decoration:none; border-radius:var(--r-tag); }
.member:hover strong { color:var(--accent-text); }
.member:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.member__name { display:flex; flex-direction:column; min-width:0; }
.member__name strong { color:var(--ink); font-size:var(--text-body-sm); }
.member__name small,.member__served { color:var(--ink-5); font-size:var(--text-meta); }
.badges { display:flex; flex-wrap:wrap; gap:var(--sp-6); }
.dots { display:flex; gap:5px; }
.dot { display:inline-block; width:10px; height:10px; border-radius:50%; }
.dot--present { background:var(--accent); }
.dot--missed { border:1.5px solid var(--border-strong); }
.dot--not_in_group { width:10px; height:2px; border-radius:1px; background:var(--border-strong); align-self:center; }
.church h2 { font-size:var(--text-body); color:var(--ink-2); }
.link { color:var(--accent-text); font-size:var(--text-meta); font-weight:700; text-decoration:none; }
.church__list { list-style:none; margin:var(--sp-8) 0 0; padding:0; }
.church__list li { display:grid; grid-template-columns:56px 1fr; gap:var(--sp-10); padding:var(--sp-8) 0; border-top:1px solid var(--divider); color:var(--ink-4); font-size:var(--text-meta); }
.church__list li:first-child { border-top:0; }
.empty-card { display:flex; flex-direction:column; gap:var(--sp-8); }
.empty-card strong { color:var(--ink); }
.empty-card p { color:var(--ink-4); font-size:var(--text-body-sm); }
.filter { display:flex; align-items:center; gap:var(--sp-10); flex-wrap:wrap; }
.filter__label { color:var(--ink-5); font-size:var(--text-meta); font-weight:700; }
.seg { display:flex; flex-wrap:wrap; gap:3px; padding:3px; border-radius:var(--r-control); background:var(--surface-subtle-2); }
.seg__opt { padding:7px 13px; border:none; background:none; border-radius:var(--r-inset); font-weight:700; font-size:var(--text-meta); color:var(--ink-5); cursor:pointer; }
.seg__opt.is-on { background:var(--surface); color:var(--ink); box-shadow:0 1px 2px rgba(16,24,40,.1); }
.skeleton-list { display:grid; gap:var(--sp-10); }
.skeleton-list span { display:block; height:120px; }
/* Keyed to the main column's own width, not the window's: beside the sidebar and the
   rail it can be phone-narrow on a laptop. Named, because in one column .main stops
   being a box (display: contents) and the rows fall back to the page's width.
   Declared before the one-column rules below, which switch .main off. */
.dg { container:dgmain / inline-size; }
.main { container:dgmain / inline-size; }
.dg-head { position:relative; }
.dg-head__add { position:absolute; right:0; bottom:0; }
/* One column: the two columns flatten into one list and each card takes its place —
   Group meetings right after This week, since it is what a leader manages most. */
@media (max-width:900px) {
  .layout { display:flex; flex-direction:column; }
  /* A display:contents box can't be measured, so it must stop being the container too. */
  .main,.aside { display:contents; container-type:normal; }
  .o-pair { order:1; } .o-week { order:2; } .o-meetings { order:3; }
  .o-progress { order:4; } .o-members { order:5; } .o-church { order:6; }
}
@media (max-width:640px) {
  .dg-head h1 { font-size:var(--text-h2); }
  .dg-head__add { position:static; margin-bottom:var(--sp-10); }
}
@container dgmain (max-width:560px) {
  .progress { column-gap:var(--sp-10); }
  .member { grid-template-columns:1fr auto; }
  .member__served { grid-column:1 / -1; }
  .badges { grid-column:1 / -1; }
  .legend { flex-wrap:wrap; }
}
</style>
