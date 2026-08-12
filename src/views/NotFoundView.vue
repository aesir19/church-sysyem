<script setup>
/**
 * Catch-all route. Closes docs/DEFECTS.md D13: before this existed, any unmatched
 * path rendered a completely blank white page, because vue-router matched nothing
 * and <router-view> had nothing to display.
 *
 * That stopped being cosmetic the moment check-in URLs started being printed on
 * posters. A mistyped, truncated, or retired QR link is now the most likely way
 * anyone reaches an unknown path, and a blank page gives an attendee standing in
 * a service no idea whether the link is wrong or the site is broken.
 *
 * Migrated with the auth family, which is where it
 * belongs visually: it is the fourth signed-out page, and it is reached from a
 * phone in a pew far more often than from a desk.
 */
import AuthShell from '../components/AuthShell.vue'
</script>

<template>
  <AuthShell
    centered
    title="Page not found"
    subtitle="The link you followed doesn't lead anywhere. If you scanned a QR code to check in, scan it again or ask a volunteer for help."
  >
    <router-link class="not-found-action" to="/login">Go to sign in</router-link>

    <!-- The shell's default footer names the staff dashboard. Whoever is
         reading this page most likely scanned a poster, so it says something
         useful to them instead. -->
    <template #footer>
      <p>United Door of Faith Church</p>
    </template>
  </AuthShell>
</template>

<style scoped>
/**
 * A link, not a `ui/Button`. It navigates, so it has to be an <a> — and
 * Button.vue renders a <button>, which would need a click handler and a
 * router push to do what an href does natively. Styled to match the primary
 * variant deliberately, since it is the same affordance.
 */
.not-found-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 var(--space-6);
  background: var(--color-accent);
  color: var(--color-text-on-accent);
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  font-weight: var(--font-weight-semibold);
  text-decoration: none;
  transition: background-color var(--duration-fast) var(--ease-standard);
}

.not-found-action:hover {
  background: var(--color-accent-hover);
}

.not-found-action:focus-visible {
  outline: 2px solid transparent;
  outline-offset: 2px;
  box-shadow: var(--shadow-focus-ring);
}
</style>
