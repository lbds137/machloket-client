---
id: TASK-166
title: >-
  PR #218 review lows: deriveHeaders typing of conditional/wide extra,
  json:false content type
status: To Do
assignee: []
created_date: '2026-11-25T23:47:00Z'
labels:
  - auth
  - types
dependencies: []
priority: low
ordinal: 97920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
claude-review on PR #218 (merged). (1) A conditional extra (member.ts:613/630, reason ? {...} : undefined) infers E with the key required, so the result types x-audit-log-reason as present though absent at runtime; options: Omit<T, keyof E> & Partial<E> (weakens the positive pin in accountHeaders.test.ts) or a call-site shape that keeps it optional. (2) A wide extra typed Record<string,string> makes keyof E = string, so the typo guard silently turns off and T's literal types are lost; at least note it in the doc comment. (3) Pre-existing: json:false still types the dropped Content-type key (optional, harmless).
<!-- SECTION:DESCRIPTION:END -->
