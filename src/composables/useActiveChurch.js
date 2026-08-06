import { ref, computed } from 'vue'
import { supabase } from '../lib/supabase'
import { useCurrentRole } from './useCurrentRole'

// The "active church" every dashboard view scopes to.
//
// For an ordinary single-church user this is simply their own church (resolved via
// get_my_church()), the church selector is hidden, and nothing changes. For a
// SuperAdmin / Head Pastor — who can read every church under RLS — this holds the
// ONE church currently selected, so each page shows a single church at a time
// instead of merging them. Views must filter their queries by activeChurchId
// explicitly: RLS returns all churches to these roles, so the app does the scoping.
//
// Default is the user's home church (get_my_church), per the owner's choice.

const CHURCH_NAME_KEY = 'udfc.myChurchName'

function writeCachedChurchName(name) {
  try {
    if (name) localStorage.setItem(CHURCH_NAME_KEY, name)
  } catch { /* private mode — ignore */ }
}

const homeChurch = ref(null)   // { id, name } — the caller's own linked church
const churches = ref([])       // [{ id, name }] for cross-church users; [] otherwise
const activeChurchId = ref(null)
let loaded = false
let pending = null

const { isCrossChurch, loadPermissions } = useCurrentRole()

const activeChurchName = computed(() => {
  const id = activeChurchId.value
  const inList = churches.value.find((c) => c.id === id)
  if (inList) return inList.name
  if (homeChurch.value && homeChurch.value.id === id) return homeChurch.value.name
  return homeChurch.value?.name || ''
})

// The selector renders only when the caller can span churches AND there is a list
// to choose from.
const showChurchSelector = computed(() => isCrossChurch.value && churches.value.length > 1)

async function ensureLoaded(force = false) {
  if (loaded && !force) return activeChurchId.value
  if (pending) return pending
  pending = (async () => {
    await loadPermissions()

    const homeRes = await supabase.rpc('get_my_church').maybeSingle()
    homeChurch.value = homeRes?.data || null
    if (homeChurch.value?.name) writeCachedChurchName(homeChurch.value.name)

    if (isCrossChurch.value) {
      const listRes = await supabase.rpc('list_churches')
      churches.value = listRes?.data || []
    } else {
      churches.value = []
    }

    if (!activeChurchId.value) {
      // Default: home church first; fall back to the first listed church.
      activeChurchId.value = homeChurch.value?.id || churches.value[0]?.id || null
    }
    loaded = true
    pending = null
    return activeChurchId.value
  })()
  return pending
}

function setActiveChurch(id) {
  if (!id || id === activeChurchId.value) return
  activeChurchId.value = id
  const name = churches.value.find((c) => c.id === id)?.name
  if (name) writeCachedChurchName(name)
}

export function clearActiveChurch() {
  homeChurch.value = null
  churches.value = []
  activeChurchId.value = null
  loaded = false
  pending = null
}

// Reset when the user changes so one account's church list never leaks to the next.
if (typeof supabase.auth?.onAuthStateChange === 'function') {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
      clearActiveChurch()
    }
  })
}

export function useActiveChurch() {
  return {
    homeChurch,
    churches,
    activeChurchId,
    activeChurchName,
    showChurchSelector,
    ensureLoaded,
    setActiveChurch,
  }
}
