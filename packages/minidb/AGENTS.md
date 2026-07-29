# minidb Agent Guide

Package-local rules for `packages/minidb` (`@moonshot-ai/minidb`).

## What it is

The embedded JSON document store (`MiniDb`) behind kap-server's search index — snapshot + WAL persistence with an exclusive write lock (losers open read-only and catch up from the WAL), plus a larger-than-RAM full-text layer.

## Full-text layer

- `src/text-index.ts` is the inverted index (in-RAM dictionary + delta, on-disk postings in `src/text-postings.ts`, rebuilt from the Store on open and on compaction) with an injectable `tokenizer`/`queryTokenizer`.
- The default tokenizer keeps ASCII words and CJK uni/bigrams.
- `src/trigram.ts` provides the hashed 2/3-gram tokenizer (NFKC + lowercase, code-point windows) that backs substring-exact search.
- Text-index definitions (including the tokenizer name) persist in `db.textindexes.json`.
