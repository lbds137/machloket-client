---
id: TASK-13
title: 'U-perm: overwrite type + res.ok in permission paths'
status: Done
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-24T14:48:00Z'
labels: []
dependencies: []
priority: high
ordinal: 30
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
C4 MED correctness (inherited): overwrite type guessed from userMap (`src/webpage/channel.ts:4991`-4999), channeljson drops type (`src/webpage/jsontypes.ts:631`-635). (addRoleToPerms, which ignored res.ok, was deleted in TASK-76, PR #196.) Fix: carry type from the server overwrite; check ok before local mutation. Red-first.

(Line anchors may drift — re-grep the named file at unit time.)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-24 plan (worktree mc-t13, red-first tests written in permissionSave.test.ts + syncPerms.test.ts): res.ok half already shipped (updateRolePermissions checks it, channel.ts ~5022). Remaining: Channel.overwriteTypes Map filled from json r.type at both parse sites (constructor ~957, updateChannel ~4030; jsontypes permission_overwrites gains type: 0|1|2 per the fork openapi ChannelPermissionOverwrite, type required); overwriteType(id) = stored ?? (guild.roleids.has(id) ? 0 : 1); used by updateRolePermissions (~5019, was userMap guess) and syncPermsToChildren (~2530, was roleids guess).

Shipped in PR #204 (merged 2026-11-24). Gemini BLOCK (e2e mock lacked type) fixed in-PR; claude-review PASS, its 2 lows filed as one follow-up.
<!-- SECTION:NOTES:END -->
