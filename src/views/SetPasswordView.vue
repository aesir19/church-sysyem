<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { isRecoverySession, recoveryUserId } from '../lib/passwordRecovery'
import { validateNewPassword } from '../utils/authValidation'
import { passwordStrength } from '../utils/passwordStrength'
import AuthShell from '../components/AuthShell.vue'
import Alert from '../components/ui/Alert.vue'
import Button from '../components/ui/Button.vue'
import Input from '../components/ui/Input.vue'
import Icon from '../components/ui/icons/Icon.vue'
import Spinner from '../components/ui/Spinner.vue'

const props = defineProps({ recovery: { type: Boolean, default: false } })
const router = useRouter()
const email = ref('')
const verifiedUserId = ref('')
const checking = ref(true)
const password = ref('')
const confirmPassword = ref('')
const revealed = ref(false)
const loading = ref(false)
const redirecting = ref(false)
const passwordSaved = ref(false)
const savedUserId = ref('')
const sessionChanged = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
let redirectTimer
let verification = 0
const allowed = computed(() => !!verifiedUserId.value && (!props.recovery || verifiedUserId.value === recoveryUserId.value))
const strength = computed(() => passwordStrength(password.value))
const confirmError = computed(() =>
  confirmPassword.value && confirmPassword.value !== password.value
    ? 'The two passwords do not match.'
    : ''
)

async function verifySession () {
  const attempt = ++verification
  checking.value = true
  verifiedUserId.value = ''
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session || (props.recovery && !isRecoverySession(session))) return
    const { data, error } = await supabase.auth.getUser()
    if (attempt !== verification || error || data.user?.id !== session.user.id) return
    if (props.recovery && !isRecoverySession(session)) return
    verifiedUserId.value = data.user.id
    email.value = data.user.email || ''
  } catch {
    // A session that cannot be verified never enables the password form.
  } finally {
    if (attempt === verification) checking.value = false
  }
}

onMounted(verifySession)
watch(recoveryUserId, () => {
  if (!props.recovery || passwordSaved.value) return
  password.value = ''
  confirmPassword.value = ''
  void verifySession()
})
onUnmounted(() => { verification++; clearTimeout(redirectTimer) })

async function finishSignOut () {
  if (redirecting.value) return
  redirecting.value = true
  errorMessage.value = ''
  try {
    const { data, error: userError } = await supabase.auth.getUser()
    if (userError && ![401, 403].includes(userError.status) && userError.name !== 'AuthSessionMissingError') throw userError
    if (userError || data.user?.id !== savedUserId.value) {
      sessionChanged.value = true
      errorMessage.value = 'Your password was saved, but your session changed. Open a new reset link for the same account to finish signing out its sessions.'
      redirecting.value = false
      return
    }
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) throw error
    successMessage.value = props.recovery
      ? 'Password reset. Taking you to sign in…'
      : 'Password set. Taking you to sign in…'
    redirectTimer = setTimeout(() => { router.replace('/login') }, 1500)
  } catch {
    errorMessage.value = 'Your password was saved, but we could not sign out your sessions. Retry sign out to finish.'
    redirecting.value = false
  }
}

async function handleSetPassword () {
  if (loading.value || redirecting.value || passwordSaved.value || !allowed.value) return
  errorMessage.value = ''
  const validationError = validateNewPassword(password.value, confirmPassword.value)
  if (validationError) {
    errorMessage.value = validationError
    return
  }
  loading.value = true
  try {
    // Recheck the account at submission in case another tab changed sessions.
    const { data, error: userError } = await supabase.auth.getUser()
    if (userError || data.user?.id !== verifiedUserId.value || !allowed.value) {
      verifiedUserId.value = ''
      password.value = ''
      confirmPassword.value = ''
      return
    }
    const { error } = await supabase.auth.updateUser({ password: password.value })
    if (error) {
      if (error.status === 401 || error.status === 403 || error.code === 'session_not_found') {
        verifiedUserId.value = ''
      } else {
        errorMessage.value = error.code === 'same_password'
          ? 'Choose a password different from your current password.'
          : error.code === 'weak_password'
            ? 'That password does not meet the account security requirements. Choose a stronger password.'
            : 'Could not save your password. Please try again.'
      }
      return
    }
    passwordSaved.value = true
    savedUserId.value = data.user.id
    password.value = ''
    confirmPassword.value = ''
    await finishSignOut()
  } catch {
    errorMessage.value = 'Cannot reach the server. Check your connection and try again.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthShell
    wash="auth"
    :title="recovery ? 'Reset your password' : 'Set your password'"
  >
    <template #badge>
      <span class="setpw__tile"><Icon
        name="lock"
        :size="22"
        :width="2"
      /></span>
    </template>

    <template #subtitle>
      <template v-if="recovery">
        Choose a new password for your UDFC account.
      </template>
      <template v-else>
        You were invited to the <strong>UDFC dashboard</strong>. Choose a password to finish.
      </template>
    </template>

    <p
      v-if="checking && !passwordSaved"
      role="status"
    >
      Checking your link…
    </p>
    <div
      v-else-if="passwordSaved"
      class="setpw"
    >
      <Alert
        v-if="successMessage"
        tone="success"
      >
        <span class="setpw__redirect"><Spinner :size="15" />{{ successMessage }}</span>
      </Alert>
      <Alert
        v-if="errorMessage"
        tone="danger"
      >
        {{ errorMessage }}
      </Alert>
      <Button
        v-if="!redirecting && !sessionChanged"
        block
        @click="finishSignOut"
      >
        Retry sign out
      </Button>
      <Button
        v-if="sessionChanged"
        to="/forgot-password"
        block
      >
        Request a new link
      </Button>
      <p
        v-else-if="redirecting && !successMessage"
        role="status"
      >
        Signing out your sessions…
      </p>
    </div>
    <div
      v-else-if="!allowed"
      class="setpw"
    >
      <Alert tone="warning">
        {{ recovery ? 'This reset link is invalid or has expired. Request a new link to continue.' : 'This invitation link is invalid or has expired. Ask an administrator for a new invitation.' }}
      </Alert>
      <Button
        v-if="recovery"
        to="/forgot-password"
        variant="primary"
        size="lg"
        block
      >
        Request a new link
      </Button>
      <Button
        to="/login"
        block
      >
        Back to sign in
      </Button>
    </div>
    <form
      v-else
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
        {{ loading ? 'Saving…' : recovery ? 'Reset password' : 'Save and continue' }}
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
