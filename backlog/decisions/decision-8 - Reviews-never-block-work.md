---
id: decision-8
title: Reviews never block work
date: '2026-11-19T22:21:00Z'
status: accepted
---
## Context

Owner ruling (2026-10-24) after a lane stop nearly gated commits on one reviewer lane.

## Decision

Reviews never block work: at a lane stop, review on an open lane and queue the preferred-lane re-review for when lanes reopen. Commits are not gated on a specific reviewer lane. A reviewer from a different model family than the author is preferred (same-family fresh context is the labelled fallback, with the cross-family pass queued).

## Consequences

Work continues across lane outages; the queued re-review rides the next open window.
