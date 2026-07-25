// apps/kimi-web/src/lib/managedQuota.ts
// Pure helpers for the managed-plan QuotaCard: provider resolution, severity,
// row shaping, and the generation/stale guard used when the active model
// (hence provider) changes mid-fetch.

/** Canonical managed OAuth provider id — matches kap-server / oauth toolkit. */
export const MANAGED_KIMI_CODE_PROVIDER = 'managed:kimi-code';

export type QuotaSeverity = 'ok' | 'warn' | 'danger';

export interface QuotaModelRef {
  id: string;
  provider: string;
  /** Raw model name — used as a fallback match when id lookup misses. */
  model?: string;
}

export interface QuotaUsageRow {
  label: string;
  used: number;
  limit: number;
  resetHint?: string;
}

export interface QuotaUsageOk {
  kind: 'ok';
  summary: QuotaUsageRow | null;
  limits: QuotaUsageRow[];
}

/** True only for the managed Kimi Code OAuth provider. */
export function isManagedUsageProvider(
  provider: string | null | undefined,
): provider is typeof MANAGED_KIMI_CODE_PROVIDER {
  return provider === MANAGED_KIMI_CODE_PROVIDER;
}

/**
 * Resolve the provider of the active model from status.modelId + the catalog.
 * Prefer exact id match; fall back to raw model name (display names collide).
 */
export function providerForActiveModel(
  modelId: string | null | undefined,
  models: readonly QuotaModelRef[],
): string | undefined {
  if (modelId === null || modelId === undefined || modelId.length === 0) {
    return undefined;
  }
  const matched =
    models.find((m) => m.id === modelId) ?? models.find((m) => m.model === modelId);
  return matched?.provider;
}

/** Severity thresholds shared with the TUI footer (0.5 warn / 0.85 danger). */
export function severityOf(row: { used: number; limit: number }): QuotaSeverity {
  if (row.limit <= 0) return 'ok';
  const ratio = row.used / row.limit;
  if (ratio >= 0.85) return 'danger';
  if (ratio >= 0.5) return 'warn';
  return 'ok';
}

/** Percent 0–100 for a quota bar (ceil, clamped). */
export function pctOf(row: { used: number; limit: number }): number {
  if (row.limit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.ceil((row.used / row.limit) * 100)));
}

/** Strip a trailing " limit" for compact display ("5h limit" → "5h"). */
export function shortLabel(label: string): string {
  return label.replace(/\s+limit$/i, '');
}

/** Weekly summary first, then each window limit in arrival order. */
export function usageRowsFromResult(result: QuotaUsageOk | null | undefined): QuotaUsageRow[] {
  if (result === null || result === undefined || result.kind !== 'ok') return [];
  const out: QuotaUsageRow[] = [];
  if (result.summary !== null) out.push(result.summary);
  out.push(...result.limits);
  return out;
}

/**
 * Whether an in-flight fetch result may still be applied. Bump `currentGen` on
 * every provider/model change (and on cancel); the response is dropped when
 * the generation no longer matches, or when the provider is no longer managed.
 */
export function shouldApplyUsageFetch(input: {
  requestGen: number;
  currentGen: number;
  requestProvider: string | undefined;
  currentProvider: string | undefined;
}): boolean {
  if (input.requestGen !== input.currentGen) return false;
  if (input.requestProvider !== input.currentProvider) return false;
  return isManagedUsageProvider(input.currentProvider);
}

/** Clear local quota state when leaving the managed provider. */
export function shouldClearQuota(provider: string | null | undefined): boolean {
  return !isManagedUsageProvider(provider);
}
