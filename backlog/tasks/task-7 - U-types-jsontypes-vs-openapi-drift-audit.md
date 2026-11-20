---
id: TASK-7
title: 'U-types: jsontypes vs openapi drift audit'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels: []
dependencies: []
ordinal: 160
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
C11 (inherited, after the U-api migration completes): `src/webpage/jsontypes.ts` optimism vs the fork's openapi artifact (the canonical contract) — userjson requires accent_color/bio/badge_ids/premium_since (`src/webpage/user.ts:1045` reloads badges on every USER_UPDATE from stock); invitejson types; highMemberJSON vs UserProfileResponse; custom_status string vs object; channeljson nullables. Audit types against the artifact and fix consumers of changed shapes red-first.
<!-- SECTION:DESCRIPTION:END -->
