---
id: TASK-84
title: 'Deleted jumbo emoji: should the :name: fallback keep the big size?'
status: Done
assignee: []
created_date: '2026-11-23T00:32:00Z'
updated_date: '2026-11-24T13:59:00Z'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-24 08:40 owner reply (Phone Hub): 'you can browse Discord in Chrome and try to resolve this for yourself' - not her call any more; settle it with a Discord glance in Chrome (deleted custom emoji sent alone: does the :name: fallback render at jumbo size or inline?), then build to match. Not started: the session is finishing highs before parking (Lila via Deck 11-24).

2026-11-24 08:58 Discord glance (Claude in Chrome, Lila's signed-in web client): forced a real custom jumbo emoji (img.emoji.jumboable, 48x48, alt ':name:') to a 404 by pointing its src at cdn.discordapp.com/emojis/1.webp. Discord has no fallback of its own: same node, only the src changed (MutationObserver saw one attributes:src mutation), and naturalWidth 0. The browser's broken-image box keeps the 48px jumbo height, while the alt text draws in the line's own font (computed font-size 16px; width grew 48->64 to fit it). So the :name: text is ordinary text size in Discord too. Decision: keep our inline-size fallback (.md-emoji-fallback, font: inherit), no code change. Caveat: this is a forced 404, not an emoji that was actually deleted; Discord's CDN may still serve a deleted emoji's image, in which case nothing falls back at all. The screenshot zoom timed out, so the evidence is DOM measurements only.
<!-- SECTION:NOTES:END -->
