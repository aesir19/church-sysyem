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
const loadError = ref('')
const loading = ref(false)
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
    loading.value = true
    loadError.value = ''
    try {
      const permissionResult = await loadPermissions()
      if (permissionResult === null) throw new Error('permissions unavailable')

      const homeRes = await supabase.rpc('get_my_church').maybeSingle()
      if (homeRes?.error) throw homeRes.error
      const nextHome = homeRes?.data || null

      let nextChurches = []
      if (isCrossChurch.value) {
        const listRes = await supabase.rpc('list_churches')
        if (listRes?.error) throw listRes.error
        nextChurches = listRes?.data || []
      }

      homeChurch.value = nextHome
      churches.value = nextChurches
      if (nextHome?.name) writeCachedChurchName(nextHome.name)
      if (!activeChurchId.value) {
        // Default: home church first; fall back to the first listed church.
        activeChurchId.value = nextHome?.id || nextChurches[0]?.id || null
      }
      loaded = true
      return activeChurchId.value
    } catch {
      // A failed lookup is not a loaded result. The next call must be able to retry.
      loaded = false
      loadError.value = 'Could not load your church. Please try again.'
      return null
    } finally {
      loading.value = false
      pending = null
    }
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
  loadError.value = ''
  loading.value = false
  loaded = false
  pending = null
}

// Reset ONLY on a real sign-out. Supabase re-emits SIGNED_IN / TOKEN_REFRESHED on
// token refresh and tab focus (which navigation can trigger); clearing on those wiped
// the selected church and snapped the view back to the home church mid-session. A new
// user signs in after a SIGNED_OUT, which has already reset this. Guarded for tests.
if (typeof supabase.auth?.onAuthStateChange === 'function') {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') clearActiveChurch()
  })
}

export function useActiveChurch() {
  return {
    homeChurch,
    churches,
    activeChurchId,
    activeChurchName,
    showChurchSelector,
    loadError,
    loading,
    ensureLoaded,
    setActiveChurch,
  }
}
