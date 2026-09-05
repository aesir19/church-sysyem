import { ref } from 'vue'

// A tab-local UI flow marker, never an authorization credential. Supabase still
// verifies the session and enforces the password update on its Auth API.
const key = 'udfc-password-recovery-user'
const callback = new URLSearchParams(window.location.hash.slice(1))
const query = new URLSearchParams(window.location.search)
const newCallback = ['access_token', 'error', 'error_code', 'type', 'code'].some(name => callback.has(name) || query.has(name))

function readUser () {
  try { return newCallback ? '' : window.sessionStorage.getItem(key) || '' } catch { return '' }
}

export const recoveryUserId = ref(readUser())

export function setRecoveryUser (id = '') {
  recoveryUserId.value = id
  try {
    if (id) window.sessionStorage.setItem(key, id)
    else window.sessionStorage.removeItem(key)
  } catch { /* The current flow still works if tab storage is unavailable. */ }
}

if (newCallback) setRecoveryUser()

export function isRecoverySession (session) {
  return !!recoveryUserId.value && session?.user?.id === recoveryUserId.value
}
