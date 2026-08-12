<template>
  <div
    v-if="showChurchSelector"
    class="church-switcher"
  >
    <div class="church-switcher-inner">
      <span
        class="church-switcher-icon"
        aria-hidden="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
          <path d="M12 6v4" />
          <path d="M9 10h6" />
          <circle
            cx="12"
            cy="16"
            r="2"
          />
        </svg>
      </span>

      <div class="church-switcher-field">
        <label
          for="active-church-select"
          class="church-switcher-label"
        >Viewing church</label>
        <div class="church-switcher-select-wrap">
          <select
            id="active-church-select"
            class="church-switcher-select"
            :value="activeChurchId"
            @change="onChange"
          >
            <option
              v-for="c in churches"
              :key="c.id"
              :value="c.id"
            >
              {{ c.name }}
            </option>
          </select>
          <span
            class="church-switcher-chevron"
            aria-hidden="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </div>

      <span class="church-switcher-badge">All churches</span>
    </div>
  </div>
</template>

<script setup>
// Shown only to SuperAdmin / Head Pastor (cross-church). Choosing a church sets the
// shared activeChurchId that every dashboard view scopes to.
import { onMounted } from 'vue'
import { useActiveChurch } from '../composables/useActiveChurch'

const { activeChurchId, churches, showChurchSelector, ensureLoaded, setActiveChurch } = useActiveChurch()

onMounted(ensureLoaded)

function onChange(event) {
  setActiveChurch(event.target.value)
}
</script>

<style scoped>
.church-switcher {
  background: #ffffff;
  border-bottom: 1px solid #e8edf5;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.church-switcher-inner {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 28px;
}

.church-switcher-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 11px;
  background: rgba(26, 86, 219, 0.09);
  color: #1a56db;
}

.church-switcher-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.church-switcher-label {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #94a3b8;
}

.church-switcher-select-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.church-switcher-select {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  padding: 7px 38px 7px 12px;
  border: 1px solid #dbe3ef;
  border-radius: 10px;
  background: #f8fafc;
  color: #1e293b;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  cursor: pointer;
  min-width: 210px;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}

.church-switcher-select:hover {
  background: #ffffff;
  border-color: #c3cfe2;
}

.church-switcher-select:focus {
  outline: none;
  background: #ffffff;
  border-color: #1a56db;
  box-shadow: 0 0 0 3px rgba(26, 86, 219, 0.14);
}

.church-switcher-chevron {
  position: absolute;
  right: 11px;
  display: inline-flex;
  align-items: center;
  color: #64748b;
  pointer-events: none;
}

.church-switcher-badge {
  margin-left: auto;
  padding: 5px 11px;
  border-radius: 999px;
  background: rgba(26, 86, 219, 0.08);
  color: #1a56db;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .church-switcher-inner {
    padding: 12px 18px;
  }
  .church-switcher-badge {
    display: none;
  }
  .church-switcher-select {
    min-width: 150px;
  }
}
</style>
