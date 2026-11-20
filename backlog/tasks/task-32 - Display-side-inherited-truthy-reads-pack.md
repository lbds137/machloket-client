---
id: TASK-32
title: Display-side inherited/truthy reads pack
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - deferred
dependencies: []
ordinal: 530
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
(a) `src/webpage/channel.ts:761` {0:"text",...}[this.type] — hostile type "toString" resolves the inherited function -> wrong select default.
(b) perminfo.channels/guilds[this.id] (channel.ts:984, guild.ts:1986) and configs[this.id] (user.ts:1402): server-id indexing a locally-built map leaks an inherited member into display info.
(c) Truthy server booleans gating UI: !!con.visibility renders the string "false" as checked (localuser.ts:4313; the PATCH sends a real boolean); welcomeScreen?.enabled truthy-gates the dialog (guild.ts:695/1346); mfa_enabled unguarded from READY (localuser.ts:479).
(d) Embed icon_url/proxy_url passed to new URL (embed.ts:145-146/224/236): a truthy non-string rejects unhandled and the image silently never appears.
Trigger: next touch of each site.
<!-- SECTION:DESCRIPTION:END -->
