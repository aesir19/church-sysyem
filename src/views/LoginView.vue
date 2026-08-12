<script setup>
/**
 * Sign in.
 *
 * The chrome is AuthShell / Input / Button / Alert; what is left here is this
 * page's own copy and its own submit.
 *
 * WHAT IS NOT DRAWN, DELIBERATELY. The mockup puts a "Forgot?" link beside the
 * password label. There is no password-reset route, no reset email template and
 * no rate limit on one — that is a feature with a security review attached, not
 * a repaint. A link that goes nowhere is worse than no link on the one screen
 * where somebody is already stuck, so it goes to planning instead.
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { signInErrorMessage } from '../utils/authErrors'
import AuthShell from '../components/AuthShell.vue'
import Alert from '../components/ui/Alert.vue'
import Button from '../components/ui/Button.vue'
import Input from '../components/ui/Input.vue'
import Icon from '../components/ui/icons/Icon.vue'

const router = useRouter()
const email = ref('')
const password = ref('')
const revealed = ref(false)
const loading = ref(false)
const errorMessage = ref('')

async function handleLogin () {
  loading.value = true
  errorMessage.value = ''

  const { error } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value
  })

  // Classified, never `error.message`. See utils/authErrors.js — the raw string
  // can distinguish "no such account" from "wrong password", which turns this
  // form into a way of testing whether an address belongs to church staff.
  if (error) {
    errorMessage.value = signInErrorMessage(error)
    // The password is cleared on a failure but the email is kept: retyping the
    // address is the annoying half, and whatever was wrong, the password is the
    // field that has to change.
    password.value = ''
  } else {
    router.push('/dashboard')
  }

  loading.value = false
}
</script>

<template>
  <AuthShell
    wash="auth"
    title="Welcome back"
    subtitle="Sign in to the UDFC dashboard."
  >
    <form
      class="signin"
      @submit.prevent="handleLogin"
    >
      <Alert
        v-if="errorMessage"
        tone="danger"
      >
        {{ errorMessage }}
      </Alert>

      <Input
        v-model="email"
        label="Email address"
        type="email"
        required
        autocomplete="email"
        autocapitalize="none"
        spellcheck="false"
        placeholder="you@example.com"
      />

      <Input
        v-model="password"
        label="Password"
        :type="revealed ? 'text' : 'password'"
        required
        autocomplete="current-password"
      >
        <template #suffix>
          <!-- A real button, labelled by state. The mockup draws the eye as
               part of the field; without a label it announces as nothing, and
               without aria-pressed a screen-reader user cannot tell whether
               their password is currently on screen. -->
          <button
            type="button"
            class="signin__reveal"
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

      <!-- The label changes with the loading state rather than being replaced
           by a bare spinner: a button whose text disappears is a button whose
           accessible name disappears with it. -->
      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        :loading="loading"
        class="signin__submit"
      >
        {{ loading ? 'Signing in…' : 'Sign in' }}
      </Button>
    </form>

    <template #footnote>
      Protected system for authorised church staff only.
    </template>
  </AuthShell>
</template>

<style scoped>
.signin { display: flex; flex-direction: column; gap: var(--sp-14); }

.signin__submit { margin-top: var(--sp-6); padding: 13px; font-size: var(--text-body); font-weight: 800; }

.signin__reveal {
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
.signin__reveal:hover { color: var(--ink-3); background: var(--surface-subtle-2); }
.signin__reveal:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
