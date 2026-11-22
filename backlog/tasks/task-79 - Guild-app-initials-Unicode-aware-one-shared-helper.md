---
id: TASK-79
title: 'Guild/app initials: Unicode-aware, one shared helper'
status: To Do
assignee: []
created_date: '2026-11-22T22:33:00Z'
labels:
  - parity
  - media
dependencies: []
priority: low
ordinal: 10920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the TASK-78 council review (2026-11-22). Guild initials are built in several places (guild.ts generateGuildIcon, the emoji.ts and sticker.ts picker headers, invite.ts), each with its own regex: /\w+/g in the pickers and invite, /[^\s]+/g in the sidebar. \w is ASCII-only, so a non-Latin guild name (Hebrew, Cyrillic, CJK) is left unshortened in the pickers and invite: the whole name shows with its spaces removed (probed: "שלום עולם" -> "שלוםעולם"). appIconElm (interactions/commandPicker.ts) uses .slice(0, 1), which splits a surrogate pair, so an app name starting with an emoji shows half a character. Since TASK-78 these initials are also the fallback when an icon fails to load. Do: one shared Unicode-aware initials helper (segment by grapheme, using Intl.Segmenter or [...str]) used by every site. Red-first tests with Hebrew and emoji-led names.
<!-- SECTION:DESCRIPTION:END -->
