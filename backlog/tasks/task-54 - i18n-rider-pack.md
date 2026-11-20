---
id: TASK-54
title: i18n rider pack
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - i18n
  - deferred
dependencies: []
ordinal: 750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
(a) PLURAL gate: pluralClass selects by Intl category only while the app language is cs; a new 3-form block in another few-rule locale (pl/ru/lt/mk) MUST NOT silently switch mapping — extend the gate per language deliberately.
(b) The lfn picker stays held (constructed language, machine output would be wrong in uncatchable ways) — revisit only on the owner's word, precondition a human-quality ~899-string translation.
(c) Locale he is missing (falls back to en) — owner to open some day.
(d) Other locales mix guild/server and say "server" for the backend — translator note owed (see the copy decision).
(e) reporting/report.ts ~174 throws "Guild expected" (dev-facing).
(f) Hardcoded English outside messages: login.ts:147 "Advanced"; settings.ts:232 "Give feedback about this design"; interactions/commands.ts:885; oauth2/auth.ts 49/67/83/128; localuser.ts:2892 "Loading...".
(g) toLocaleDateString("tok") gives ICU garbage when the browser has no tok entry — consider an en fallback for tok.
(h) Untested render edges: unknown-channel mention in keep mode, NaN <t:R>, future month edge, keep-mode <t:R> real attr.
<!-- SECTION:DESCRIPTION:END -->
