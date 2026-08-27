<script setup>
/**
 * Set your password — the screen an invited user lands on from their email.
 *
 * Account creation is fully in-app, so setting the password is the last step:
 * on success the user is signed out and sent to /login to sign in with it.
 * `validateNewPassword` still enforces eight characters and a match; the meter below it advises
 * twelve without refusing eight, because raising the enforced minimum is a
 * policy decision for the owner rather than something to change while
 * repainting. Flagged in the handover, not decided here.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { useCurrentUser } from '../composables/useCurrentUser'
import { validateNewPassword } from '../utils/authValidation'
import { passwordStrength } from '../utils/passwordStrength'
import AuthShell from '../components/AuthShell.vue'
import Alert from '../components/ui/Alert.vue'
import Button from '../components/ui/Button.vue'
import Input from '../components/ui/Input.vue'
import Icon from '../components/ui/icons/Icon.vue'
import Spinner from '../components/ui/Spinner.vue'

const router = useRouter()
const { email, load: loadUser } = useCurrentUser()
const password = ref('')
const confirmPassword = ref('')
const revealed = ref(false)
const loading = ref(false)
const redirecting = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const strength = computed(() => passwordStrength(password.value))

onMounted(loadUser)

// Only once there is something to confirm, and only when it actually differs —
// otherwise the field is red for every keystroke of a correct password.
const confirmError = computed(() =>
  confirmPassword.value && confirmPassword.value !== password.value
    ? 'The two passwords do not match.'
    : ''
)

async function handleSetPassword () {
  loading.value = true
  errorMessage.value = ''
  successMessage.value = ''

  const validationError = validateNewPassword(password.value, confirmPassword.value)
  if (validationError) {
    errorMessage.value = validationError
    loading.value = false
    return
  }

  const { error } = await supabase.auth.updateUser({ password: password.value })

  if (error) {
    // Unlike sign-in, this caller is already authenticated, so there is no
    // account to enumerate — but the raw string is still written for a
    // developer. Supabase's own "New password should be different from the old
    // password" is the one worth passing through, and it is safe to.
    errorMessage.value = error.message || 'Could not set your password. Please try again.'
  } else {
    // The account is created entirely in-app, so finish by handing the user to
    // the login page to sign in with the password they just set. They are still
    // authenticated from the invite link, and the router bounces a signed-in
    // visitor away from /login — so sign out first, then redirect.
    successMessage.value = 'Password set. Taking you to sign in…'
    // Hold the button in its working state through the hand-off so the pause
    // reads as motion, not a frozen page.
    redirecting.value = true
    await supabase.auth.signOut()
    setTimeout(() => { router.push('/login') }, 1500)
  }

  loading.value = false
}
</script>

<template>
  <AuthShell
    wash="auth"
    title="Set your password"
  >
    <template #badge>
      <span class="setpw__tile"><Icon
        name="lock"
        :size="22"
        :width="2"
      /></span>
    </template>

    <template #subtitle>
      You were invited to the <strong>UDFC dashboard</strong>. Choose a password
      to finish.
    </template>

    <form
      class="setpw"
      @submit.prevent="handleSetPassword"
    >
      <Alert
        v-if="errorMessage"
        tone="danger"
      >
        {{ errorMessage }}
      </Alert>
      <Alert
        v-if="successMessage"
        tone="success"
      >
        <span class="setpw__redirect">
          <Spinner :size="15" />
          {{ successMessage }}
        </span>
      </Alert>

      <!-- A hidden username field, which is not decoration. A password form
           with no username gives a password manager nothing to file the new
           credential against, so it either saves it under the wrong entry or
           does not offer to save it at all — and this is the one screen where
           a password is being created rather than recalled. Chrome warns about
           its absence for exactly this reason. -->
      <input
        class="setpw__username"
        type="text"
        name="username"
        autocomplete="username"
        :value="email"
        tabindex="-1"
        aria-hidden="true"
        readonly
      >

      <div class="setpw__field">
        <Input
          v-model="password"
          label="New password"
          :type="revealed ? 'text' : 'password'"
          required
          minlength="8"
          autocomplete="new-password"
        >
          <template #suffix>
            <button
              type="button"
              class="setpw__reveal"
              :aria-label="revealed ? 'Hide password' : 'Show password'"
              :aria-pressed="revealed"
              @click="revealed = !revealed"
            >
              <Icon
                :name="revealed ? 'eyeWide' : 'eye'"
                :size="16"
              />
            </button>
          </template>
        </Input>

        <!-- The meter is aria-hidden and the sentence under it is not: four
             coloured bars say nothing to a screen reader, and repeating the
             same thing twice says it twice. -->
        <div
          v-if="password"
          class="meter"
          aria-hidden="true"
        >
          <span
            v-for="n in 4"
            :key="n"
            class="meter__bar"
            :class="{ 'is-lit': n <= strength.score }"
            :data-score="strength.score"
          />
        </div>
        <p
          v-if="password"
          class="setpw__strength"
        >
          <strong>{{ strength.label }}</strong> · {{ strength.hint }}
        </p>
      </div>

      <Input
        v-model="confirmPassword"
        label="Confirm password"
        :type="revealed ? 'text' : 'password'"
        required
        minlength="8"
        autocomplete="new-password"
        :error="confirmError"
      />

      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        :loading="loading || redirecting"
        :disabled="!!successMessage"
        class="setpw__submit"
      >
        {{ redirecting ? 'Taking you to sign in…' : (loading ? 'Saving…' : 'Save and continue') }}
      </Button>
    </form>
  </AuthShell>
</template>

<style scoped>
.setpw { display: flex; flex-direction: column; gap: var(--sp-14); }

.setpw__redirect { display: inline-flex; align-items: center; gap: var(--sp-8); }

/* Present for the password manager, absent for everyone else. Not
   `display: none` — a hidden-by-display field is skipped by some managers, and
   the whole point is that it is read. */
.setpw__username {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}
.setpw__field { display: flex; flex-direction: column; gap: var(--sp-6); }

.setpw__tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  align-self: flex-start;
  border-radius: 14px;
  background: var(--accent-tint);
  color: var(--accent-dark);
}

.meter { display: flex; gap: var(--sp-5); }

.meter__bar {
  flex: 1;
  height: 4px;
  border-radius: var(--r-pill);
  background: var(--divider);
  transition: background-color var(--dur-state) ease;
}

/* Lit bars take the colour of the score, not of their own position — four cyan
   bars and one magenta bar at the same score would read as a fifth state. */
.meter__bar.is-lit[data-score='1'] { background: var(--magenta); }
.meter__bar.is-lit[data-score='2'] { background: var(--warning); }
.meter__bar.is-lit[data-score='3'] { background: var(--accent); }
.meter__bar.is-lit[data-score='4'] { background: var(--success); }

.setpw__strength { font-size: var(--text-meta); color: var(--ink-4); line-height: 1.45; }
.setpw__strength strong { font-weight: 800; color: var(--ink-2); }

.setpw__submit { margin-top: var(--sp-6); padding: 13px; font-size: var(--text-body); font-weight: 800; }

.setpw__reveal {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: none;
  border: 0;
  background: transparent;
  border-radius: var(--r-tag);
  color: var(--ink-5);
  cursor: pointer;
  transition: color var(--dur-state) ease, background-color var(--dur-state) ease;
}
.setpw__reveal:hover { color: var(--ink-3); background: var(--surface-subtle-2); }
.setpw__reveal:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

@media (prefers-reduced-motion: reduce) {
  .meter__bar { transition: none; }
}
</style>
