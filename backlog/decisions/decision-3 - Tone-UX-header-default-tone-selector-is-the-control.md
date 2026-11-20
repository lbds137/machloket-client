---
id: decision-3
title: 'Tone UX: header default-tone selector is the control'
date: '2026-11-19T22:21:00Z'
status: accepted
---
## Context

Owner tone-UX ruling (2026-10-27), with her capture as parity evidence: Discord mobile has no picker tone UI (long-press = enlarge + favorite), and she never found Discord's tone changer.

## Decision

The header default-tone selector is THE picker-wide control (one persisted tone, touch-ready). The per-emoji hover tone badge stays for pointer clients only. No long-press unit. Optional Slack-full (the default tone re-renders INCOMING emoji locally, render-layer only) is deferred and needs an explicit go.

## Consequences

No mobile tone parity unit gets built; the visible-by-default header selector is the discoverability answer.
