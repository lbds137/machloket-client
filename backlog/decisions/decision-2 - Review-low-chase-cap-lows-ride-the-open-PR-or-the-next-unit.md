---
id: decision-2
title: 'Review-low chase cap: lows ride the open PR or the next unit'
date: '2026-11-19T22:21:00Z'
status: accepted
---
## Context

Review rounds were spawning one fixup PR per low (~8.6 min CI + a review round each). Ruled 2026-10-28; reaffirmed 11-10 with the perf review (P1).

## Decision

After #33, review lows ride the open PR or the next unit that touches the area — no fixup PRs of their own. Only a real failure (a red run, a caught regression, a walk finding) spawns dedicated CI work.

## Consequences

Lows are filed as riders (the task store holds them) instead of landing as separate PRs; the chase cap bounds review-round tail cost.
