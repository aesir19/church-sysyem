<template>
  <div class="pending-container">
    <div class="pending-card">
      <div class="pending-header">
        <div class="logo">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="48" height="48">
            <rect x="29" y="8" width="6" height="28" fill="#1a56db" rx="1"/>
            <rect x="20" y="17" width="24" height="6" fill="#1a56db" rx="1"/>
            <path d="M16 38 h32 v22 H16z" fill="#1a56db" opacity="0.15" rx="2"/>
            <path d="M16 38 h32" stroke="#1a56db" stroke-width="3" fill="none" stroke-linecap="round"/>
            <rect x="28" y="46" width="8" height="14" fill="#1a56db" rx="1"/>
          </svg>
        </div>
        <div class="icon-pending">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <h1>Account Setup In Progress</h1>
        <p class="subtitle">Your password has been set successfully. Please wait while the administrators finish setting up your account.</p>
      </div>

      <div class="info-box">
        <p>An administrator needs to link your account before you can access the dashboard. This is usually done within a short time.</p>
        <p>Once your account is ready, you can sign in using the login page.</p>
      </div>

      <button class="btn-logout" @click="handleLogout">
        Return to Login
      </button>

      <div class="pending-footer">
        <p>If you believe this is taking too long, please contact your church administrator.</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { supabase } from '../lib/supabase'

const router = useRouter()

async function handleLogout() {
  await supabase.auth.signOut()
  router.push('/login')
}
</script>

<style scoped>
.pending-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f0f7ff 0%, #e8f0fe 50%, #dbeafe 100%);
  padding: 1rem;
}

.pending-card {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(26, 86, 219, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04);
  padding: 2.5rem;
  width: 100%;
  max-width: 480px;
  text-align: center;
}

.pending-header {
  margin-bottom: 1.5rem;
}

.logo {
  margin-bottom: 1rem;
}

.icon-pending {
  margin-bottom: 1rem;
}

.pending-header h1 {
  font-size: 1.4rem;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 0.75rem;
}

.subtitle {
  color: #64748b;
  font-size: 0.95rem;
  line-height: 1.5;
}

.info-box {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 1.5rem;
  text-align: left;
}

.info-box p {
  font-size: 0.85rem;
  color: #92400e;
  line-height: 1.5;
  margin: 0;
}

.info-box p + p {
  margin-top: 0.75rem;
}

.btn-logout {
  padding: 0.75rem 1.5rem;
  background: #1a56db;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}

.btn-logout:hover {
  background: #1544b8;
}

.btn-logout:active {
  transform: scale(0.98);
}

.pending-footer {
  margin-top: 2rem;
}

.pending-footer p {
  font-size: 0.8rem;
  color: #94a3b8;
}
</style>
