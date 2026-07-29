# tree-sitter-bash Agent Guide

Package-local rules for `packages/tree-sitter-bash` (`@moonshot-ai/tree-sitter-bash`).

## What it is

A pure-TypeScript bash parser (no runtime deps, no wasm) that produces a syntax tree with tree-sitter-bash 0.25.0 named-node type names and UTF-16 code-unit offsets.

## Parse contract

`parse(source, { timeoutMs, maxNodes })` runs under a deterministic budget (default 50 ms / 50k nodes, plus per-chain recursion depth caps) and returns a discriminated `ParseResult` (`{ ok, rootNode, hasError }` or `{ ok: false, reason: 'aborted' }`) — callers must treat aborted/hasError trees as "cannot analyze" and degrade.

## Scope

Parser only, no safety judgments; consumers (e.g. Bash tool permission matching) live elsewhere. Known deviations from the reference are tracked in the package README's "Known differences" section, pinned by differential fixtures tested against the real `tree-sitter-bash` wasm (dev-only).
