---
id: TASK-46
title: History-slice rider pack
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - deferred
dependencies: []
ordinal: 670
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
(a) A second grabBefore caller with a DIFFERENT id during an in-flight successful page still reads "unlinked" as the top — loop until the asked id is linked or a fetch for it ran. Trigger: the channel-slice MEDIUM pass.
(b) grabBefore's topid check runs before fake resolution — a fake resolving to the channel top costs one wasted before= request.
(c) A re-open of the channel in view while a build is in getDiv drops the built list (rebuild on abandon when still focused); getHTML's same-channel early return bumps genid before returning.
(d) A list built but never attached still polls every 100ms until the scroller is deleted (uncapped on purpose) — trigger: any idle CPU/timer report.
(e) putmessages first page: allthewayup is set before an unguarded build loop — a short page that throws part-way leaves a partial page posing as the whole history. Trigger: next first-page touch.
(f) An unbuildable message now fails forever as retry-later (older history stays unreachable, every scroll refetches) — skip/placeholder follow-up. Trigger: a report of unreachable history.
<!-- SECTION:DESCRIPTION:END -->
