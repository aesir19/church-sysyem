<script setup>
/**
 * Migrated with the rest of the auth family. The
 * validation and the redirect are untouched; only the chrome moved.
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { validateNewPassword } from '../utils/authValidation'
import AuthShell from '../components/AuthShell.vue'
import Alert from '../components/ui/Alert.vue'
import Button from '../components/ui/Button.vue'
import Input from '../components/ui/Input.vue'

const router = useRouter()
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

async function handleSetPassword() {
  loading.value = true
  errorMessage.value = ''
  successMessage.value = ''

  const validationError = validateNewPassword(password.value, confirmPassword.value)
  if (validationError) {
    errorMessage.value = validationError
    loading.value = false
    return
  }

  const { error } = await supabase.auth.updateUser({
    password: password.value
  })

  if (error) {
    errorMessage.value = error.message
  } else {
    successMessage.value = 'Password set successfully. Redirecting...'
    setTimeout(() => {
      router.push('/account-pending')
    }, 1500)
  }

  loading.value = false
}
</script>

<template>
  <AuthShell
    title="Set Your Password"
    subtitle="Welcome to UDFC Dashboard. Please create a password to complete your account setup."
  >
    <form class="auth-form" @submit.prevent="handleSetPassword">
      <Alert v-if="errorMessage" tone="error">{{ errorMessage }}</Alert>
      <Alert v-if="successMessage" tone="success">{{ successMessage }}</Alert>

      <Input
        v-model="password"
        label="New Password"
        type="password"
        placeholder="Enter your new password"
        hint="At least 8 characters."
        required
        minlength="8"
        autocomplete="new-password"
      />

      <Input
        v-model="confirmPassword"
        label="Confirm Password"
        type="password"
        placeholder="Confirm your new password"
        required
        minlength="8"
        autocomplete="new-password"
      />

      <Button
        type="submit"
        size="lg"
        block
        :loading="loading"
        :disabled="!!successMessage"
      >
        {{ loading ? 'Setting password…' : 'Set Password' }}
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
