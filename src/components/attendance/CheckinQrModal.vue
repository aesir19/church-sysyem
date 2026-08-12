<script setup>
import { ref, watch } from 'vue'
import Modal from '../ui/Modal.vue'
import Button from '../ui/Button.vue'
import { supabase } from '../../lib/supabase'
import { writeRpc } from '../../lib/data/write'
import { showToast } from '../../composables/useToast'

// Dialog 07 — the QR for the door.
//
// THE ROTATE CONFIRM IS INLINE, not a second dialog. Rotation is the control
// ADR-0007 names for a leaked code, so it has to be reachable from here; but a
// confirm dialog opened over this one is two focus traps and two Escape
// handlers. The body swaps to the question instead, which is the same pattern
// the group roll uses for its add list.
//
// NOT BUILT, from the mockup's three buttons: "Print poster" and "Full screen".
// Both are new features rather than a repaint of an existing one — a poster
// needs a print stylesheet and a layout nobody has drawn, and full screen needs
// the Fullscreen API and a way back out of it. Copy link is here because it
// exists today.

const props = defineProps({
  open: { type: Boolean, default: false },
  checkinUrl: { type: String, default: '' },
  title: { type: String, default: 'Check-in' },
  // 'Open until 11:00 AM · closes automatically', or why it is shut.
  status: { type: String, default: '' },
  churchId: { type: String, default: '' },
  canRotate: { type: Boolean, default: false }
})

const emit = defineEmits(['update:open', 'rotated'])

const qrSvg = ref('')
const qrError = ref('')
const confirming = ref(false)
const rotating = ref(false)

watch(() => props.open, (open) => {
  if (!open) {
    confirming.value = false
    return
  }
  render()
})

// The link changes when it is rotated, so the code has to be redrawn rather
// than cached for the life of the component.
watch(() => props.checkinUrl, () => {
  qrSvg.value = ''
  if (props.open) render()
})

async function render () {
  if (!props.checkinUrl || qrSvg.value) return
  qrError.value = ''
  try {
    // Dynamically imported so the ~51 KB generator lands in its own chunk that
    // only staff who open this dialog ever download — attendees never do.
    const { default: qrcode } = await import('qrcode-generator')
    const qr = qrcode(0, 'M')
    qr.addData(props.checkinUrl)
    qr.make()
    // Rendered inline rather than fetched from a QR image API: an external URL
    // would need a CSP change, add a vendor, and hand the check-in token to it.
    qrSvg.value = qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true })
  } catch {
    qrError.value = 'The QR code could not be generated. The link below still works.'
  }
}

async function copyLink () {
  try {
    await navigator.clipboard.writeText(props.checkinUrl)
    showToast('Check-in link copied.')
  } catch {
    showToast('Could not copy. Select the link and copy it manually.', 'error')
  }
}

async function rotate () {
  rotating.value = true
  const result = await writeRpc(
    supabase.rpc('rotate_checkin_token', { p_church_id: props.churchId }),
    { messages: { denied: 'You cannot rotate the check-in link for that church.' } }
  )
  rotating.value = false

  if (!result.ok) {
    showToast(result.message, 'error')
    return
  }

  confirming.value = false
  emit('rotated', result.rows[0] || '')
  showToast({
    title: 'New check-in link generated.',
    body: 'Reprint the QR code — the old one no longer works.',
    type: 'success'
  })
}
</script>

<template>
  <Modal
    :open="open"
    :title="confirming ? 'Generate a new link?' : title"
    :description="confirming
      ? 'Every QR code already printed stops working the moment this is done. Use it if the code was shared outside the congregation.'
      : status || 'Print this once and post it where people arrive.'"
    width="sm"
    :layout="confirming ? 'stack' : 'row'"
    :icon="confirming ? 'alert' : ''"
    icon-tone="warning"
    :close-on-outside-click="!confirming"
    @update:open="$emit('update:open', $event)"
  >
    <template v-if="!confirming">
      <p
        v-if="qrError"
        class="qr__error"
        role="alert"
      >
        {{ qrError }}
      </p>

      <!-- eslint-disable-next-line vue/no-v-html -->
      <div
        v-else-if="qrSvg"
        class="qr__code"
        v-html="qrSvg"
      />
      <div
        v-else
        class="skeleton qr__skeleton"
      />

      <p class="qr__link">
        {{ checkinUrl || 'Unavailable' }}
      </p>
    </template>

    <template #footer>
      <template v-if="confirming">
        <Button
          block
          :disabled="rotating"
          @click="confirming = false"
        >
          Keep this link
        </Button>
        <Button
          block
          variant="danger"
          :loading="rotating"
          @click="rotate"
        >
          Generate a new one
        </Button>
      </template>

      <template v-else>
        <!-- Deliberately NOT dressed in danger red. ADR-0007 makes rotation the
             control when a code leaks, so styling it as a mistake discourages
             the one action we want reachable. The consequence is carried by the
             confirm above. -->
        <Button
          v-if="canRotate"
          class="footer-left"
          variant="ghost"
          @click="confirming = true"
        >
          Generate a new link
        </Button>
        <Button
          :disabled="!checkinUrl"
          @click="copyLink"
        >
          Copy link
        </Button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.qr__error {
  padding: var(--sp-10) var(--sp-12);
  border-radius: var(--r-inset);
  background: var(--magenta-tint);
  border: 1px solid var(--magenta-border);
  font-size: var(--text-body-sm);
  color: var(--magenta-darkest);
}

/* Always on white with black modules, in both themes. A QR code is read by a
   phone camera, and inverting it — or tinting it to the brand — is how a code
   stops scanning on cheap sensors in a dim hall. */
.qr__code {
  width: 190px;
  height: 190px;
  margin: 0 auto;
  padding: var(--sp-10);
  border-radius: var(--r-card);
  background: #fff;
}
.qr__code :deep(svg) { display: block; width: 100%; height: 100%; }

.qr__skeleton { width: 190px; height: 190px; margin: 0 auto; border-radius: var(--r-card); }

.qr__link {
  padding: var(--sp-9) var(--sp-12);
  border-radius: var(--r-control);
  background: var(--surface-subtle);
  border: 1px dashed var(--ink-6);
  font-size: var(--text-body-sm);
  color: var(--ink-3);
  text-align: center;
  word-break: break-all;
}
</style>
