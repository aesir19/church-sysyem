<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { supabase } from '../lib/supabase'
import AuthShell from '../components/AuthShell.vue'
import Alert from '../components/ui/Alert.vue'
import Button from '../components/ui/Button.vue'
import Input from '../components/ui/Input.vue'

const email = ref('')
const loading = ref(false)
const sent = ref(false)
const errorMessage = ref('')
const retryAt = ref(0)
const now = ref(Date.now())
const remaining = computed(() => Math.max(0, Math.ceil((retryAt.value - now.value) / 1000)))
const timer = setInterval(() => { now.value = Date.now() }, 1000)
onUnmounted(() => clearInterval(timer))

async function requestReset () {
  if (loading.value || remaining.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.value.trim(), {
      redirectTo: new URL('/reset-password', window.location.origin).href
    })
    if (error) {
      errorMessage.value = Number(error.status) === 429
        ? 'Too many requests. Wait a minute and try again.'
        : 'Could not request a reset link. Please try again later.'
    } else {
      sent.value = true
    }
  } catch {
    errorMessage.value = 'Cannot reach the server. Check your connection and try again.'
  } finally {
    // Feedback only: Supabase enforces the actual server-side rate limits.
    // Apply equally to every address and outcome; never echo raw auth errors.
    now.value = Date.now()
    retryAt.value = now.value + 60_000
    loading.value = false
  }
}
</script>

<template>
  <AuthShell
    wash="auth"
    :title="sent ? 'Check your email' : 'Forgot password?'"
    :subtitle="sent ? 'Check your inbox and spam folder. Open the link to choose a new password.' : 'Enter your account email and we’ll send you a password reset link.'"
  >
    <form
      class="forgot"
      @submit.prevent="requestReset"
    >
      <Alert
        v-if="sent"
        tone="success"
      >
        If an account exists for that email, we’ve sent a password reset link.
      </Alert>
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
        :disabled="loading"
      />
      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        :loading="loading"
        :disabled="remaining > 0"
      >
        {{ loading ? 'Sending…' : remaining ? `Send again in ${remaining}s` : sent ? 'Send again' : 'Send reset link' }}
      </Button>
      <router-link
        class="forgot__back"
        to="/login"
      >
        Back to sign in
      </router-link>
    </form>
  </AuthShell>
</template>

<style scoped>
.forgot { display: flex; flex-direction: column; gap: var(--sp-14); }
.forgot__back { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; color: var(--accent-dark); font-size: var(--text-label); font-weight: 700; }
.forgot__back:hover { text-decoration: underline; }
.forgot__back:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
</style>
