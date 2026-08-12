<script setup>
/**
 * The signed-in-but-unassigned state: authentication worked, authorisation has
 * not been granted yet. The router guard sends people here rather than into a
 * dashboard that would be empty in a way that looks broken.
 *
 * Sign out goes through `useSession().signOut()` — the one sign-out path. It
 * used to call `supabase.auth.signOut()` directly and clear nothing, which on a
 * shared browser left the previous user's cached first name for the next person
 * to be greeted by.
 *
 * The mockup shows the waiting account's own address on the card. That is the
 * detail that makes the screen answerable: a leader can be told exactly which
 * account to look for, and somebody who signed in with the wrong address can
 * see that they did.
 */
import { onMounted } from 'vue'
import { useSession } from '../composables/useSession'
import { useCurrentUser } from '../composables/useCurrentUser'
import AuthShell from '../components/AuthShell.vue'
import Avatar from '../components/ui/Avatar.vue'
import Button from '../components/ui/Button.vue'
import Icon from '../components/ui/icons/Icon.vue'

const { signOut } = useSession()
const { email, displayName, load } = useCurrentUser()

onMounted(load)
</script>

<template>
  <AuthShell
    :card="false"
    width="md"
    :icon="false"
    title="Account setup in progress"
    subtitle="Your sign-in works, but a church leader still needs to assign your role and church before the dashboard opens."
  >
    <template #badge>
      <span class="pend__tile"><Icon
        name="clock"
        :size="26"
        :width="2"
      /></span>
    </template>

    <div class="pend__who">
      <Avatar
        :name="displayName"
        :size="30"
        :placeholder="!displayName"
      />
      <span class="pend__who-text">
        <span class="pend__email">{{ email || 'Signed in' }}</span>
        <span class="pend__waiting">Waiting on: role, church assignment</span>
      </span>
    </div>

    <Button @click="signOut">
      Sign out
    </Button>

    <template #footnote>
      If this is taking longer than you expect, ask your church administrator to
      finish the assignment.
    </template>
  </AuthShell>
</template>

<style scoped>
.pend__tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  flex: none;
  border-radius: var(--r-pill);
  background: var(--warning-tint);
  color: var(--warning-deep);
  /* The mockup's soft halo — a ring rather than a shadow, so it stays put on
     any background. */
  box-shadow: 0 0 0 8px rgba(181, 71, 8, .06);
}

/* The identity strip is the one left-aligned thing on a centred page: it is a
   record, and a centred email address is hard to read and harder to compare
   against the one somebody was expecting. */
.pend__who {
  display: flex;
  align-items: center;
  gap: var(--sp-10);
  width: 100%;
  padding: 13px var(--sp-16);
  border-radius: var(--r-inset);
  background: var(--surface);
  border: 1px solid var(--border);
  text-align: left;
}

.pend__who-text { display: flex; flex-direction: column; min-width: 0; gap: 1px; }

.pend__email {
  font-size: var(--text-body-sm);
  font-weight: 700;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.pend__waiting { font-size: var(--text-meta); color: var(--ink-5); }
</style>
