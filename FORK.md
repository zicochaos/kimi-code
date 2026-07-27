# zicochaos/kimi-code fork notes

This file tracks **what diverges from upstream** (`MoonshotAI/kimi-code`) so rebases do not drop local product behavior. Update it whenever a fork-only feature is added, restored, or abandoned.

**Upstream base we track:** `@moonshot-ai/kimi-code@0.29.2` / `main@origin` `77618e38c35a81e26134b3f83eb7f2b460c0ee05`  
**Local main tip:** see `jj log -r main`  
**Backup before this safe port:** bookmark `backup/pre-0.29.2-port` at `b01dc627cad94603a0246339ec527504690f7968`

## How to rebase without losing options

1. `jj git fetch --all-remotes`
2. Backup: `jj bookmark create backup/pre-<ver> -r main`
3. **Do not** rebase the whole local history onto origin (merge-PR baggage).
4. Start from `main@origin` and duplicate only the feature commits listed below.
5. Resolve docs conflicts carefully, especially mirrored EN/ZH pages.
6. Update this file if the set of options changes.
7. Push the fork only after explicit approval: `jj git push --remote fork -b main`.

Useful checks after a port:

```sh
rg -n "disabled_skills|persist_default_model|agents_md_expand_includes|formatTerminalTitle|subagent-model-selection|managedUsage" \
  packages apps docs --glob '!**/node_modules/**'
```

## Fork-only / carried features

### Config

| Option | Default | Purpose | Key code |
| --- | --- | --- | --- |
| `disabled_skills` | `[]` | Hide skill names from listing, the `Skill` tool, and slash menus; files stay on disk for shared `~/.agents/skills`. Listing waits for async source reloads (`awaitPendingReloads`) | agent-core and agent-core-v2 skill catalogs; kap-server workspace list and activation error mapping |
| `persist_default_model` | `true` | When `false`, model changes stay session-only and do not rewrite managed `config.toml` model settings | `packages/agent-core/src/config/persist-default-model.ts`, `packages/agent-core-v2/src/app/kosongConfig/configSection.ts`, `packages/agent-core-v2/src/app/kosongConfig/kosongConfigService.ts` |
| `agents_md_expand_includes` | `false` | When `true`, standalone `@path` lines in `AGENTS.md` are expanded at system-prompt assembly time (depth ≤ 5; missing/cycle/empty → HTML comments) | agent-core and agent-core-v2 profile context loaders; v2 `agentsMdExpandIncludes` config section |

### Experimental

| Flag | Default | Purpose |
| --- | --- | --- |
| `subagent-model-selection` | `false` | Optional exact configured/materializable model aliases on `Agent` and `AgentSwarm`, composed with upstream `primary`/`secondary` when secondary-model is enabled. Env: `KIMI_CODE_EXPERIMENTAL_SUBAGENT_MODEL_SELECTION` |

### Upstream foundation (already on main@origin)

| Feature | Notes |
| --- | --- |
| `#2064` secondary model | Configurable `[secondary_model]`, `primary`/`secondary` tool choices, secondary overlay, startup warning. Keep intact; fork exact-alias selection sits on top. |

### TUI / protocol

| Feature | Purpose |
| --- | --- |
| Stable terminal title | `formatTerminalTitle(workDir)` renders `[host] - ~/path` instead of changing with the session title |
| Subagent model on headers | `subagent.spawned.model` supplies the effective model to Agent cards and AgentSwarm rows |
| v1 spawn event parity | The default v1 engine includes the effective model in `subagent.spawned` |
| Persistent managed quota | The TUI footer shows rolling plan windows and refreshes them after model/session/provider changes; stale responses are ignored |

**Managed quota note:** quota is shown only when the active model provider is `managed:kimi-code`. Custom providers never display these account limits. `/usage` and `/status` refresh the TUI footer values. There is no `/usages` command.

### Web / server

| Feature | Purpose |
| --- | --- |
| Managed quota sidebar card | Uses upstream `GET /api/v1/oauth/usage?provider=managed:kimi-code`; maps its snake_case wire response and ignores stale responses after model/provider changes |
| Workspace skills honor `disabled_skills` | Session-less listing matches the session skill catalog |
| Activate disabled skill → `40912` | Disabled activation is a user-facing skill error rather than internal `50001` |

There is intentionally no fork-only `/api/v1/usages` route. The quota UI must continue to use the upstream OAuth usage endpoint.

## Upstream contributions from this fork

| Item | URL | Status |
| --- | --- | --- |
| Issue: `disabled_skills` | https://github.com/MoonshotAI/kimi-code/issues/1982 | tracked upstream |
| PR: `disabled_skills` | https://github.com/MoonshotAI/kimi-code/pull/1983 | tracked upstream (head `95b77e4c`); local port includes kap-server behavior |
| `subagent-model-selection` | https://github.com/MoonshotAI/kimi-code/pull/1841 | carried locally on top of upstream secondary-model |
| Plan quota footer/sidebar | https://github.com/MoonshotAI/kimi-code/pull/1827 | UI behavior carried locally; backend uses current upstream OAuth route |
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

- Upstream `secondary-model` remains the foundation for `primary`/`secondary` and `[secondary_model]`.
- Fork `subagent-model-selection` adds exact aliases under a separate experimental flag (default off).
- Permission matching uses the semantic profile name; display labels may include the model for clarity.
- Resume model semantics differ by engine: v1 realigns the child to the parent model alias (tool-call `model` is ignored); v2 keeps the journal-bound model and does not rebind from parent tool args.
- Known limitations left open: legacy model directory still reserves the tokens `primary` / `secondary` (M-3), and the subagent model directory does not live-reload after config changes without a new session or equivalent restart (M-4).

### A port dropped a feature

If something disappears after syncing origin, compare against `backup/pre-*` and this file's tables, then duplicate the missing logical change onto `main@origin` or the current linear tip. Do not rebase the old merge-heavy history.

## Bookmarks worth keeping

| Bookmark | Meaning |
| --- | --- |
| `main` | Shipping fork tip |
| `main@origin` | Upstream tip (`77618e38…`, post-0.29.2) |
| `backup/pre-0.29.2-port` | Pre-port local tip at `b01dc627cad94603a0246339ec527504690f7968` |
| `backup/pre-0.29.1` | Older pre-0.29.1 local tip at `117f60d4816926a68e7d584f5d6f04e9dcd66411` |
| `feat/disabled-skills` | Branch for upstream PR #1983; keep untouched during fork ports |
