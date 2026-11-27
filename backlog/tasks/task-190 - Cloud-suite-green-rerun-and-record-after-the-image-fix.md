---
id: TASK-190
title: 'Cloud suite green: rerun and record after the image fix'
status: To Do
assignee: []
created_date: '2026-11-27T14:30:00Z'
updated_date: '2026-11-27T15:09:00Z'
labels: []
dependencies: []
priority: medium
ordinal: 121920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three cloud runs (docs/local/cloud-run{1,2,3}-*) prove everything except the browser download: setup, tree attribution (test tree == head.txt all three runs), npm ci, playwright system deps, both suites running as cloudtest, results delivery, report vocabulary. What fails: downloading Chrome for Testing (playwright chromium v1255) — code=1 as root (run 2) AND as the test user (run 3), while npm registry works (npm ci ok, 2s, every run). Launch errors name /home/cloudtest/cloud/pw-browsers (run 3), proving the uenv export applied: the plumbing is correct; the VM cannot reach the playwright CDN. NOT fixable in this repo. Trigger: Deck/DP opens egress for the playwright download hosts, provides a PLAYWRIGHT_DOWNLOAD_HOST mirror, or pre-provisions chromium 1255 into /opt/pw-browsers. Then: rerun cloud-test from merged main, expect green, cloud-test record RUN (push-gate stamp per repo CLAUDE.md). Filed 11-27 with the Deck report to DP.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-11-27T15:09:00Z

---

DP TASK-406 (high, af325c56) tracks the image fix — Deck confirmed 11-27: rerun from main once 406 lands, then cloud-test record RUN.

---
<!-- COMMENTS:END -->
