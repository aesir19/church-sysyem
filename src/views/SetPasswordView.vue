<template>
  <div class="set-password-container">
    <div class="set-password-card">
      <div class="set-password-header">
        <div class="logo">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="48" height="48">
            <rect x="29" y="8" width="6" height="28" fill="#1a56db" rx="1"/>
            <rect x="20" y="17" width="24" height="6" fill="#1a56db" rx="1"/>
            <path d="M16 38 h32 v22 H16z" fill="#1a56db" opacity="0.15" rx="2"/>
            <path d="M16 38 h32" stroke="#1a56db" stroke-width="3" fill="none" stroke-linecap="round"/>
            <rect x="28" y="46" width="8" height="14" fill="#1a56db" rx="1"/>
          </svg>
        </div>
        <h1>Set Your Password</h1>
        <p class="subtitle">Welcome to UDFC Dashboard. Please create a password to complete your account setup.</p>
      </div>

      <form @submit.prevent="handleSetPassword" class="set-password-form">
        <div v-if="errorMessage" class="error-message">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <span>{{ errorMessage }}</span>
        </div>

        <div v-if="successMessage" class="success-message">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span>{{ successMessage }}</span>
        </div>

        <div class="form-group">
          <label for="password">New Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            placeholder="Enter your new password"
            required
            minlength="8"
            autocomplete="new-password"
          />
        </div>

        <div class="form-group">
          <label for="confirmPassword">Confirm Password</label>
          <input
            id="confirmPassword"
            v-model="confirmPassword"
            type="password"
            placeholder="Confirm your new password"
            required
            minlength="8"
            autocomplete="new-password"
          />
        </div>

        <button type="submit" class="btn-submit" :disabled="loading || !!successMessage">
          <span v-if="loading" class="spinner"></span>
          <span v-else>Set Password</span>
        </button>
      </form>

      <div class="set-password-footer">
        <p>Protected system for authorized church staff only.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import { validateNewPassword } from '../utils/authValidation'

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

<style scoped>
.set-password-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f0f7ff 0%, #e8f0fe 50%, #dbeafe 100%);
  padding: 1rem;
}

.set-password-card {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(26, 86, 219, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04);
  padding: 2.5rem;
  width: 100%;
  max-width: 420px;
}

.set-password-header {
  text-align: center;
  margin-bottom: 2rem;
}

.logo {
  margin-bottom: 1rem;
}

.set-password-header h1 {
  font-size: 1.5rem;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 0.5rem;
}

.subtitle {
  color: #64748b;
  font-size: 0.9rem;
}

.set-password-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.form-group label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #374151;
}

.form-group input {
  padding: 0.75rem 1rem;
  border: 1.5px solid #d1d5db;
  border-radius: 8px;
  font-size: 0.95rem;
  color: #1e293b;
  transition: border-color 0.2s, box-shadow 0.2s;
  outline: none;
}

.form-group input:focus {
  border-color: #1a56db;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.1);
}

.form-group input::placeholder {
  color: #9ca3af;
}

.btn-submit {
  padding: 0.8rem;
  background: #1a56db;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  margin-top: 0.5rem;
}

.btn-submit:hover:not(:disabled) {
  background: #1544b8;
}

.btn-submit:active:not(:disabled) {
  transform: scale(0.98);
}

.btn-submit:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2.5px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #dc2626;
  font-size: 0.85rem;
}

.success-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  color: #16a34a;
  font-size: 0.85rem;
}

.set-password-footer {
  margin-top: 2rem;
  text-align: center;
}

.set-password-footer p {
  font-size: 0.8rem;
  color: #94a3b8;
}
</style>
