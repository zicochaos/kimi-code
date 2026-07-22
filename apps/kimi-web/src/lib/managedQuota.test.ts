import { describe, expect, it } from 'vitest';
import {
  isManagedUsageProvider,
  MANAGED_KIMI_CODE_PROVIDER,
  pctOf,
  providerForActiveModel,
  severityOf,
  shortLabel,
  shouldApplyUsageFetch,
  shouldClearQuota,
  usageRowsFromResult,
} from './managedQuota';

const models = [
  { id: 'managed:kimi-code/kimi-k2.5', provider: MANAGED_KIMI_CODE_PROVIDER, model: 'kimi-k2.5' },
  { id: 'openai/gpt-4o', provider: 'openai', model: 'gpt-4o' },
  { id: 'moonshot/kimi-k2.5', provider: 'moonshot', model: 'kimi-k2.5' },
] as const;

describe('managedQuota', () => {
  describe('isManagedUsageProvider', () => {
    it('accepts only managed:kimi-code', () => {
      expect(isManagedUsageProvider(MANAGED_KIMI_CODE_PROVIDER)).toBe(true);
      expect(isManagedUsageProvider('managed:other')).toBe(false);
      expect(isManagedUsageProvider('openai')).toBe(false);
      expect(isManagedUsageProvider(undefined)).toBe(false);
      expect(isManagedUsageProvider(null)).toBe(false);
      expect(isManagedUsageProvider('')).toBe(false);
    });
  });

  describe('providerForActiveModel', () => {
    it('resolves by exact model id', () => {
      expect(providerForActiveModel('openai/gpt-4o', models)).toBe('openai');
      expect(providerForActiveModel('managed:kimi-code/kimi-k2.5', models)).toBe(
        MANAGED_KIMI_CODE_PROVIDER,
      );
    });

    it('falls back to raw model name when id misses', () => {
      expect(providerForActiveModel('gpt-4o', models)).toBe('openai');
    });

    it('prefers id match over colliding model names', () => {
      // Both managed and moonshot expose model "kimi-k2.5"; id wins.
      expect(providerForActiveModel('moonshot/kimi-k2.5', models)).toBe('moonshot');
    });

    it('returns undefined for empty/unknown models', () => {
      expect(providerForActiveModel(undefined, models)).toBeUndefined();
      expect(providerForActiveModel('', models)).toBeUndefined();
      expect(providerForActiveModel('missing', models)).toBeUndefined();
      expect(providerForActiveModel('openai/gpt-4o', [])).toBeUndefined();
    });
  });

  describe('severityOf / pctOf / shortLabel', () => {
    it('classifies ratio thresholds', () => {
      expect(severityOf({ used: 0, limit: 100 })).toBe('ok');
      expect(severityOf({ used: 49, limit: 100 })).toBe('ok');
      expect(severityOf({ used: 50, limit: 100 })).toBe('warn');
      expect(severityOf({ used: 84, limit: 100 })).toBe('warn');
      expect(severityOf({ used: 85, limit: 100 })).toBe('danger');
      expect(severityOf({ used: 1, limit: 0 })).toBe('ok');
    });

    it('computes clamped percentage', () => {
      expect(pctOf({ used: 0, limit: 100 })).toBe(0);
      expect(pctOf({ used: 1, limit: 3 })).toBe(34); // ceil
      expect(pctOf({ used: 150, limit: 100 })).toBe(100);
      expect(pctOf({ used: 5, limit: 0 })).toBe(0);
    });

    it('strips trailing limit suffix', () => {
      expect(shortLabel('5h limit')).toBe('5h');
      expect(shortLabel('Weekly limit')).toBe('Weekly');
      expect(shortLabel('5h')).toBe('5h');
    });
  });

  describe('usageRowsFromResult', () => {
    it('orders summary before limits', () => {
      expect(
        usageRowsFromResult({
          kind: 'ok',
          summary: { label: 'Weekly limit', used: 10, limit: 100 },
          limits: [{ label: '5h limit', used: 1, limit: 20 }],
        }).map((r) => r.label),
      ).toEqual(['Weekly limit', '5h limit']);
    });

    it('skips a null summary', () => {
      expect(
        usageRowsFromResult({
          kind: 'ok',
          summary: null,
          limits: [{ label: '5h limit', used: 1, limit: 20 }],
        }),
      ).toHaveLength(1);
    });

    it('returns empty for null/undefined', () => {
      expect(usageRowsFromResult(null)).toEqual([]);
      expect(usageRowsFromResult(undefined)).toEqual([]);
    });
  });

  describe('stale / clear guards', () => {
    it('accepts only current generation + matching managed provider', () => {
      expect(
        shouldApplyUsageFetch({
          requestGen: 2,
          currentGen: 2,
          requestProvider: MANAGED_KIMI_CODE_PROVIDER,
          currentProvider: MANAGED_KIMI_CODE_PROVIDER,
        }),
      ).toBe(true);
    });

    it('drops stale generations and provider mismatches', () => {
      expect(
        shouldApplyUsageFetch({
          requestGen: 1,
          currentGen: 2,
          requestProvider: MANAGED_KIMI_CODE_PROVIDER,
          currentProvider: MANAGED_KIMI_CODE_PROVIDER,
        }),
      ).toBe(false);
      expect(
        shouldApplyUsageFetch({
          requestGen: 2,
          currentGen: 2,
          requestProvider: MANAGED_KIMI_CODE_PROVIDER,
          currentProvider: 'openai',
        }),
      ).toBe(false);
    });

    it('clears quota for non-managed providers', () => {
      expect(shouldClearQuota(MANAGED_KIMI_CODE_PROVIDER)).toBe(false);
      expect(shouldClearQuota('openai')).toBe(true);
      expect(shouldClearQuota(undefined)).toBe(true);
    });
  });
});
