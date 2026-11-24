---
id: TASK-143
title: Benchmark the sound editor's closure interpreter in the audio worklet
status: To Do
assignee: []
created_date: '2026-11-24T20:45:00Z'
labels:
  - audio
  - perf
dependencies: []
priority: low
ordinal: 74920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-135 replaced new Function in src/webpage/audio/worklet/voice.ts with a closure interpreter (parseExpression/unary/binary); each sample now walks closures instead of one compiled expression. claude-review on PR #210 flagged possible underruns for deep formulas x sample rate x voices. Microbenchmark the editor's custom voice at 48 kHz in the worklet; act only on a measured problem.
<!-- SECTION:DESCRIPTION:END -->
