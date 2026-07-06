<template>
  <nav class="funds-tabs" aria-label="Church funds sections">
    <router-link to="/dashboard/funds/reports" class="funds-tab">Reports</router-link>
    <router-link to="/dashboard/funds/collections" class="funds-tab">Collections</router-link>
    <router-link to="/dashboard/funds/expenses" class="funds-tab">Expenses</router-link>
  </nav>
</template>

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
