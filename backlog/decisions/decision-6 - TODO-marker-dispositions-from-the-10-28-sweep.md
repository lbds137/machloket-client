---
id: decision-6
title: TODO marker dispositions from the 10-28 sweep
date: '2026-11-19T22:21:00Z'
status: accepted
---
## Context

TODO burn sweep (2026-10-28): every marker investigated and grounded by reading its context; the owner ruled "investigate them and build a backlog, then start tackling them". These markers carry standing dispositions. Line numbers drift — grep the file at touch time.

## Decision

OBSOLETE: message.ts name-conflict marker (the reaction path already sends name:id) — delete the marker on next message.ts touch. RULED OUT: the dead if(false) avatar branch (delete branch+marker next touch); the member.ts custom timeout marker (the preset list IS exact Discord-truth); the localuser.ts configurable autofill regex marker (no parity, inventing a pref). KEEP: the Firefox workarounds in voice.ts (cross-browser robustness); the utils.ts fetch monkey-patch (central auth path, risk >> value); the localuser.ts -1-constructor sentinel (structural); the favorites.ts migration shim. RIDE natural touches: index.ts menu-to-class; themes.css duplicate dark theme. WALK-GATED: the voice.ts stream-path loader; voice.ts bitrate/framerate values; contextmenu.ts button colors. PARKED with triggers: compontents.ts bot thumbnail variant; infiniteScroller scroll-jump; media.ts parser depth; jsontypes curiosities (fold into the server relay). SERVER-BOUNDED: the null-components shim, the webhook bug, report fields, presence/status markers — deleted per server fix.

## Consequences

Markers are not chased as their own units; they move when their file moves, and the dispositions above stop re-litigation.
