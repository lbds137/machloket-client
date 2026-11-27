---
id: TASK-139
title: Gate stock-compat guards on /_spacebar/api/version
status: In Progress
assignee:
  - machloket-client
created_date: '2026-11-24T18:24:00Z'
updated_date: '2026-11-27T18:35:00Z'
labels:
  - api
  - compat
dependencies: []
priority: medium
ordinal: 70920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: Deck's client+server coupling survey for Lila, 2026-11-24. The client guesses whether it talks to a stock Spacebar or the fork in several compat guards. Read /_spacebar/api/version once per instance and gate those guards on it instead. Inventory the guards first (grep stock/compat/fallback paths), then fix red-first.
<!-- SECTION:DESCRIPTION:END -->
