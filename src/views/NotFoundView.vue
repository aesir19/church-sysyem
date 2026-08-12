<script setup>
/**
 * Catch-all route. Before this existed, any unmatched path rendered a blank
 * white page, because vue-router matched nothing and <router-view> had nothing
 * to display.
 *
 * That stopped being cosmetic the moment check-in URLs started being printed on
 * posters. A mistyped, truncated or retired QR link is the most likely way
 * anyone reaches an unknown path, and a blank page gives an attendee standing
 * in a service no idea whether the link is wrong or the site is broken — so the
 * copy names that case first.
 *
 * BOTH ACTIONS ARE LINKS. They navigate, so they have to be anchors: keyboard
 * activation, middle-click and "open in new tab" come from the element, not
 * from the styling. `ui/Button` renders a RouterLink when given `to`, which is
 * exactly that.
 */
import AuthShell from '../components/AuthShell.vue'
import Button from '../components/ui/Button.vue'
</script>

<template>
  <AuthShell
    :card="false"
    :icon="false"
    width="md"
  >
    <template #badge>
      <p
        class="nf__code"
        aria-hidden="true"
      >
        404
      </p>
    </template>

    <div class="nf__head">
      <h1 class="nf__title">
        Page not found
      </h1>
      <p class="nf__body">
        That address doesn't exist here. If you followed a QR code, the check-in
        link may have expired.
      </p>
    </div>

    <div class="nf__actions">
      <Button
        variant="primary"
        to="/dashboard"
      >
        Back to dashboard
      </Button>
      <Button to="/login">
        Sign in
      </Button>
    </div>

    <template #footnote>
      United Door of Faith Church
    </template>
  </AuthShell>
</template>

<style scoped>
/* The one place in the app where both brand colours meet. It is decoration, so
   it is aria-hidden and the <h1> below carries the meaning — a screen reader
   announcing "four hundred and four" helps nobody. */
.nf__code {
  font-size: 74px;
  font-weight: 800;
  letter-spacing: -0.06em;
  line-height: 1;
  background: linear-gradient(100deg, var(--accent), var(--magenta));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.nf__head { display: flex; flex-direction: column; gap: var(--sp-9); }

.nf__title {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: var(--tracking-h1);
  line-height: 1.2;
  color: var(--ink);
}

.nf__body {
  font-size: var(--text-body);
  color: var(--ink-4);
  line-height: 1.6;
}

.nf__actions { display: flex; gap: var(--sp-9); justify-content: center; flex-wrap: wrap; }
</style>
