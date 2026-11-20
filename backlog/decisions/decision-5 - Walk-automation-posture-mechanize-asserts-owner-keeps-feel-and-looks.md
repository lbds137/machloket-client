---
id: decision-5
title: 'Walk automation posture: mechanize asserts, owner keeps feel and looks'
date: '2026-11-19T22:21:00Z'
status: accepted
---
## Context

Walk-triage ruling (2026-11-01, owner posture: "automate testing so she stops being the test runner").

## Decision

Mechanize behaviour asserts in Playwright against a real server where the server's rule decides the outcome; the mock tier everywhere else. The owner keeps feel, Discord-truth looks, and real-device checks. adb on the real phone on demand only: ask through the ask tool each time, run only once the owner confirms it is not in use, never in an automated run. A headless Android emulator tries non-feel bullets first so they do not reach the real device.

## Consequences

Phone-walk bullets shrink to what cannot be mechanized; the walk ledger doc holds the remaining asks.
