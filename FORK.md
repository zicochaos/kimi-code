# zicochaos/kimi-code fork notes

This file tracks **what diverges from upstream** (`MoonshotAI/kimi-code`) so rebases do not drop local product behavior. Update it whenever a fork-only feature is added, restored, or abandoned.

**Upstream base we track:** `@moonshot-ai/kimi-code@0.34.0` / `main@origin` (release 2026-08-06; remote `origin` = `MoonshotAI/kimi-code`, `fork` = this fork)
**Local main tip:** see `git log main` (0.34.0 port lives on merge branch `merge/upstream-0.34.0` until integrated)

## How to merge a new upstream without losing options

1. `git fetch origin --tags`
2. Backup: `git tag backup/pre-<ver>-port main`
3. Create a merge branch (`git switch -c merge/upstream-<ver> main`) and merge the upstream tag; do not rebase the merge-heavy fork history.
4. Prefer upstream implementations where they provide the same or better behavior, then restore only the missing contracts listed below.
5. Resolve docs conflicts carefully, especially mirrored EN/ZH pages, and update this file's upstream base.
6. Update this file if the set of options changes.
7. Push the fork only after explicit approval.

Useful checks after a port:

```sh
rg -n "disabled_skills|persist_default_model|agents_md_expand_includes|formatTerminalTitle|subagent-model-selection|managedUsage" \
  packages apps docs --glob '!**/node_modules/**'
```

## Fork-only / carried features

### Config

| Option | Default | Purpose | Key code |
| --- | --- | --- | --- |
| `disabled_skills` | `[]` | Hide skill names from listing, the `Skill` tool, and slash menus; files stay on disk for shared `~/.agents/skills`. Listing waits for async source reloads (`awaitPendingReloads`) | **v2 only since the 0.33.0 port:** agent-core-v2 Workspace catalog and Session overlay; kap-server workspace list and activation error mapping |
| `persist_default_model` | `true` | When `false`, model changes stay process-local and do not rewrite managed `config.toml` model settings | **v2 only since the 0.33.0 port:** `packages/agent-core-v2/src/app/kosongConfig/configSection.ts`, `packages/agent-core-v2/src/app/kosongConfig/kosongConfigService.ts` |
| `agents_md_expand_includes` | `false` | When `true`, standalone `@path` lines in `AGENTS.md` are expanded at system-prompt assembly time (depth ≤ 5; missing/cycle/empty → HTML comments) | **v2 only since the 0.33.0 port:** agent-core-v2 profile context loader + `agentsMdExpandIncludes` config section |

### Engine posture (0.33.0 / 0.34.0)

Upstream `0.33.0` (`#2627`) makes **agent-core-v2 the default engine** for every CLI surface; v1 (`packages/agent-core`) is legacy behind `KIMI_CODE_LEGACY_FLAG=1` and receives maintenance fixes only. The 0.33.0 port therefore **dropped all v1-side fork features** (v1 `disabled_skills`, v1 `persist_default_model`, v1 include expansion, retired v1 exact-alias selection). The single v1-side keep is the wire-protocol 1.5 migration (`packages/agent-core/src/agent/records/migration/v1.5.ts`) so the legacy engine can still resume sessions written by v2 — upstream v1 remains at 1.4.

Upstream `0.33.0` (`#2599`) also **deleted `apps/kimi-web`** (web UI source moved to the code-app repo; this repo ships a prebuilt `apps/kimi-code/dist-web`). The fork dropped the app and all its fork-only web UI features (managed quota sidebar card, web-side `disabled_skills` listing); the kap-server contracts below remain.

