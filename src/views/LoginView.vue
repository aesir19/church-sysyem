<script setup>
/**
 * First view migrated onto the token layer (REDESIGN.md Phase 1a).
 *
 * What used to be here — a gradient, a card, an inline logo SVG, a hand-rolled
 * spinner keyframe, a `.form-group` and an error banner — is now AuthShell,
 * Input, Button and Alert. What is left is this page's own copy and its own
 * submit, which is the whole of what makes it the sign-in page.
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import AuthShell from '../components/AuthShell.vue'
import Alert from '../components/ui/Alert.vue'
import Button from '../components/ui/Button.vue'
import Input from '../components/ui/Input.vue'

const router = useRouter()
const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')

async function handleLogin() {
  loading.value = true
  errorMessage.value = ''

  const { error } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value,
  })

  if (error) {
    errorMessage.value = error.message
  } else {
    router.push('/dashboard')
  }

  loading.value = false
}
</script>

<template>
  <AuthShell title="UDFC Dashboard" subtitle="Welcome back. Please sign in to continue.">
    <form class="auth-form" @submit.prevent="handleLogin">
      <Alert v-if="errorMessage" tone="error">{{ errorMessage }}</Alert>

      <Input
        v-model="email"
        label="Email Address"
        type="email"
        placeholder="Enter your email"
        required
        autocomplete="email"
      />

      <Input
        v-model="password"
        label="Password"
        type="password"
        placeholder="Enter your password"
        required
        autocomplete="current-password"
      />

      <!-- The label changes with the loading state rather than being replaced
           by a bare spinner, as it was: a button whose text disappears is a
           button whose accessible name disappears with it. -->
      <Button type="submit" size="lg" block :loading="loading">
        {{ loading ? 'Signing in…' : 'Sign In' }}
      </Button>
    </form>
  </AuthShell>
</template>

<style scoped>
.auth-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
</style>
