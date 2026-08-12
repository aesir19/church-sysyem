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
  // Last resort: the local part of the address, tidied. "grace.abad" reads as
  // "grace abad", which titlecases into something a person recognises — but
  // "fjhaze1998" titlecases into "Fjhaze1998", which nobody is called. It is a
  // placeholder for an unlinked account, not a name.
  if (!user.email) return ''
  return user.email
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// The church's own record of this person, which is the name they answer to.
//
// Through an RPC rather than a select: `members_select_own_church` (0015)
// requires can_see_member_detail(), which Finance, Welcome Team and Head Pastor
// do not hold — a direct read would name four of the seven roles correctly and
// quietly fall back for the other three. get_my_profile() is SECURITY DEFINER
// and takes no argument, so it answers only "what is MY name" (0020).
//
// Any failure here is not an error worth surfacing. An unapplied migration, an
// account with no linked member yet, an offline moment: all of them mean "no
// name from the church record", and the greeting falls back to the auth user.
async function nameFromMemberRecord () {
  try {
    const { data, error } = await supabase.rpc('get_my_profile')
    if (error) return ''
    const row = Array.isArray(data) ? data[0] : data
    if (!row) return ''
    return [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  } catch {
    return ''
  }
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
    // The auth user first, then the church's record. The member name wins when
    // there is one: "Fjhaze" is an address, "Warren Ado" is a person.
    pending = supabase.auth.getUser()
      .then(async ({ data }) => {
        email.value = data?.user?.email || ''
        const fallback = nameFromUser(data?.user)
        const memberName = await nameFromMemberRecord()
        displayName.value = memberName || fallback
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
