/**
 * Pure footer plan-quota readout helpers. ANSI-free so unit tests stay simple;
 * the footer applies palette colours from each part's severity.
 *
 * Example: summary `1w limit` + limit `5h limit` → `1w: 12% 5h: 40%`.
 */

import type { ManagedUsageReport, ManagedUsageRow } from '#/tui/components/messages/usage-panel';
import { ratioSeverity, usagePercent } from '#/utils/usage/usage-format';

export interface ManagedUsageFooterPart {
  readonly text: string;
  readonly severity: 'ok' | 'warn' | 'danger';
}

export type ManagedUsageFooterView =
  | { readonly kind: 'error'; readonly text: string }
  | { readonly kind: 'ok'; readonly parts: readonly ManagedUsageFooterPart[] };

/**
 * Build the structured left-slot content for the footer plan-quota line.
 * Returns null when there is nothing to render (no error and no rows).
 */
export function buildManagedUsageFooterView(
  usage: ManagedUsageReport | null | undefined,
  error: string | null | undefined,
): ManagedUsageFooterView | null {
  if (error !== null && error !== undefined) {
    return { kind: 'error', text: `quota: ${error}` };
  }
  if (usage === null || usage === undefined) return null;

  const rows: ManagedUsageRow[] = [];
  if (usage.summary !== null) rows.push(usage.summary);
  rows.push(...usage.limits);
  if (rows.length === 0) return null;

  const parts = rows.map((row) => {
    const pct = usagePercent(row.used, row.limit);
    const label = row.label.replace(/\s+limit$/i, '');
    const severity = ratioSeverity(row.limit > 0 ? row.used / row.limit : 0);
    return { text: `${label}: ${String(pct)}%`, severity };
  });
  return { kind: 'ok', parts };
}

/** Compact plain-text form of the footer quota readout (no colours). */
export function formatManagedUsageFooterPlain(
  usage: ManagedUsageReport | null | undefined,
  error: string | null | undefined,
): string | null {
  const view = buildManagedUsageFooterView(usage, error);
  if (view === null) return null;
  if (view.kind === 'error') return view.text;
  return view.parts.map((part) => part.text).join(' ');
}
