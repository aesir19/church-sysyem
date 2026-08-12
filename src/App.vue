<script setup>
/**
 * `ToastHost` is mounted once, here, beside the router view. It is
 * deliberately NOT lazy: a toast reports the outcome of
 * something that already happened, so a host that had to be fetched first
 * would announce it late or not at all.
 *
 * It costs the shared entry chunk a small amount for every visitor, including
 * `/checkin` — which is why the Reka UI toast was declined in favour of this
 * hand-rolled one (ADR-0011). The dependency stays confined to `Modal.vue`,
 * and therefore to the dashboard chunks that import it.
 */
import ToastHost from './components/ui/ToastHost.vue'
</script>

<template>
  <router-view />
  <ToastHost />
</template>
