---
"@moonshot-ai/kimi-code": patch
---

web: Add font family preferences to Appearance settings (desktop dialog + mobile sheet). The UI/reading font offers Default (Inter), System, Serif, and Custom faces; the code font offers Default (JetBrains Mono), System, and Custom. Custom accepts any locally installed font name (e.g. Maple Mono NF CN) with the default stack appended as fallback, so nothing extra is downloaded. Choices remap the `--font-ui` / `--font-mono` tokens via `<html data-ui-font-family>` / `<html data-code-font-family>`, so every surface picks them up with no component changes; the xterm terminal keeps its fixed literal stack.
