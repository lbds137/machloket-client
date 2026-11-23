---
id: TASK-86
title: >-
  rawFetch guard: fix progessiveLoad reason, lengthen generic snippets, note
  WINDOW spacing
status: To Do
assignee: []
created_date: '2026-11-23T02:18:00Z'
labels:
  - u-api
dependencies: []
priority: low
ordinal: 17920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the PR #175 claude-review (lows, verdict PASS). (1) The progessiveLoad.ts ALLOWED reason in src/webpage/rawFetch.test.ts says callers pass CDN URLs; the only default-fetcher caller is media.ts (new ProgressiveArray(url, {method: "get"}) in File.IdentifyFile, verified 2026-11-22), and its url is any media/embed URL. Reword: default fetcher; only media.ts uses it, for non-API media URLs (guild.ts passes apiFetch). (2) Lengthen the one-word snippets fetch(url)/fetch(path) in audio/play.ts, audio/worklet/play.ts and utils/notificationSound.ts (e.g. res = await fetch(url)) so a moved call cannot be silently replaced by another of the same spelling. (3) One-line comment on why WINDOW allows \s* around the dot while CALL has no \s* (harmless asymmetry).
<!-- SECTION:DESCRIPTION:END -->
