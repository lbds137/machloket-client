---
id: decision-7
title: 'Federation constraint: allowlist-only, invite-only, no discovery'
date: '2026-11-19T22:21:00Z'
status: accepted
---
## Context

Design constraint (2026-10-24, moved from the role-file charter): a future federation feature must fit the owner's threat model.

## Decision

Federation, when built, is allowlist-only, invite-only, no discovery. Leave room for user@host identities and remote guilds.

## Consequences

It shapes any invite/instance work until the owner rules otherwise — e.g. instance pickers and invite surfaces keep an allowlist path open.
