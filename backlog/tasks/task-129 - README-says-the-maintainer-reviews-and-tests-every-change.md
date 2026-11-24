---
id: TASK-129
title: README says the maintainer reviews and tests every change
status: Done
assignee: []
created_date: '2026-11-24T16:08:00Z'
updated_date: '2026-11-24T18:36:00Z'
labels:
  - docs
  - needs-lila
dependencies: []
priority: low
ordinal: 60920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
README.md 'AI-assisted development' says 'Every change is reviewed and tested by the maintainer before it lands.' The working practice in CLAUDE.md is different: every change gets a fresh-context agent review, the claude-review job, the full test gate and CI; the maintainer rules on product calls but doesn't read diffs. A public statement about the maintainer's own practice, so the wording is hers: propose a sentence that says what actually gates a change, and land it on her yes. Found during TASK-19.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-24: shipped in PR #209 (merged 8e6dd78a). Review lows filed as TASK-134 (and TASK-132 for light-theme link contrast).
<!-- SECTION:NOTES:END -->
