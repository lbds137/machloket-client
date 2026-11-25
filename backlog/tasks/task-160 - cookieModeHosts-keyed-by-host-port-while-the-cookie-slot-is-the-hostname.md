---
id: TASK-160
title: cookieModeHosts keyed by host:port while the cookie slot is the hostname
status: To Do
assignee: []
created_date: '2026-11-25T20:24:00Z'
labels:
  - auth
dependencies: []
ordinal: 91920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-149 review: cookies ignore the port, and the cookie slot (utils.ts cookieSlot) is now the hostname, but cookieModeHosts (accountHeaders.ts) and credentialsFor still key by URL host incl. port. A header account on host:3002 next to a cookie account on host:3001 sends without credentials:include, so it doesn't carry the shared cookie, which is correct; check whether any path needs the hostname key (e.g. pendingLogouts host keys feeding cookieModeHosts) and pin it with a test.
<!-- SECTION:DESCRIPTION:END -->
