# kap-server Agent Guide

Package-local rules for `packages/kap-server` (`@moonshot-ai/kap-server`).

## What it is

The Kimi Code server, backed by the DI × Scope agent engine (`@moonshot-ai/agent-core-v2`). It exposes sessions over REST + WebSocket (`/api/v1` + `/api/v1/ws`), is bootstrapped from `src/start.ts`, and is consumed by `apps/kimi-code`.

## Debug RPC surface

The RPC surface is `/api/v1/debug/*` — a reflection dispatcher over the ENTIRE scoped DI registry (every Service callable, no whitelist; `src/transport/registerDebugRoutes.ts` + `serviceDispatcherRoutes.ts`), mounted only with `--debug-endpoints` on a loopback bind and gated by the global bearer auth; repo dev scripts pass the flag.

## Transcript surface: op-batch sequencing

Its transcript surface implements the op-batch sequencing contract (owned by `@moonshot-ai/transcript`):

- `TranscriptService.dispatchOps` assigns every dispatched batch a per-agent consecutive `seq` and retains it in a bounded in-memory journal (`TRANSCRIPT_OPS_JOURNAL_CAPACITY`, dies with the live store).
- WS `transcript.ops`/`transcript.reset` payloads carry the seq/watermark.
- A `transcript_since` subscription cursor (carried, with the per-agent grades, by the `subscribe_v2` control frame — the only transcript subscription channel; its agent-grained counterpart `unsubscribe_v2` detaches listed agents' streams, or the whole session's when `agent_ids` is absent, letting the detached agents' legacy events flow again) replays journaled batches instead of a baseline reset when the journal covers it.
- `GET /sessions/{id}/transcript/ops?since_seq=` serves point-to-point catch-up (`complete: false` = journal can't cover or session cold → caller falls back to a full refresh).
- Beside the paged route, `GET /sessions/{id}/transcript/plan?agent_id=[&tool_call_id=]` projects an agent's ExitPlanMode plan info (content / path / options / review outcome; `tool_call_id` narrows to one call, omitted lists every recoverable plan) from the first available fact — the linked approval interaction's persisted request display, the live tool frame's display, or the tool result output text.
- The baseline `transcript.reset` itself is items-empty (`TRANSCRIPT_RESET_TAIL_TURNS = 0`): it carries only global state + the watermark + `has_more_older`, because history always pages in over REST.

## Transcript suppression

When a WS connection subscribes to the transcript protocol (grade ≠ `off` for an agent), the broadcaster suppresses the transcript-projected `session_event` types for that connection × agent (`TRANSCRIPT_PROJECTED_EVENT_TYPES` + `suppressedByTranscript` in `sessionEventBroadcaster.ts`; cursor replay via `getBufferedSince` applies the same filter). Suppression is only a per-connection send view — the journal still records everything, and connections without transcript grades are unaffected.

## Session work aggregate

The session's work aggregate behind `event.session.work_changed` (`busy` / `main_turn_active` / `pending_interaction` / `last_turn_reason`) is owned by the core's `ISessionActivityView` (`sessionActivity` domain, Session scope): the broadcaster only schedules the wire emission around turn frames (`busy:false` lands after `turn.ended`), and `resolveSessionFacts` (`src/routes/sessions.ts`) reads the same view — never fold per-agent activity at the edge.

## WS delivery split

Delivery split on `/api/v1/ws`:

- Global events (`session.meta.updated` and the `event.session.*` / `event.workspace.*` / `event.config.*` families, including every activated session's `event.session.work_changed`) fan out to EVERY established connection — `WsConnectionV1` registers itself via `broadcaster.addGlobalTarget` on construction and unregisters on close.
- Session/agent-grained events only reach connections subscribed to that session (subject to `agent_filter` and the transcript suppression above).
- Transcript frames are a separate channel governed by the per-agent grades alone and bypass `agent_filter` entirely.

## Global search surface

The global search surface is `POST /api/v1/search` (`src/search/` + `src/routes/search.ts`): a cross-session full-text search over user messages, assistant text, and session titles, backed by a single minidb database at `<home>/search-index` (`IGlobalSearchService`, App scope — the write-lock holder is the indexer, other processes open read-only and catch up via WAL).

- It serves two modes: `terms` (the default — minidb's inverted text index over ASCII words + CJK uni/bigrams, no positions, term-level AND) and `literal` (substring-exact search: a hashed 2/3-gram index supplies candidates, every candidate's text is then confirmed with `includes`, so hits carry zero false positives; literal ignores `sort` and returns newest-first, and a candidate set truncated at `LITERAL_CANDIDATE_CAP` is flagged `incomplete: 'candidate_cap'`).
- When `container.session_id` is provided and that session is live in this process (`TranscriptService.forSessionLive` returns a store, wired via `setLiveTranscriptSource` in `start.ts`), BOTH modes instead scan the in-memory transcript store (turn prompts + assistant text frames, history established via `whenReady`/`ensureAgentHistory`) — no index involved; terms-mode live hits are scored Σ log(1+tf) (comparable only within a route, per the `GlobalSearchSource` contract), live-route errors never fall back to the index, and the response's `source: 'live' | 'index'` field (also mixed into the page-token fingerprint, so a mid-pagination route flip invalidates the old token) tells the caller which route served the page.
