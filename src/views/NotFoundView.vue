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
 */
</script>

<template>
  <main class="not-found-page">
    <div class="not-found-card">
      <h1>Page not found</h1>
      <p class="detail">
        The link you followed doesn't lead anywhere. If you scanned a QR code to check in,
        scan it again or ask a volunteer for help.
      </p>
      <router-link class="btn-primary" to="/login">Go to sign in</router-link>
    </div>
  </main>
</template>

<style scoped>
.not-found-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: #f8fafc;
}

.not-found-card {
  width: 100%;
  max-width: 420px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 32px 24px;
  text-align: center;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
}

h1 {
  margin: 0 0 12px;
  font-size: 1.375rem;
  color: #1e293b;
}

.detail {
  margin: 0 0 24px;
  font-size: 0.9375rem;
  line-height: 1.6;
  color: #64748b;
}

.btn-primary {
  display: inline-block;
  padding: 12px 22px;
  font-size: 0.9375rem;
  font-weight: 600;
  color: #ffffff;
  background: #1a56db;
  border-radius: 8px;
  text-decoration: none;
}
</style>
