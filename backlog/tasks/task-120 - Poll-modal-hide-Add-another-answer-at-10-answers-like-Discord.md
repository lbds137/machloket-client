---
id: TASK-120
title: 'Poll modal: hide Add another answer at 10 answers, like Discord'
status: To Do
assignee: []
created_date: '2026-11-24T14:02:00Z'
labels:
  - parity
dependencies: []
priority: low
ordinal: 51920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discord glance 2026-11-24 (Claude in Chrome, Lila's web client, Create Poll modal, closed without posting): Discord's question max 300, answer max 55, 2 answers to start, 10 max, durations 1h/4h/8h/24h/3d/1w/2w all match ours (utils/pollValidation.ts, localuser.ts hours array). One difference: at 10 answers Discord removes the 'Add another answer' button entirely (clicked 8 times, the button was gone), while ours keeps it disabled with the poll.maxAnswers hint (localuser.ts updateValidation, atMax). Low, look-and-feel: decide whether to match (hide the button, keep or drop the hint) when next in the poll modal.
<!-- SECTION:DESCRIPTION:END -->
