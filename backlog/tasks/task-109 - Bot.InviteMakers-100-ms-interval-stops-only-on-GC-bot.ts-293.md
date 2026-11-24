---
id: TASK-109
title: Bot.InviteMaker's 100 ms interval stops only on GC (bot.ts:293)
status: Done
assignee: []
created_date: '2026-11-24T03:48:00Z'
updated_date: '2026-11-24T13:07:00Z'
labels:
  - correctness
dependencies: []
priority: low
ordinal: 40920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The setInterval in Bot.InviteMaker (src/webpage/bot.ts:293-296) clears itself only when gen.container.deref() is undefined, so its lifetime rides on garbage collection. Since PR #197, an Options that is not rendered targets a strongly held placeholder (settings.ts 'detached'), so a gen created under a parent whose page is gone would keep the interval alive forever (closure -> gen -> detached). Unreachable today: InviteMaker runs only from a click on a rendered form (localuser.ts:5609). Fix shape: stop when the container is gone OR, once shown, no longer isConnected; red-first with a fake-timer test. From the PR #197 review (low).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #201 (merged 2026-11-24, head e197c6f2). Gemini BLOCK (pre-first-tick leak) fixed red-first; claude-review PASS; its 3 lows filed as one follow-up.
<!-- SECTION:NOTES:END -->
