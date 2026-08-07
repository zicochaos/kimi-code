import type {
  BackgroundAgentMetadata,
  BackgroundAgentStatusData,
  BackgroundAgentStatusPhase,
} from '#/tui/types';

const MAX_BACKGROUND_FIELD_LENGTH = 240;

function normalizeBackgroundField(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const collapsed = value.trim().replaceAll(/\s+/g, ' ');
  if (collapsed.length === 0) return undefined;
  if (collapsed.length <= MAX_BACKGROUND_FIELD_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_BACKGROUND_FIELD_LENGTH - 3)}...`;
}

export function formatBackgroundAgentTranscript(
  phase: BackgroundAgentStatusPhase,
  meta: BackgroundAgentMetadata,
  extras: { resultSummary?: string; error?: string } | undefined = undefined,
): BackgroundAgentStatusData {
  const normalizedAgentName = normalizeBackgroundField(meta.agentName);
  const subject = normalizedAgentName !== undefined ? `${normalizedAgentName} agent` : 'agent';
  const model = normalizeBackgroundField(meta.model);
  const subjectWithModel = model === undefined ? subject : `${subject} (${model})`;
  const headline =
    phase === 'started'
      ? `${subjectWithModel} started in background`
      : phase === 'completed'
        ? `${subjectWithModel} completed in background`
        : `${subjectWithModel} failed in background`;
  const tail = phase === 'failed' ? normalizeBackgroundField(extras?.error) : undefined;
  const detailParts = [
    normalizeBackgroundField(meta.model),
    normalizeBackgroundField(meta.effort),
    normalizeBackgroundField(meta.description),
    tail,
  ].filter((part): part is string => part !== undefined);

  return {
    phase,
    headline,
    detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
  };
}
