<script setup>
import { computed } from 'vue'
import Avatar from './ui/Avatar.vue'
import Button from './ui/Button.vue'
import Icon from './ui/icons/Icon.vue'
import { journeySteps } from '../utils/journey'
import { safeFacebookUrl } from '../utils/memberLink'

// The 360px panel that fills when a member row is selected.
//
// The mockup's stepper draws four nodes joined by a rail. The rail is the
// INTENDED path; the ticks are what actually happened. No node is disabled
// because an earlier one is open — roughly a fifth of this church's roll was
// baptized before any one-to-one was recorded, and a stepper that greyed those
// out would be showing a rule the church does not have.

const props = defineProps({
  member: { type: Object, default: null },
  churchName: { type: String, default: '' },
  canWrite: { type: Boolean, default: false }
})

defineEmits(['edit', 'archive', 'add-to-group'])

const fullName = computed(() => {
  const m = props.member
  if (!m) return ''
  const middle = m.middle_name ? `${m.middle_name.trim()[0]}. ` : ''
  return `${m.first_name} ${middle}${m.last_name}`.replace(/\s+/g, ' ').trim()
})

const age = computed(() => {
  if (!props.member?.birthdate) return null
  const b = new Date(props.member.birthdate)
  const now = new Date()
  let a = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--
  return a
})

// "34 · Female · Married · joined 2017" — em-separated, and each part omitted
// when the record does not carry it rather than rendered as a gap.
const summary = computed(() => {
  const m = props.member
  if (!m) return ''
  const bits = []
  if (age.value != null) bits.push(age.value)
  if (m.gender) bits.push(m.gender)
  if (m.marital_status) bits.push(m.marital_status)
  if (m.date_joined) bits.push(`joined ${new Date(m.date_joined).getFullYear()}`)
  return bits.join(' · ')
})

const steps = computed(() => journeySteps(props.member))

const phone = computed(() => {
  const raw = props.member?.contact_number
  if (raw == null || raw === '') return null
  // Stored as a numeric, so the leading zero of an 09xx number is long gone.
  const digits = String(raw).replace(/\D/g, '')
  const padded = digits.length === 10 ? `0${digits}` : digits
  return padded.replace(/^(\d{4})(\d{3})(\d{4})$/, '$1 $2 $3')
})

const groups = computed(() =>
  (props.member?.group_members || [])
    .map(gm => gm.groups)
    .filter(Boolean)
)

// `facebook_link` is member-editable free text and has accepted arbitrary
// strings since the column existed, so it is validated at RENDER, not just at
// write — see utils/memberLink.js. Anything that is not an https URL on an
// allowlisted Facebook host renders as plain text rather than as a link. Do not
// replace this with a scheme check or string concatenation: a clickable,
// member-supplied URL inside a staff dashboard is a phishing pivot.
const facebookHref = computed(() => safeFacebookUrl(props.member?.facebook_link))

const isMarried = computed(() =>
  String(props.member?.marital_status || '').toLowerCase() === 'married'
)

function fmtDate (iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric'
  })
}
</script>

<template>
  <div
    v-if="member"
    class="mdp anim-slide"
  >
    <!-- Identity -->
    <header class="mdp__head">
      <Avatar
        :name="fullName"
        :size="50"
      />
      <div class="mdp__id">
        <h2 class="mdp__name">
          {{ fullName }}
        </h2>
        <p class="mdp__summary">
          {{ summary }}
        </p>
      </div>
    </header>

    <div
      v-if="canWrite"
      class="mdp__actions"
    >
      <Button
        size="sm"
        @click="$emit('edit', member)"
      >
        Edit
      </Button>
      <!-- The mockup's third action, "Add to group", is dialog 05 and is not
           built yet. A button that does nothing when clicked is worse than one
           that is not there, so it arrives with that dialog rather than ahead
           of it. The emit stays declared for that. -->
      <Button
        size="sm"
        variant="dangerQuiet"
        @click="$emit('archive', member)"
      >
        Archive
      </Button>
    </div>

    <!-- Journey -->
    <section class="mdp__journey">
      <h3 class="mdp__eyebrow">
        Discipleship journey
      </h3>
      <ol class="steps">
        <li
          v-for="(step, i) in steps"
          :key="step.key"
          class="steps__step"
          :class="{ 'is-done': step.done }"
        >
          <span
            v-if="i > 0"
            class="steps__rail"
            aria-hidden="true"
          />
          <span class="steps__node">
            <Icon
              v-if="step.done"
              name="check"
              :size="13"
              :width="2.6"
            />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span class="steps__label">{{ step.short }}</span>
        </li>
      </ol>
    </section>

    <!-- Contact -->
    <section class="mdp__section">
      <h3 class="mdp__eyebrow">
        Contact
      </h3>
      <dl class="kv">
        <div class="kv__row">
          <dt>Phone</dt>
          <dd>
            <a
              v-if="phone"
              :href="`tel:${String(member.contact_number).replace(/\D/g, '')}`"
            >{{ phone }}</a>
            <span
              v-else
              class="kv__empty"
            >—</span>
          </dd>
        </div>
        <div class="kv__row">
          <dt>Email</dt>
          <dd>
            <a
              v-if="member.email"
              :href="`mailto:${member.email}`"
            >{{ member.email }}</a>
            <span
              v-else
              class="kv__empty"
            >—</span>
          </dd>
        </div>
        <div class="kv__row">
          <dt>Facebook</dt>
          <dd>
            <a
              v-if="facebookHref"
              :href="facebookHref"
              target="_blank"
              rel="noopener noreferrer"
            >{{ member.facebook_link }}</a>
            <!-- Refused, but never hidden: the value is still shown as text so
                 the record reads completely and a bad value is visible to whoever
                 can correct it. -->
            <span
              v-else-if="member.facebook_link"
              class="kv__plain"
            >{{ member.facebook_link }}</span>
            <span
              v-else
              class="kv__empty"
            >—</span>
          </dd>
        </div>
        <div class="kv__row">
          <dt>Address</dt>
          <dd>
            <span v-if="member.address">{{ member.address }}</span>
            <span
              v-else
              class="kv__empty"
            >—</span>
          </dd>
        </div>
      </dl>
    </section>

    <!-- Personal -->
    <section class="mdp__section">
      <h3 class="mdp__eyebrow">
        Personal
      </h3>
      <dl class="kv">
        <div class="kv__row">
          <dt>Birthdate</dt>
          <dd>
            <span v-if="member.birthdate">{{ fmtDate(member.birthdate) }}</span>
            <span
              v-else
              class="kv__empty"
            >—</span>
          </dd>
        </div>
        <div class="kv__row">
          <dt>Date joined</dt>
          <dd>
            <span v-if="member.date_joined">{{ fmtDate(member.date_joined) }}</span>
            <span
              v-else
              class="kv__empty"
            >—</span>
          </dd>
        </div>
        <!-- The mockup's Personal section lists Birthdate / Date joined /
             Church and stops. The app has always shown a wedding anniversary
             for married members, and this is a REDESIGN — dropping a field
             people already use is out of scope for it, so the row stays and
             takes the design's key/value treatment like the rest. It is
             conditional on being married because that is the existing
             behaviour, not a new rule. -->
        <div
          v-if="isMarried"
          class="kv__row"
        >
          <dt>Wedding anniversary</dt>
          <dd>
            <span v-if="member.wedding_anniversarry">{{ fmtDate(member.wedding_anniversarry) }}</span>
            <span
              v-else
              class="kv__empty"
            >—</span>
          </dd>
        </div>
        <div class="kv__row">
          <dt>Church</dt>
          <dd>{{ churchName || '—' }}</dd>
        </div>
      </dl>
    </section>

    <!-- Groups -->
    <section class="mdp__section">
      <h3 class="mdp__eyebrow">
        Groups
      </h3>
      <dl class="kv">
        <div class="kv__row">
          <dt>Belongs to</dt>
          <dd>
            <span v-if="groups.length">{{ groups.map(g => g.name).join(', ') }}</span>
            <span
              v-else
              class="kv__empty"
            >In no group</span>
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.mdp { display: flex; flex-direction: column; gap: var(--sp-18); }

