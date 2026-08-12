import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'

// The signed-in person's display name.
//
// This is NOT in useCurrentRole, deliberately: that composable wraps the
// get_my_permissions() RPC, which answers "what may this account do" and
// returns no name at all. The name lives on the auth user. Two different
// questions, two different sources, and merging them would make one cache
// invalidation problem out of two simple ones.
//
// Module-scoped so the sidebar's user card and the Overview greeting resolve
// the same value from one round-trip rather than two.

const displayName = ref('')
const email = ref('')
let loaded = false
let pending = null

function nameFromUser (user) {
  if (!user) return ''
  const meta = user.user_metadata || {}
  if (meta.full_name) return meta.full_name
  if (meta.name) return meta.name
  // Fall back to the local part of the address, tidied: "grace.abad" reads as
  // "grace abad", which titlecases into something a person recognises.
  if (!user.email) return ''
  return user.email
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export function clearCurrentUser () {
  displayName.value = ''
  email.value = ''
  loaded = false
  pending = null
}

export function useCurrentUser () {
  async function load (force = false) {
    if (loaded && !force) return displayName.value
    if (pending) return pending
    pending = supabase.auth.getUser()
      .then(({ data }) => {
        displayName.value = nameFromUser(data?.user)
        email.value = data?.user?.email || ''
        loaded = true
        pending = null
        return displayName.value
      })
      .catch(() => {
        pending = null
        return ''
      })
    return pending
  }

  // Just the first word — "Good morning, Grace", not the full name.
  const firstName = computed(() => (displayName.value || '').split(' ')[0] || '')

  return { displayName, email, firstName, load }
}
