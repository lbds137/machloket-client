---
id: TASK-161
title: 'getapiurls: cookie discovery only where authCookie is used'
status: To Do
assignee: []
created_date: '2026-11-25T21:10:00Z'
updated_date: '2026-11-25T21:41:00Z'
labels:
  - performance
  - auth
dependencies: []
priority: medium
ordinal: 92920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #216 review (both claude-review runs): getapiurls now runs discoverAuthCookie (/policies/instance/domains, up to 5 s) after resolveApiUrls, serially, on every caller: embed.ts invite embeds for foreign instances, invite.ts, templatePage.ts, oauth2/auth.ts, checkInstance and the gateway reconnect URL refreshes (localuser.ts close cases 3/4). A slow instance adds up to 5 s there, and an embed's instance can join cookieModeHosts (harmless: it only withholds credentials). getApiUrlsV2 already fetches the same route. Options: an opt-out parameter, discovery only on the login/register pick and the stored-account refresh, or reuse getApiUrlsV2's answer when checkURLs kept the API base. Measure the added latency first.
<!-- SECTION:DESCRIPTION:END -->
