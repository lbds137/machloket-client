---
id: TASK-65
title: Landing-era LOW pack (the long tail)
status: To Do
assignee: []
created_date: '2026-11-19T22:21:00Z'
labels:
  - deferred
dependencies: []
ordinal: 880
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pre-existing riders from the #89-#135 era, all with recorded triggers:
- Unchecked-GET sites: connections authorize ~3798, registration tokens ~4566, manageApplication ~4673, manageBot ~4756, genOnboard welcome-screen; welcome double-submit + genOnboard GET; createChannelpac stray PATCH (floor: gateway channel create sends no PATCH); drag-restore closes the search panel; drop-handler early return; untested drop handlers.
- Re-tap of a channel pushes a duplicate history entry.
- fileExtange thumbnail-advance can double-list attachments after a channel round-trip (build the mock e2e red first).
- Slowmode 20016 refused GIF/sticker/poll leaves a retry loop until the window ends.
- getHTML throw window can misattach files; restore-no-thumbnail throw path.
- #89 small-PR trio status unverified (sendMessage document.contains removal, servericon pick by name, refusal-after-switch pin).
- templatePage restore-exactness optional low; PR #155 eslint-disable fixup low.
- getmessage takes json[0] of around=id without checking json[0].id === id (a deleted target caches a neighbour as the target — probe first); focus() callers fire-and-forget (message.ts 1113/1446/1489, markdown.ts 1302, channel.ts 3700).
- composerRestore.test attachment-strip assert missing (lines ~145-163); reconnect-files lows (gottenReady keepsWaitingFiles unpinned; an attachment landing while the reconnect overlay is up is probably unreachable — trigger: a lost-attachment report).
- Sidebar lows: createguildHTML re-adds dragstart/dragend on the reused div every rebuild (~channel.ts:1291, idempotent today); redrawChannelList resets #channels scrollTop.
- Backup-codes spec riders: toBeVisible passes during removeAni's 500ms; "shows them once" title unpinned; regen password-as-key awaits the server's key contract (server-bounded).
- Intent toggles: every save PATCHes stale flags even with no toggle changed (cross-tab revoke); boxes not setState'd after save; guard admits non-integers; a Save tap while the same URL's PATCH is in flight silently drops the second edit (Options.changed/Form.submit trigger).
- Archived threads: the slash popup goes stale when archived flips while open; app-boot marker vacuous on a >=100-message fixture (also wait for the boot loading div); fixtures JSDoc + bare /navigation/i + includes matching ack POSTs.
- READY/GUILD_CREATE carry stage_instances (ignored); READY doesn't consult joinedGuildId (join mid-reconnect never auto-opens); markAsRead ack-bulk skips channels not in this.channels (threads); Form required:true recorded-only; Friends "Online" tab no re-render on presence; presences not cleared with userMap on READY.
- Form's first try omits a cached token (one extra request, no user effect); TOTP-enable password-vs-MFA order (ride the row-17 form).
- Form silent through the <=30s 429 wait (copy/spinner choice — owner-visible, walk trigger); engine-specific e.message surfaces ("Failed to fetch") — shared polish class with the Form unreadable-body path.
- Recovery-banner bar height with the keyboard open — owner look, ride the walk.
- Wave-2 test riders: no guild-channel POST wire-shape fixture (only the two DM fixtures); no second-HELLO interval-stacking test in gatewayWatchdog.test.ts.
<!-- SECTION:DESCRIPTION:END -->
