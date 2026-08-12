<script setup>
/**
 * Migrated with the rest of the auth family.
 *
 * The "Return to Login" button now goes through `useSession().signOut()` — the
 * one sign-out path (D12). It used to call `supabase.auth.signOut()` directly
 * and clear nothing, which on a shared browser left the previous user's cached
 * first name for the next person to be greeted by.
 */
import { useSession } from '../composables/useSession'
import AuthShell from '../components/AuthShell.vue'
import Alert from '../components/ui/Alert.vue'
import Button from '../components/ui/Button.vue'
import Icon from '../components/ui/icons/Icon.vue'

const { signOut } = useSession()
</script>

<template>
  <AuthShell
    max-width="480px"
    centered
    title="Account Setup In Progress"
    subtitle="Your password has been set successfully. Please wait while the administrators finish setting up your account."
  >
    <template #icon>
      <Icon name="clock" :size="40" class="pending-icon" />
    </template>

    <Alert tone="warning">
      <p>
        An administrator needs to link your account before you can access the dashboard.
        This is usually done within a short time.
      </p>
      <p>Once your account is ready, you can sign in using the login page.</p>
    </Alert>

    <Button class="pending-action" size="lg" @click="signOut">Return to Login</Button>

    <template #footer>
      <p>If you believe this is taking too long, please contact your church administrator.</p>
    </template>
  </AuthShell>
</template>

<style scoped>
.pending-icon {
  color: var(--color-warning);
  margin: var(--space-2) 0;
}

.pending-action {
  margin-top: var(--space-6);
}
</style>
