<script setup lang="ts">
defineProps<{
  error?: string;
  loading?: boolean;
  title: string;
  empty?: boolean;
  emptyText?: string;
}>();
</script>

<template>
  <div v-if="loading" class="state-panel">
    <div class="skeleton-row wide" />
    <div class="skeleton-row" />
    <div class="skeleton-row short" />
  </div>
  <div v-else-if="error" class="state-panel error-state">
    <strong>{{ title }}</strong>
    <p>{{ error }}</p>
  </div>
  <div v-else-if="empty" class="state-panel">
    <strong>{{ title }}</strong>
    <p>{{ emptyText || "No data for the selected scope." }}</p>
  </div>
  <slot v-else />
</template>
