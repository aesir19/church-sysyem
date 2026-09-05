<script setup>
import Card from '../../components/ui/Card.vue'
import Button from '../../components/ui/Button.vue'
import Badge from '../../components/ui/Badge.vue'
import Icon from '../../components/ui/icons/Icon.vue'
import { RouterLink } from 'vue-router'

defineProps({
  greeting: { type: String, required: true },
  greetingDate: { type: String, required: true },
  churchName: { type: String, required: true },
  counts: { type: Object, required: true },
  attention: { type: Object, required: true },
  items: { type: Array, required: true },
  understaffed: { type: Array, required: true },
  lastService: { type: Object, required: true },
  openService: { type: Object, required: true },
  loading: Boolean, calendarError: Boolean,
})

function dateParts(iso) {
  const d = new Date(iso)
  return {
    dow: d.toLocaleDateString('en-PH', { weekday: 'short' }),
    day: d.getDate(),
    time: d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', ''),
  }
}
function kind(item) {
  if (item.isService) return 'Service'
  if (item.isBirthday) return 'Birthday'
  if (item.isHoliday) return 'Holiday'
  return item.kind?.replace('_', ' ') || 'Event'
}
</script>

<template>
  <div class="runway">
    <header
      class="head anim-rise"
      style="--i:0"
    >
      <div>
        <p class="eyebrow">
          {{ greetingDate }}
        </p>
        <h1>{{ greeting }}</h1>
        <p>{{ churchName }} · Here is the next seven days.</p>
      </div>
      <Button
        variant="primary"
        size="lg"
        to="/dashboard/calendar"
      >
        Open calendar
      </Button>
    </header>

    <div class="layout">
      <main class="main">
        <Card
          class="week anim-rise"
          style="--i:1"
        >
          <div class="section-head">
            <div>
              <p class="section-kicker">
                Coming up
              </p><h2>Next 7 days</h2>
            </div>
            <Badge tone="accent">
              {{ items.length }} scheduled
            </Badge>
          </div>
          <p
            v-if="calendarError"
            class="empty"
          >
            The calendar could not be loaded.
          </p>
          <div
            v-else-if="loading"
            class="skeleton-list"
            aria-label="Loading calendar"
          >
            <span
              v-for="n in 4"
              :key="n"
              class="skeleton"
            />
          </div>
          <ol
            v-else-if="items.length"
            class="timeline"
          >
            <li
              v-for="item in items"
              :key="item.id"
              class="timeline__item"
            >
              <component
                :is="item.to ? RouterLink : 'div'"
                :to="item.to || undefined"
                class="timeline__row"
              >
                <time
                  :datetime="item.starts_at"
                  class="date"
                ><span>{{ dateParts(item.starts_at).dow }}</span><strong>{{ dateParts(item.starts_at).day }}</strong></time>
                <span
                  class="rail"
                  aria-hidden="true"
                ><span /></span>
                <div class="event">
                  <div><span class="event__title">{{ item.title }}</span><span class="event__meta">{{ dateParts(item.starts_at).time }}<template v-if="item.location"> · {{ item.location }}</template></span></div>
                  <Badge tone="neutral">
                    {{ kind(item) }}
                  </Badge>
                </div>
              </component>
            </li>
          </ol>
          <div
            v-else
            class="empty-state"
          >
            <Icon
              name="calendar"
              :size="22"
            /><div><strong>Nothing scheduled yet</strong><p>The next seven days are clear.</p></div>
          </div>
        </Card>

        <Card
          class="roles anim-rise"
          style="--i:2"
        >
          <div class="section-head">
            <div>
              <p class="section-kicker">
                Needs people
              </p><h2>All open event roles</h2>
            </div>
            <span class="muted">draft and published events</span>
          </div>
          <div
            v-if="understaffed.length"
            class="role-list"
          >
            <RouterLink
              v-for="event in understaffed"
              :key="event.id"
              :to="event.to"
              class="role-row"
            >
              <span class="role-date">{{ dateParts(event.starts_at).dow }} {{ dateParts(event.starts_at).day }}</span>
              <span class="role-title"><strong>{{ event.title }}</strong><small><span class="role-state">{{ event.status === 'draft' ? 'Draft' : 'Published' }} · </span>{{ event.filled }} of {{ event.needed }} places filled</small></span>
              <Badge :tone="event.status === 'draft' ? 'neutral' : 'accent'">
                {{ event.status === 'draft' ? 'Draft' : 'Published' }}
              </Badge>
              <Badge tone="warning">
                {{ event.gap }} open
              </Badge>
              <Icon
                name="chevronRight"
                :size="16"
              />
            </RouterLink>
          </div>
          <p
            v-else
            class="empty"
          >
            No upcoming events need people.
          </p>
        </Card>
      </main>

      <aside class="aside">
        <Card
          class="pulse-card anim-rise"
          style="--i:2"
        >
          <p class="section-kicker">
            Church pulse
          </p>
          <div class="pulse-stat">
            <span>Active members</span><strong>{{ loading ? '—' : counts.active }}</strong><small>{{ counts.joinedThisMonth || 0 }} joined this month</small>
          </div>
          <div class="divider" />
          <div class="pulse-stat pulse-stat--accent">
            <span>Last attendance</span><strong>{{ loading ? '—' : (lastService?.present || 0) }}</strong><small>{{ lastService?.label || 'No service recorded' }}<template v-if="lastService?.service_date"> · {{ new Date(lastService.service_date).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' }) }}</template></small>
          </div>
          <Button
            v-if="openService"
            variant="primary"
            block
            to="/dashboard/attendance"
          >
            Open check-in
          </Button>
          <Button
            v-else
            variant="secondary"
            block
            to="/dashboard/attendance"
          >
            View attendance
          </Button>
        </Card>

        <Card
          class="attention anim-rise"
          style="--i:3"
        >
          <div class="section-head">
            <h2>Needs attention</h2>
          </div>
          <ul>
            <li><span>One-to-one not started</span><strong>{{ attention.noOneToOne }}</strong></li>
            <li><span>Not yet baptized</span><strong>{{ attention.notBaptized }}</strong></li>
            <li><span>In no ministry or group</span><strong>{{ attention.inNoGroup }}</strong></li>
          </ul>
        </Card>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.runway { display:flex; flex-direction:column; gap:var(--sp-16); }
.head { display:flex; align-items:flex-end; justify-content:space-between; gap:var(--sp-16); }
.head h1 { font-size:var(--text-h1); font-weight:800; letter-spacing:var(--tracking-h1); }
.head p:last-child { color:var(--ink-4); }
.eyebrow,.section-kicker { color:var(--accent-text); font-size:var(--text-eyebrow); font-weight:800; letter-spacing:var(--tracking-eyebrow); text-transform:uppercase; }
.layout { display:grid; grid-template-columns:minmax(0,1.65fr) minmax(260px,.7fr); gap:var(--sp-16); align-items:start; }
.main,.aside { display:flex; flex-direction:column; gap:var(--sp-16); }
.section-head { display:flex; align-items:center; justify-content:space-between; gap:var(--sp-12); }
.section-head h2 { margin-top:2px; font-size:var(--text-h3); font-weight:800; }
.muted,.empty { color:var(--ink-5); font-size:var(--text-meta); }
.week { display:flex; flex-direction:column; gap:var(--sp-16); }
.timeline { list-style:none; margin:0; padding:0; }
.timeline__row { display:grid; grid-template-columns:42px 16px minmax(0,1fr); min-height:62px; color:inherit; text-decoration:none; border-radius:var(--r-tag); }
a.timeline__row:hover { background:var(--surface-subtle-2); }
a.timeline__row:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.date { display:flex; flex-direction:column; align-items:center; line-height:1.05; color:var(--ink-4); }
.date span { font-size:var(--text-meta-sm); font-weight:800; text-transform:uppercase; }
.date strong { margin-top:4px; font-size:var(--text-h3); color:var(--ink); }
.rail { position:relative; display:flex; justify-content:center; }
.rail::after { content:''; position:absolute; top:18px; bottom:-8px; width:1px; background:var(--divider); }
.timeline__item:last-child .rail::after { display:none; }
.rail span { position:relative; z-index:1; width:8px; height:8px; margin-top:12px; border:2px solid var(--surface); border-radius:50%; background:var(--accent); box-shadow:0 0 0 2px var(--accent-border); }
.event { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:var(--sp-10); align-items:center; padding:0 0 var(--sp-12) var(--sp-8); }
.event>div { display:flex; flex-direction:column; min-width:0; }
.event__title { color:var(--ink); font-size:var(--text-body-sm); font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.event__meta { color:var(--ink-5); font-size:var(--text-meta); }
.role-list { margin-top:var(--sp-10); }
.role-row { display:grid; grid-template-columns:62px 1fr auto auto 18px; gap:var(--sp-10); align-items:center; min-height:56px; padding:var(--sp-8) 0; border-bottom:1px solid var(--divider); color:inherit; text-decoration:none; }
.role-row:last-child { border-bottom:0; }
.role-row:hover .role-title strong { color:var(--accent-text); }
.role-date { color:var(--ink-5); font-size:var(--text-meta); font-weight:700; }
.role-title { display:flex; flex-direction:column; min-width:0; }
.role-title strong { color:var(--ink); font-size:var(--text-body-sm); }
.role-title small { color:var(--ink-5); font-size:var(--text-meta); }
.role-state { display:none; }
.pulse-card { display:flex; flex-direction:column; gap:var(--sp-14); }
.pulse-stat { display:grid; grid-template-columns:1fr auto; gap:2px var(--sp-10); }
.pulse-stat span { color:var(--ink-4); font-size:var(--text-body-sm); font-weight:600; }
.pulse-stat strong { grid-row:1/3; grid-column:2; align-self:center; color:var(--ink); font-size:2rem; line-height:1; font-variant-numeric:tabular-nums; }
.pulse-stat small { color:var(--ink-5); font-size:var(--text-meta); }
.pulse-stat--accent strong { color:var(--accent-text); }
.divider { height:1px; background:var(--divider); }
.attention ul { list-style:none; margin:var(--sp-10) 0 0; padding:0; }
.attention li { display:flex; justify-content:space-between; gap:var(--sp-10); padding:var(--sp-10) 0; border-bottom:1px solid var(--divider); font-size:var(--text-body-sm); }
.attention li:last-child { border-bottom:0; }
.attention strong { color:var(--magenta); font-variant-numeric:tabular-nums; }
.skeleton-list { display:grid; gap:var(--sp-10); }
.skeleton-list span { display:block; height:50px; }
.empty-state { display:flex; gap:var(--sp-10); align-items:center; padding:var(--sp-16); border-radius:var(--r-inset); background:var(--surface-subtle); color:var(--ink-5); }
.empty-state strong { color:var(--ink-2); }
@media (max-width:900px) { .layout { grid-template-columns:1fr; } .aside { display:grid; grid-template-columns:1fr 1fr; } }
@media (max-width:640px) { .head { align-items:flex-start; flex-direction:column; } .aside { display:flex; } .event { grid-template-columns:1fr auto; } .event .btn { display:none; } .role-row { grid-template-columns:52px 1fr auto; } .role-row>.badge--accent,.role-row>.badge--neutral,.role-row>svg { display:none; } .role-state { display:inline; } }
</style>
