<template>
  <aside :class="['sidebar', { collapsed }]">
    <div class="sidebar-top">
      <div class="sidebar-brand">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/>
          <path d="M12 6v4"/>
          <path d="M9 10h6"/>
          <circle cx="12" cy="16" r="2"/>
        </svg>
        <span v-show="!collapsed" class="brand-text">United Door of Faith Church Dashboard</span>
      </div>
      <button class="sidebar-toggle" @click="toggleSidebar" :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline v-if="collapsed" points="9 18 15 12 9 6"/>
          <polyline v-else points="15 18 9 12 15 6"/>
        </svg>
      </button>
    </div>

    <nav class="sidebar-nav">
      <router-link
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :title="item.label"
      >
        <span class="nav-icon" v-html="item.icon"></span>
        <span v-show="!collapsed" class="nav-label">{{ item.label }}</span>
      </router-link>
    </nav>

    <div class="sidebar-bottom">
      <div class="sidebar-user" :title="collapsed ? 'Hello, ' + displayName + '!' : ''">
        <div class="user-avatar">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
            <line x1="9" y1="9" x2="9.01" y2="9"/>
            <line x1="15" y1="9" x2="15.01" y2="9"/>
          </svg>
        </div>
        <span v-show="!collapsed" class="user-greeting">Hello, {{ displayName }}!</span>
      </div>
      <button class="nav-item sign-out-btn" @click="$emit('logout')" title="Sign Out">
        <span class="nav-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </span>
        <span v-show="!collapsed" class="nav-label">Sign Out</span>
      </button>
    </div>
  </aside>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useCurrentRole } from '../composables/useCurrentRole'

const props = defineProps({
  userName: { type: String, default: '' }
})

const emit = defineEmits(['logout', 'collapse'])

const collapsed = ref(false)

// Presentation only — the router guard and RLS are the real gates. Attendance and
// Church Funds nav items are hidden from users who cannot view those areas.
const { canViewAttendance, canViewFinance } = useCurrentRole()

const displayName = computed(() => {
  return props.userName || 'User'
})

function toggleSidebar() {
  collapsed.value = !collapsed.value
  emit('collapse', collapsed.value)
}

// `cap` names the capability required to see the item; undefined = always visible.
const allNavItems = [
  {
    to: '/dashboard/members',
    label: 'Members',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>`
  },
  {
    to: '/dashboard/ministry',
    label: 'Ministries & Small Groups',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/>
      <path d="M2 17l10 5 10-5"/>
      <path d="M2 12l10 5 10-5"/>
    </svg>`
  },
  {
    to: '/dashboard/attendance',
    label: 'Attendance',
    cap: 'canViewAttendance',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 11l3 3L22 4"/>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>`
  },
  {
    to: '/dashboard/funds',
    label: 'Church Funds',
    cap: 'canViewFinance',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>`
  }
]

const capFlags = { canViewAttendance, canViewFinance }
const navItems = computed(() =>
  allNavItems.filter((item) => !item.cap || capFlags[item.cap]?.value)
)
</script>

<style scoped>
.sidebar {
  width: 280px;
  min-height: 100vh;
  background: #1e293b;
  color: #e2e8f0;
  display: flex;
  flex-direction: column;
  transition: width 0.25s ease;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 100;
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 12px;
  border-bottom: 1px solid #334155;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
}

.brand-text {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.3;
}

.sidebar-toggle {
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s;
}

.sidebar-toggle:hover {
  color: #e2e8f0;
  background: #334155;
}

.sidebar-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  overflow: hidden;
}

.user-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: #334155;
  border-radius: 50%;
  flex-shrink: 0;
  color: #94a3b8;
}

.user-greeting {
  font-size: 13px;
  color: #cbd5e1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  color: #94a3b8;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
  cursor: pointer;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
}

.nav-item:hover {
  background: #334155;
  color: #e2e8f0;
}

.nav-item.router-link-active {
  background: #3b82f6;
  color: #ffffff;
}

.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}

.nav-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sidebar-bottom {
  padding: 12px 8px;
  border-top: 1px solid #334155;
}

.sign-out-btn {
  color: #f87171;
}

.sign-out-btn:hover {
  background: #451a1a;
  color: #fca5a5;
}
</style>
