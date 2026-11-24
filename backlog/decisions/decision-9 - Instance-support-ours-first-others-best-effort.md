---
id: decision-9
title: 'Instance support: ours first, others best-effort'
date: '2026-11-24T18:24:00Z'
status: accepted
---
## Context

Owner ruling, relayed by the Deck session on 2026-11-24 at 13:24. It followed Deck's client and server coupling survey. The question was whether Machloket Client must keep supporting other people's Spacebar servers, not just ours. That matters for token storage (TASK-136), the compatibility guards (TASK-139) and the instance picker.

## Decision

Our instance comes first; other Spacebar instances are best-effort. The option she picked reads: "Keep the server picker so it still connects anywhere, but stop writing workarounds for stock Spacebar, and allow same-site cookie login on our own deployment."

## Consequences

- No new workarounds for stock Spacebar.
- Existing compat guards may be deleted once our server makes them redundant, gated by the /_spacebar/api/version handshake (TASK-139).
- The instance picker and discovery stay.
- TASK-136's design targets same-site cookie login on our own deployment, with header tokens kept for other instances and bots.
- Machloket Server gets the same ruling, through Deck.