/* --- Identity --------------------------------------------------------- */
.mdp__head { display: flex; align-items: center; gap: var(--sp-12); }

.mdp__id { min-width: 0; display: flex; flex-direction: column; gap: 2px; }

.mdp__name {
  font-size: 19px;
  font-weight: 800;
  letter-spacing: var(--tracking-h3);
  color: var(--ink);
  line-height: 1.2;
}

.mdp__summary { font-size: var(--text-body-sm); color: var(--ink-4); }

.mdp__actions { display: flex; gap: var(--sp-8); }
.mdp__actions > * { flex: 1; }

/* --- Journey ---------------------------------------------------------- */
.mdp__journey {
  display: flex;
  flex-direction: column;
  gap: var(--sp-14);
  padding: var(--sp-14);
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: var(--r-inset);
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
}

.steps__step {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-8);
  min-width: 0;
}

/* The rail joins node i-1 to node i. It is drawn behind the node and is
   deliberately NOT coloured by completion: it depicts the intended path, not
   progress along it. */
.steps__rail {
  position: absolute;
  top: 13px;
  right: 50%;
  left: -50%;
  height: 2px;
  background: var(--border-strong);
}

.steps__node {
  position: relative;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--r-pill);
  background: var(--surface);
  border: 1.5px solid var(--border-strong);
  color: var(--ink-5);
  font-size: var(--text-meta);
  font-weight: 800;
}

.steps__step.is-done .steps__node {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.steps__label {
  font-size: var(--text-meta-sm);
  font-weight: 600;
  color: var(--ink-5);
  text-align: center;
  line-height: 1.3;
}
.steps__step.is-done .steps__label { color: var(--ink-3); font-weight: 700; }

/* --- Key/value sections ----------------------------------------------- */
.mdp__section { display: flex; flex-direction: column; gap: var(--sp-10); }

.mdp__eyebrow {
  font-size: var(--text-eyebrow);
  font-weight: 800;
  letter-spacing: var(--tracking-eyebrow);
  text-transform: uppercase;
  color: var(--ink-5);
}

.kv { margin: 0; display: flex; flex-direction: column; }

.kv__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-14);
  padding: var(--sp-10) 0;
  border-bottom: 1px solid var(--divider);
}
.kv__row:last-child { border-bottom: 0; }

.kv__row dt {
  font-size: var(--text-body-sm);
  color: var(--ink-4);
  flex: none;
}

.kv__row dd {
  margin: 0;
  font-size: var(--text-body-sm);
  font-weight: 600;
  color: var(--ink);
  text-align: right;
  min-width: 0;
  overflow-wrap: anywhere;
}

.kv__row dd a { color: var(--accent-text); text-decoration: none; }
.kv__row dd a:hover { text-decoration: underline; }

/* The em-dash placeholder, in the mockups' dedicated lightest ink. */
.kv__empty { color: var(--ink-6); font-weight: 500; }

/* A value that exists but was refused as a link. Deliberately styled as text,
   not as a disabled link — it should not look clickable at all. */
.kv__plain { color: var(--ink-3); font-weight: 500; }
</style>
