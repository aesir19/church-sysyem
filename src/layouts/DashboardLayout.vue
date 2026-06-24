<template>
  <div class="layout">
    <AppSidebar :userName="userName" @logout="handleLogout" @collapse="onCollapse" />
    <div class="layout-main" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'
import AppSidebar from '../components/AppSidebar.vue'

const router = useRouter()
const sidebarCollapsed = ref(false)
const userName = ref('')

const USER_NAME_KEY = 'udfc.myUserName'

onMounted(async () => {
  // Try cached name first for instant render
  try { userName.value = localStorage.getItem(USER_NAME_KEY) || '' } catch {}

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data } = await supabase
      .from('user_accounts')
      .select('members(first_name)')
      .eq('id', user.id)
      .single()
    if (data?.members?.first_name) {
      userName.value = data.members.first_name
      try { localStorage.setItem(USER_NAME_KEY, userName.value) } catch {}
    }
  }
})

function onCollapse(isCollapsed) {
  sidebarCollapsed.value = isCollapsed
}

async function handleLogout() {
  try {
    localStorage.removeItem('udfc.myChurchName')
    localStorage.removeItem(USER_NAME_KEY)
  } catch {}
  await supabase.auth.signOut()
  router.push('/login')
}
</script>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
}

.layout-main {
  margin-left: 280px;
  flex: 1;
  transition: margin-left 0.25s ease;
  min-height: 100vh;
}

.layout-main.sidebar-collapsed {
  margin-left: 64px;
}
</style>
