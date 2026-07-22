<!-- apps/kimi-web/src/components/QuotaCard.vue -->
<!-- Persistent plan-quota card at the top of the sidebar. Shown only when the
     active model belongs to the managed Kimi Code provider. Fetches 5h/weekly
     windows from GET /oauth/usage, maps snake_case on the client, and drops
     in-flight responses after a model/provider change (generation guard). -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getKimiWebApi } from '../api';
import type { AppManagedUsageResult, AppModel, AppUsageRow } from '../api/types';
import {
  isManagedUsageProvider,
  pctOf,
  providerForActiveModel,
  severityOf,
  shortLabel,
  shouldApplyUsageFetch,
  shouldClearQuota,
  usageRowsFromResult,
} from '../lib/managedQuota';
import Button from './ui/Button.vue';
import Card from './ui/Card.vue';
import Spinner from './ui/Spinner.vue';

const props = defineProps<{
  /** Active model id from ConversationStatus (status.modelId). */
  modelId: string;
  /** Catalog used to resolve the provider of modelId. */
  models: readonly AppModel[];
}>();

const { t } = useI18n();

const result = ref<AppManagedUsageResult | null>(null);
const loading = ref(false);
const failed = ref(false);
/** Bumped on every provider/model change so stale responses are ignored. */
const generation = ref(0);

const activeProvider = computed(() =>
  providerForActiveModel(props.modelId, props.models),
);
const managed = computed(() => isManagedUsageProvider(activeProvider.value));

const rows = computed<AppUsageRow[]>(() => {
  const r = result.value;
  if (r === null || r.kind !== 'ok') return [];
  return usageRowsFromResult(r);
});

const visible = computed(
  () => managed.value && (rows.value.length > 0 || failed.value || loading.value),
);

const errorMessage = computed(() =>
  result.value?.kind === 'error'
    ? (result.value.message || t('status.quotaUnavailable'))
    : '',
);

function clearQuota(): void {
  result.value = null;
  failed.value = false;
  loading.value = false;
}

/**
 * @param force — true when the model/provider changed: re-enter even if a
 * previous generation is still loading (the generation guard drops its result).
 */
async function refresh(force = false): Promise<void> {
  const provider = activeProvider.value;
  if (!isManagedUsageProvider(provider)) {
    clearQuota();
    return;
  }
  if (loading.value && !force) return;

  const requestGen = generation.value;
  const requestProvider = provider;
  loading.value = true;
  try {
    const data = await getKimiWebApi().getManagedUsage(provider);
    if (
      !shouldApplyUsageFetch({
        requestGen,
        currentGen: generation.value,
        requestProvider,
        currentProvider: activeProvider.value,
      })
    ) {
      return;
    }
    result.value = data;
    failed.value = data.kind === 'error';
  } catch {
    if (
      !shouldApplyUsageFetch({
        requestGen,
        currentGen: generation.value,
        requestProvider,
        currentProvider: activeProvider.value,
      })
    ) {
      return;
    }
    failed.value = true;
    result.value = null;
  } finally {
    if (requestGen === generation.value) {
      loading.value = false;
    }
  }
}

// Re-fetch when the active model (hence provider) changes; clear for non-managed.
watch(
  () => [props.modelId, activeProvider.value] as const,
  () => {
    generation.value += 1;
    if (shouldClearQuota(activeProvider.value)) {
      clearQuota();
      return;
    }
    // Drop previous payload while the new fetch is in flight so a stale
    // managed → managed switch does not flash the previous model's bars.
    result.value = null;
    failed.value = false;
    void refresh(true);
  },
  { immediate: true },
);
</script>

<template>
  <Card v-if="visible" class="quota-card">
    <template #head>
      <span class="quota-title">{{ t('status.quotaTitle') }}</span>
      <Button
        class="quota-refresh"
        variant="ghost"
        size="sm"
        type="button"
        :disabled="loading"
        :loading="loading"
        @click="refresh"
      >
        {{ loading ? t('status.quotaRefreshing') : t('status.quotaRefresh') }}
      </Button>
    </template>

    <div v-if="loading && rows.length === 0 && !failed" class="quota-loading">
      <Spinner size="sm" :label="t('status.quotaRefreshing')" />
    </div>

    <div v-else-if="failed || result?.kind === 'error'" class="quota-error">
      <span class="quota-error-text">{{ errorMessage || t('status.quotaUnavailable') }}</span>
      <Button variant="ghost" size="sm" type="button" @click="refresh">
        {{ t('status.quotaRetry') }}
      </Button>
    </div>

    <div v-else class="quota-rows">
      <div v-for="row in rows" :key="row.label" class="quota-row">
        <div class="quota-row-top">
          <span class="quota-label">{{ shortLabel(row.label) }}</span>
          <span class="quota-pct" :data-sev="severityOf(row)">
            {{ t('status.quotaUsed', { pct: pctOf(row) }) }}
          </span>
        </div>
        <div class="quota-bar">
          <i
            :data-sev="severityOf(row)"
            :style="{ width: pctOf(row) + '%' }"
          ></i>
        </div>
      </div>
    </div>
  </Card>
</template>

<style scoped>
.quota-card {
  margin: 0 var(--space-3) var(--space-2);
  flex: none;
}
.quota-card :deep(.ui-card__head) {
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.quota-card :deep(.ui-card__body) {
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.quota-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quota-refresh {
  flex: none;
  /* ghost sm is 30px tall; compact for the head row */
  height: 24px;
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
  color: var(--color-accent);
}

.quota-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
}

.quota-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.quota-row-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}
.quota-label {
  font-size: var(--text-sm);
  color: var(--color-text);
  font-weight: var(--weight-medium);
}
.quota-pct {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.quota-pct[data-sev='warn'] { color: var(--color-warning); }
.quota-pct[data-sev='danger'] { color: var(--color-danger); }

.quota-bar {
  width: 100%;
  height: 5px;
  margin-top: 3px;
  border-radius: var(--radius-full);
  background: var(--color-line);
  overflow: hidden;
}
.quota-bar i {
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--color-accent);
  transition: width var(--duration-base) var(--ease-out);
}
.quota-bar i[data-sev='warn'] { background: var(--color-warning); }
.quota-bar i[data-sev='danger'] { background: var(--color-danger); }

.quota-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.quota-error-text {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
