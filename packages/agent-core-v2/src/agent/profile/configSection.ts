/**
 * `profile` domain (L4) — top-level `agentsMdExpandIncludes` config section.
 *
 * Optional preference (`agents_md_expand_includes` on disk, v1-compatible): when
 * `true`, standalone `@path` lines inside AGENTS.md are inlined at system-prompt
 * assembly time. Default / absent is `false` so managed instruction files stay
 * literal. Consumed by `AgentProfileService` when building system-prompt context.
 */

import { z } from 'zod';

import { registerConfigSection } from '#/app/config/configSectionContributions';

export const AGENTS_MD_EXPAND_INCLUDES_SECTION = 'agentsMdExpandIncludes';

export const AgentsMdExpandIncludesSchema = z.boolean().optional();

export type AgentsMdExpandIncludes = z.infer<typeof AgentsMdExpandIncludesSchema>;

registerConfigSection(AGENTS_MD_EXPAND_INCLUDES_SECTION, AgentsMdExpandIncludesSchema, {
  defaultValue: false,
});
