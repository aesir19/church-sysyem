<script setup>
/**
 * One member record, presented.
 *
 * Extracted because the same seventeen fields have two homes: a sticky right
 * panel on a wide screen, and `ui/Modal` below that width. Two copies of a PII field list is exactly the sort of duplication that
 * drifts — one copy gaining a field the other never shows.
 *
 * Domain-aware, so `src/components/` and not `src/components/ui/`: it knows
 * what a member is. It knows nothing about capabilities — the parent decides
 * whether this is rendered at all, because that is an authorization question
 * and ADR-0001 keeps those in one place. RLS is the enforcement boundary
 * either way; a caller without `can_see_member_detail()` never has these
 * columns to pass in.
 *
 * It renders no actions. Edit and Archive live in the panel's footer and in the
 * modal's footer slot respectively, which are different places — putting them
 * inside this component would land them in the modal's body.
 */
import { computed } from 'vue'
import { safeFacebookUrl } from '../utils/memberLink'
import Icon from './ui/icons/Icon.vue'

const props = defineProps({
  member: { type: Object, required: true },
  /** Resolved once per session by useActiveChurch; the row holds only an id. */
  churchName: { type: String, default: '' },
})

/**
 * Condition 1 of the four the link ships under: validated AT RENDER. It runs over
 * whatever is in the column today, which no write-time check can reach.
 * Condition 4 is the `v-else` below — a value that fails renders as the plain
 * text it has always been, never as a broken or silently stripped link.
 */
const facebookHref = computed(() => safeFacebookUrl(props.member?.facebook_link))

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function computeAge(birthdate) {
  if (!birthdate) return ''
  const dob = new Date(birthdate)
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDiff = today.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--
  return String(age)
}

const yesNo = (value) => (value ? 'Yes' : 'No')

/**
 * The rows, as data rather than as fifteen near-identical template blocks.
 *
 * An empty `value` renders the em-dash placeholder, which is for a row that
 * legitimately has no value — a member with no email — and NEVER for a
 * feature that was not built.
 */
const rows = computed(() => {
  const m = props.member ?? {}
  const list = [
    { label: 'Birthdate', value: formatDate(m.birthdate) },
    { label: 'Age', value: computeAge(m.birthdate) },
    { label: 'Gender', value: m.gender },
    { label: 'Marital status', value: m.marital_status },
  ]

  if (m.marital_status === 'Married') {
    list.push({ label: 'Wedding anniversary', value: formatDate(m.wedding_anniversarry) })
  }

  list.push(
    { label: 'Address', value: m.address },
    { label: 'Member of', value: props.churchName },
    { label: 'Contact number', value: m.contact_number },
    { label: 'Email', value: m.email },
    { label: 'Date joined', value: formatDate(m.date_joined) },
    { label: 'Baptized', value: yesNo(m.is_baptized) },
    { label: 'One-to-one completed', value: yesNo(m.is_one_to_one_completed) },
    { label: 'Turning point completed', value: yesNo(m.is_turning_point_completed) },
  )

  return list
})

const fullName = computed(() => {
  const m = props.member ?? {}
  const middle = m.middle_name ? ` ${m.middle_name}` : ''
  return `${m.first_name ?? ''}${middle} ${m.last_name ?? ''}`.trim()
})
</script>

<template>
  <div class="detail">
    <p class="detail-name">{{ fullName }}</p>

    <dl class="detail-rows">
      <div v-for="row in rows" :key="row.label" class="detail-row">
        <dt>{{ row.label }}</dt>
        <dd :class="{ 'is-empty': !row.value }">{{ row.value || '—' }}</dd>
      </div>

      <div class="detail-row">
        <dt>Facebook</dt>
        <dd>
          <a
            v-if="facebookHref"
            class="detail-link"
            :href="facebookHref"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ member.facebook_link }}
            <Icon name="external-link" :size="14" />
          </a>
          <span v-else :class="{ 'is-empty': !member.facebook_link }">
            {{ member.facebook_link || '—' }}
          </span>
        </dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.detail-name {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  line-height: var(--leading-tight);
  margin-bottom: var(--space-4);
  word-break: break-word;
}

.detail-rows {
  display: flex;
  flex-direction: column;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--color-border-subtle);
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-row dt {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.detail-row dd {
  font-size: var(--text-base);
  color: var(--color-text-primary);
  text-align: right;
  word-break: break-word;
  min-width: 0;
}

.detail-row dd.is-empty,
.detail-row .is-empty {
  color: var(--color-text-placeholder);
}

.detail-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-accent-text);
  font-weight: var(--font-weight-medium);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.detail-link:hover {
  color: var(--color-accent-hover);
}

.detail-link:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
</style>
