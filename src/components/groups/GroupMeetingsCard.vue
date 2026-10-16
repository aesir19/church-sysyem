<script setup>
// The Group meetings card on the D-Group view (mockup 13g; docs/specs/d-group-leader-view.md,
// Phase 2). Lists what cardMeetings() picks — each repeating meeting at its next date,
// upcoming one-offs, then the recent past — with the ⋯ menu meetingMenu() allows (13i).
// It only draws and reports choices; the D-Group view opens the dialogs and saves.
import { computed } from 'vue'
import Card from '../ui/Card.vue'
import Badge from '../ui/Badge.vue'
import OverflowMenu from '../ui/OverflowMenu.vue'
import { cardMeetings, meetingActions, pastLabel } from '../../lib/data/groupMeetings'

const props = defineProps({
  meetings: { type: Array, required: true },
  // Map of group id → name; a row names its group only when there are several.
  groupNames: { type: Object, required: true },
  showGroup: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  failed: { type: Boolean, default: false },
  now: { type: Date, default: () => new Date() }
})
const emit = defineEmits(['add', 'action'])

const TZ = 'Asia/Manila'
const part = (iso, opts) => new Date(iso).toLocaleString('en-PH', { timeZone: TZ, ...opts })
const time = iso => part(iso, { hour: 'numeric', minute: '2-digit', hour12: true })

const rows = computed(() => cardMeetings(props.meetings, props.now).map(m => {
  const past = Date.parse(m.startsAt) <= props.now.getTime()
  return {
    ...m,
    past,
    dow: part(m.startsAt, { weekday: 'short' }).toUpperCase(),
    day: part(m.startsAt, { day: 'numeric' }),
    menu: menuItems(m)
  }
}))

function menuItems (m) {
  return meetingActions(m, props.now).map(a => ({
    key: a.kind, label: a.label, danger: a.danger, disabled: a.disabled, note: a.note, dividerBefore: a.dividerBefore,
    onSelect: () => emit('action', { kind: a.kind, meeting: m })
  }))
}

function detail (m) {
  if (m.past) return pastLabel(m, props.now)
  return [time(m.startsAt), m.location].filter(Boolean).join(' · ')
}
</script>

<template>
  <Card class="meetings">
    <div class="meetings__head">
      <h2>Group meetings</h2>
      <button
        type="button"
        class="link"
        @click="emit('add')"
      >
        + Add
      </button>
    </div>
    <p class="muted">
      Seen only by this group's members and leaders, the Events team and Super Admin.
    </p>

    <p
      v-if="failed"
      class="muted note"
    >
      Group meetings could not be loaded. Please try again.
    </p>
    <p
      v-else-if="loading"
      class="muted note"
    >
      Loading meetings…
    </p>
    <p
      v-else-if="!rows.length"
      class="muted note"
    >
      No meetings yet. Add your group's first one.
    </p>
    <ul
      v-else
      class="meetings__list"
    >
      <li
        v-for="m in rows"
        :key="m.id"
        class="meeting"
        :class="{ 'meeting--past': m.past }"
      >
        <span class="meeting__date"><small>{{ m.dow }}</small><strong>{{ m.day }}</strong></span>
        <span class="meeting__body">
          <strong>{{ m.title }}</strong>
          <span>{{ detail(m) }}</span>
          <small v-if="m.past">Past — can be cancelled, not deleted</small>
          <small v-else>{{ m.repeatText || 'One-off' }}<template v-if="showGroup"> · {{ groupNames[m.groupId] }}</template></small>
          <Badge
            v-if="!m.past && m.status === 'cancelled'"
            tone="magenta"
          >Cancelled</Badge>
        </span>
        <OverflowMenu
          :items="m.menu"
          label="Meeting actions"
        />
      </li>
    </ul>
  </Card>
</template>

<style scoped>
.meetings__head { display:flex; align-items:baseline; justify-content:space-between; gap:var(--sp-12); }
h2 { font-size:var(--text-h3); font-weight:800; color:var(--ink); }
.muted { color:var(--ink-5); font-size:var(--text-meta); margin-top:4px; }
.note { margin-top:var(--sp-10); }
.link { border:0; background:none; padding:0; color:var(--accent-text); font:inherit; font-size:var(--text-meta); font-weight:700; cursor:pointer; }
.link:focus-visible { outline:var(--ring-focus); outline-offset:2px; }
.meetings__list { list-style:none; margin:var(--sp-10) 0 0; padding:0; }
.meeting { display:grid; grid-template-columns:44px minmax(0,1fr) auto; gap:var(--sp-12); align-items:start; padding:var(--sp-12) 0; border-top:1px solid var(--divider); }
.meeting__date { display:flex; flex-direction:column; align-items:center; padding:6px 0; border-radius:var(--r-inset); background:var(--accent-tint); line-height:1.1; }
.meeting__date small { font-size:var(--text-meta-sm); font-weight:800; color:var(--accent-text); }
.meeting__date strong { font-size:var(--text-h3); font-weight:800; color:var(--accent-text); }
.meeting--past .meeting__date { background:var(--surface-subtle-2); }
.meeting--past .meeting__date small,.meeting--past .meeting__date strong { color:var(--ink-5); }
.meeting__body { display:flex; flex-direction:column; gap:2px; min-width:0; }
.meeting__body strong { color:var(--ink); font-size:var(--text-body-sm); }
.meeting__body span { color:var(--ink-3); font-size:var(--text-meta); }
.meeting__body small { color:var(--ink-5); font-size:var(--text-meta); }
.meeting__body .badge { align-self:flex-start; margin-top:4px; }
</style>
