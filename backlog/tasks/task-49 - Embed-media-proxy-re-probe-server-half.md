---
id: TASK-49
title: Embed media proxy re-probe (server half)
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - probe-first
  - server-bounded
dependencies: []
priority: low
ordinal: 700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Client half shipped (prefer proxy_url when present + drop the double fetch). Server half: the machloket-server session accepted filling proxy_url/proxy_icon_url for user/webhook/bot embeds with outbound-fetch guards. Re-probe a live instance (POST a rich embed, read the proxy fields, delete) once it deploys, then disposition this.
<!-- SECTION:DESCRIPTION:END -->
