---
id: TASK-84
title: 'Deleted jumbo emoji: should the :name: fallback keep the big size?'
status: To Do
assignee: []
created_date: '2026-11-23T00:32:00Z'
labels:
  - parity
  - media
dependencies: []
priority: low
ordinal: 15920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the PR #174 claude-review (round 3, low). A custom emoji rendered big (an emoji-only message) that 404s falls back to :name: in the line's own font (.md-emoji-fallback uses font: inherit), so it shrinks to ordinary text. This is a look-and-feel call for Lila: keep inline text size (current), or size the fallback like bigemoji. Discord-truth check: what does Discord show for a deleted jumbo emoji?
<!-- SECTION:DESCRIPTION:END -->
