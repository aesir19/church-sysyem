<script setup>
/**
 * The chrome every signed-out page wears: the gradient ground, one centred
 * card, the mark, a heading, and the standing footer note.
 *
 * WHY THIS EXISTS RATHER THAN THREE COPIES. LoginView, SetPasswordView and
 * AccountPendingView carried near-byte-identical markup and CSS for all of
 * that — same gradient, same 12px radius, same brand-tinted shadow, same
 * 0.85rem labels — differing only in max-width and wording. Three copies is
 * how the family drifts: the migration would have had to reconcile them
 * anyway, and leaving them separate would guarantee doing it again.
 *
 * It lives in `src/components/` rather than `src/components/ui/`: `ui/` is for
 * domain-blind primitives, and "the signed-out chrome of this church's
 * dashboard" is not one. It is composed FROM those primitives (Card), which is
 * the relationship intended.
 */
import AppLogo from './AppLogo.vue'
import Card from './ui/Card.vue'

defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  /** The auth family is 420px; the wordier pending page is 480px. */
  maxWidth: { type: String, default: '420px' },
  /** Centres the body copy, as the pending and not-found pages want. */
  centered: { type: Boolean, default: false },
})
</script>

<template>
  <main class="auth-page">
    <Card :max-width="maxWidth" padding="lg" elevation="md" :class="{ centered }">
      <header class="auth-header">
        <AppLogo :size="48" class="auth-logo" />
        <slot name="icon" />
        <h1 class="auth-title">{{ title }}</h1>
        <p v-if="subtitle" class="auth-subtitle">{{ subtitle }}</p>
      </header>

      <slot />

      <footer class="auth-footer">
        <slot name="footer">
          <p>Protected system for authorized church staff only.</p>
        </slot>
      </footer>
    </Card>
  </main>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  /* The three copies each hardcoded a light-blue gradient, which is exactly the
   * kind of literal that cannot follow the theme. Built from tokens, it goes
   * dark with everything else. */
  background:
    radial-gradient(circle at 15% 15%, var(--color-accent-subtle), transparent 55%),
    radial-gradient(circle at 85% 85%, var(--color-accent-subtle), transparent 55%),
    var(--color-bg-page);
}

.centered {
  text-align: center;
}

.auth-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-2);
  margin-bottom: var(--space-8);
}

.auth-logo {
  margin-bottom: var(--space-2);
}

.auth-title {
  font-size: var(--text-2xl);
  font-weight: var(--font-weight-extrabold);
  color: var(--color-text-primary);
  line-height: var(--leading-tight);
}

.auth-subtitle {
  font-size: var(--text-base);
  color: var(--color-text-secondary);
  line-height: var(--leading-normal);
}

.auth-footer {
  margin-top: var(--space-8);
  text-align: center;
}

/* `:deep` because the footer's content usually arrives through the slot, and a
 * scoped rule would otherwise not reach it. */
.auth-footer :deep(p) {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  line-height: var(--leading-normal);
}
</style>
