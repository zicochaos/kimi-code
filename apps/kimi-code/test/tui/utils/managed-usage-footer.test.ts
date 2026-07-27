import { describe, expect, it } from 'vitest';

import type { ManagedUsageReport } from '#/tui/components/messages/usage-panel';
import {
  buildManagedUsageFooterView,
  formatManagedUsageFooterPlain,
} from '#/tui/utils/managed-usage-footer';

const sampleUsage: ManagedUsageReport = {
  summary: { label: '1w limit', used: 12, limit: 100 },
  limits: [{ label: '5h limit', used: 40, limit: 100 }],
  extraUsage: null,
};

describe('buildManagedUsageFooterView', () => {
  it('returns null when usage is unset and there is no error', () => {
    expect(buildManagedUsageFooterView(undefined, null)).toBeNull();
    expect(buildManagedUsageFooterView(null, undefined)).toBeNull();
    expect(buildManagedUsageFooterView(undefined, undefined)).toBeNull();
  });

  it('surfaces an error over any cached usage', () => {
    expect(buildManagedUsageFooterView(sampleUsage, 'not signed in')).toEqual({
      kind: 'error',
      text: 'quota: not signed in',
    });
  });

  it('returns null for an empty report (no summary, no limits)', () => {
    expect(
      buildManagedUsageFooterView({ summary: null, limits: [], extraUsage: null }, null),
    ).toBeNull();
  });

  it('builds severity-coloured parts for summary then each window limit', () => {
    const view = buildManagedUsageFooterView(sampleUsage, null);
    expect(view).toEqual({
      kind: 'ok',
      parts: [
        { text: '1w: 12%', severity: 'ok' },
        { text: '5h: 40%', severity: 'ok' },
      ],
    });
  });

  it('strips a trailing "limit" from labels and maps severity by ratio', () => {
    const usage: ManagedUsageReport = {
      summary: { label: 'Weekly limit', used: 60, limit: 100 },
      limits: [
        { label: '5H LIMIT', used: 90, limit: 100 },
        { label: 'daily', used: 0, limit: 50 },
      ],
    };
    const view = buildManagedUsageFooterView(usage, null);
    expect(view).toEqual({
      kind: 'ok',
      parts: [
        { text: 'Weekly: 60%', severity: 'warn' },
        { text: '5H: 90%', severity: 'danger' },
        { text: 'daily: 0%', severity: 'ok' },
      ],
    });
  });

  it('treats a zero limit as 0% with ok severity', () => {
    const view = buildManagedUsageFooterView(
      {
        summary: null,
        limits: [{ label: '5h limit', used: 10, limit: 0 }],
      },
      null,
    );
    expect(view).toEqual({
      kind: 'ok',
      parts: [{ text: '5h: 0%', severity: 'ok' }],
    });
  });
});

describe('formatManagedUsageFooterPlain', () => {
  it('joins parts into a compact left-slot readout', () => {
    expect(formatManagedUsageFooterPlain(sampleUsage, null)).toBe('1w: 12% 5h: 40%');
  });

  it('returns the error text for a failed fetch', () => {
    expect(formatManagedUsageFooterPlain(null, 'timeout')).toBe('quota: timeout');
  });

  it('returns null when there is nothing to show', () => {
    expect(formatManagedUsageFooterPlain(undefined, null)).toBeNull();
  });
});
