<template>
  <nav v-if="isFinance" class="funds-tabs" aria-label="Church funds sections">
    <router-link to="/dashboard/funds/reports" class="funds-tab">Reports</router-link>
    <router-link to="/dashboard/funds/collections" class="funds-tab">Collections</router-link>
    <router-link to="/dashboard/funds/expenses" class="funds-tab">Expenses</router-link>
  </nav>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { supabase } from '../lib/supabase'

const isFinance = ref(false)

onMounted(async () => {
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data } = await supabase
      .from('user_accounts')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    isFinance.value = data?.role === 'finance'
  }
})
</script>

<style scoped>
.funds-tabs {
  display: inline-flex;
  gap: 6px;
  padding: 6px;
  background: #e2e8f0;
  border-radius: 12px;
  border: 1px solid #cbd5e1;
  width: fit-content;
}

.funds-tab {
  text-decoration: none;
  color: #334155;
  font-size: 13px;
  font-weight: 700;
  padding: 8px 12px;
  border-radius: 9px;
  transition: background 0.15s, color 0.15s;
}

.funds-tab:hover {
  background: #ffffff;
  color: #0f172a;
}

.funds-tab.router-link-active {
  background: #1a56db;
  color: #ffffff;
  box-shadow: 0 6px 14px rgba(37, 99, 235, 0.25);
}
</style>
