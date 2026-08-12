import { ref, computed, onMounted, onUnmounted } from 'vue'
import { readStoredTheme, writeStoredTheme, applyTheme, resolveTheme, THEMES } from '../utils/theme'

// Module-scoped so every consumer — the sidebar toggle, the profile page's
// three-way segmented control, the mobile More tab — reads and writes one
// value. Two independent refs would let the toggle and the control disagree.
const theme = ref(readStoredTheme())
const prefersDark = ref(false)

let query = null
let listeners = 0

function onChange (event) {
  prefersDark.value = event.matches
}

export function useTheme () {
  // `resolved` is what is on screen; `theme` is what the user asked for. The
  // toggle needs the first (to pick the icon), the segmented control needs the
  // second (to show which of three is selected).
  const resolved = computed(() => resolveTheme(theme.value, prefersDark.value))
  const isDark = computed(() => resolved.value === 'dark')

  function setTheme (next) {
    if (!THEMES.includes(next)) return
    theme.value = next
    writeStoredTheme(next)
    applyTheme(next)
  }

  // The sidebar's sun/moon button. It flips what you can currently see rather
  // than cycling all three, so a user on `system` in the dark who taps it gets
  // light — which is what they asked for — and lands on an explicit choice.
  function toggleTheme () {
    setTheme(isDark.value ? 'light' : 'dark')
  }

  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    if (!query) {
      query = window.matchMedia('(prefers-color-scheme: dark)')
      prefersDark.value = query.matches
    }
    if (listeners === 0) query.addEventListener('change', onChange)
    listeners += 1
  })

  onUnmounted(() => {
    listeners = Math.max(0, listeners - 1)
    if (listeners === 0 && query) query.removeEventListener('change', onChange)
  })

  return { theme, resolved, isDark, setTheme, toggleTheme, THEMES }
}