Upstream `0.34.0` highlights absorbed by this port: cache-expiry hint dialog, Windows Computer Use, `/api/v2/sessions` (v1 envelope), full-text search index isolation (minidb), L3 unit layer + Feature seam (plan mode moved to `src/features/plan/**`), MCP tombstoning, UTF-16 file reading, and upstream's own subagent bound-model + thinking-effort surfacing (`#2679`) — which **subsumes the fork's subagent-model display plumbing** (the port adopts upstream's `model`/`thinkingEffort` fields and `subagentDisplayModel` normalization; the fork keeps only its exact-alias selection feature and the `model` field on `subagent.spawned`).

### Experimental

| Flag | Default | Purpose |
| --- | --- | --- |
| `subagent-model-selection` | `false` | **v2 engine only.** Optional exact configured/materializable model aliases on `Agent` and `AgentSwarm`, composed with upstream `primary`/`secondary` when secondary-model is enabled. Env: `KIMI_CODE_EXPERIMENTAL_SUBAGENT_MODEL_SELECTION`. The v1-side implementation was retired: upstream `#2232` shipped secondary-model binding + custom agent files on v1 (TUI included), so the default v1 engine now offers upstream's `primary`/`secondary` choices only |

### Upstream foundation (already on main@origin)

| Feature | Notes |
| --- | --- |
| `#2064` secondary model | Configurable `[secondary_model]`, `primary`/`secondary` tool choices, secondary overlay, startup warning. Keep intact; fork exact-alias selection (v2-only) sits on top. |
| `#2232` v1 secondary model + agent files | Custom agent files (user/project/extra/explicit dirs), `--agent`/`--agent-file` in TUI and `kimi -p`, `[secondary_model]` + `KIMI_SECONDARY_MODEL` binding for spawned subagents behind `KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL`, `/secondary_model` TUI command, `disallowedTools` deny semantics. Supersedes the fork's retired v1 exact-alias selection. |

### TUI / protocol

| Feature | Purpose |
| --- | --- |
| Stable terminal title | `formatTerminalTitle(workDir)` renders `[host] - ~/path` instead of changing with the session title |
| Subagent model on cards | The bound model reaches Agent cards and AgentSwarm panels via the child's `agent.status.updated` — since 0.33.0 upstream itself carries `model` on that event, and the roster tracker / TUI learn it from status updates |
| Persistent managed quota | The TUI footer shows rolling plan windows and refreshes them after model/session/provider changes; stale responses are ignored |

**Managed quota note:** quota is shown only when the active model provider is `managed:kimi-code`. Custom providers never display these account limits. `/usage` and `/status` refresh the TUI footer values. There is no `/usages` command.

### Web / server

| Feature | Purpose |
| --- | --- |
| Workspace skills honor `disabled_skills` | Session-less listing matches the session skill catalog (kap-server resolves the Workspace-scope skill catalog, not an ad-hoc composition) |
| Activate disabled skill → `40912` | Disabled activation is a user-facing skill error rather than internal `50001` |

There is intentionally no fork-only `/api/v1/usages` route, and since the 0.33.0 port no fork web UI: upstream removed `apps/kimi-web`, so the managed quota sidebar card was dropped with it. If web quota UI is wanted again, it belongs in the code-app repo that now owns the web source.

## Upstream contributions from this fork

| Item | URL | Status |
| --- | --- | --- |
| Issue: `disabled_skills` | https://github.com/MoonshotAI/kimi-code/issues/1982 | tracked upstream |
| PR: `disabled_skills` | https://github.com/MoonshotAI/kimi-code/pull/1983 | open upstream (head `af63f9a3`); local port includes kap-server behavior |
| `subagent-model-selection` | https://github.com/MoonshotAI/kimi-code/pull/1841 | **closed upstream, not merged**; carried locally on top of upstream secondary-model |
| Plan quota footer | https://github.com/MoonshotAI/kimi-code/pull/1827 | **closed upstream, not merged**; TUI footer behavior carried locally on the upstream OAuth usage route; web sidebar dropped with `apps/kimi-web` in the 0.33.0 port |
| `agents_md_expand_includes` | — | fork-only; security/design review needed before upstreaming |
| `persist_default_model` | — | upstream candidate; not submitted |
| Stable terminal title | — | weak upstream fit because it intentionally avoids session-title churn |

## Known operational gotchas

### `kimi -c` → `Unexpected end of JSON input` / `Session not found`

Usually a corrupt session under `~/.kimi-code/sessions/` has an empty `state.json` (0 bytes). Resume parses it and fails.

**Important:** do not rename the session directory inside the same workdir bucket, for example by appending `.corrupt-…`. Listing still sees it and treats the full folder name as a session id, which produces `Session not found`.

```sh
# Find empty state.json files under workdir buckets.
find ~/.kimi-code/sessions -name state.json -size 0

# Move the whole session directory OUT of the bucket, not merely rename it.
mkdir -p ~/.kimi-code/trash
# Example:
# mv ~/.kimi-code/sessions/wd_<slug>/session_<id> ~/.kimi-code/trash/

# If needed, remove the matching sessionId line from:
# ~/.kimi-code/session_index.jsonl
```

Then `kimi -c` can continue the previous healthy session for that workdir.

### Secondary model vs exact-alias selection

- Upstream `secondary-model` (now including `#2232`'s v1 port) is the foundation for `primary`/`secondary` and `[secondary_model]` on both engines.
- Fork `subagent-model-selection` adds exact aliases under a separate experimental flag (default off) — **v2 engine only**; the v1 implementation was dropped in favor of upstream's.
- Permission matching uses the semantic profile name; display labels may include the model for clarity.
- Resume model semantics differ by engine: v1 realigns the child to the parent model alias (tool-call `model` is ignored); v2 keeps the journal-bound model and does not rebind from parent tool args.
- Known limitations left open: legacy model directory still reserves the tokens `primary` / `secondary` (M-3), and the subagent model directory does not live-reload after config changes without a new session or equivalent restart (M-4).

### A port dropped a feature

If something disappears after syncing upstream, compare against `backup/pre-*` and this file's tables, then duplicate the missing logical change onto the current merge branch. Do not rebase the old merge-heavy history.

## Branches worth keeping

| Branch | Meaning |
| --- | --- |
| `main` | Shipping fork tip |
| `merge/upstream-0.34.0` | 0.34.0 port (merge of `main@origin` at `@moonshot-ai/kimi-code@0.34.0`); integrate into `main` after verification |
| `merge/upstream-0.33.0` | 0.33.0 port (integrated) |
| `backup/pre-0.34.0-port` (tag) | Pre-port local tip at `a1054918b` (last state on upstream 0.33.0) |
| `backup/pre-jj-migration` (tag) | Same tip — snapshot from the jj→git migration on 2026-08-07. The `.jj` store was archived out of the repo; this repo is now plain git |
| `backup/pre-0.33.0-port` | Pre-port local tip at `174cce520ceaeb2112b3e671872db356f6732235` (last state on upstream 0.31.1) |
| `backup/pre-0.29.2-port` | Pre-port local tip at `b01dc627cad94603a0246339ec527504690f7968` |
| `backup/pre-0.29.1` | Older pre-0.29.1 local tip at `117f60d4816926a68e7d584f5d6f04e9dcd66411` |
| `feat/disabled-skills` | Branch for upstream PR #1983; keep untouched during fork ports |

## jj → git migration (2026-08-07)

This repo used to be a jj (Jujutsu) working copy on top of the git store. jj is retired: the `.jj` directory was archived to `.tmp/jj-repo-archive-20260807.tar.gz` (gitignored) and removed. All history, branches, bookmarks and backup tags live in plain git now; the five jj workspaces (`default`, `disabled-skills`, `fork-0.29.1`, `fork-disabled-fixes`, `upstream-0.31.1`) were stale metadata with no checkouts on disk. If ancient jj state is ever needed, restore the archive back to `.jj/`.
