---
id: TASK-76
title: 'Uncalled Fermo methods: Member.highInfo and Channel.addRoleToPerms'
status: Done
assignee: []
created_date: '2026-11-22T19:53:00Z'
updated_date: '2026-11-24T03:29:00Z'
labels:
  - cleanup
dependencies: []
priority: low
ordinal: 7920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in TASK-3 (U-api 2d). Neither has a production caller: grep of src for highInfo/addRoleToPerms/RoleToPerms (positive control: user.ts:1928 matches User.highInfo; Member extends SnowFlake, not User). guildAdmin.test.ts stubs addRoleToPerms only to assert it is NOT called. addRoleToPerms also ignores res.ok (a refused PUT still writes the local overwrite) and Member.highInfo .json()s a refusal body. TASK-3 swaps both to apiFetch mechanically. Disposition to decide: delete both (and the guildAdmin stub), or wire + fix if a Discord-parity caller is planned. Re-grep at unit time.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #196 (merged 2026-11-24 03:26Z). TASK-13 and TASK-33 no longer mention the deleted methods. Review lows: (1) the canMessage purity test watches only fetch, not XMLHttpRequest or the gateway socket. Ruled out: the old stub had the same blind spot, and XMLHttpRequest appears only in the message upload path (channel.ts:4766, 4817), which a getter has no route into. (2) hasPermission is stubbed, so the real permission path is not pinned side-effect-free. Filed as TASK-108.
<!-- SECTION:NOTES:END -->
