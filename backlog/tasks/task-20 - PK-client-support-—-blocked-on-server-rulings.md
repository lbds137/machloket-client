---
id: TASK-20
title: PK client support — blocked on server rulings
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - server-bounded
dependencies: []
ordinal: 330
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Goal: full PluralKit support. Gap map + research under `docs/local/pk-gap-map.md` and `docs/local/pk-research/` (12 open questions relayed to the machloket-server session 11-18; relay confirmed). Layering premise: the server IS the platform (no bot process); proxy engine server-side at the handleMessage choke point; client = config UI + message affordances; core rendering already handles webhook-proxied messages. Client work starts only on the server session's rulings + API shape. (The reaction DM-info lookup is documented PK behavior; a message-info app command would be an addition beyond parity — noted 11-18.)
<!-- SECTION:DESCRIPTION:END -->
