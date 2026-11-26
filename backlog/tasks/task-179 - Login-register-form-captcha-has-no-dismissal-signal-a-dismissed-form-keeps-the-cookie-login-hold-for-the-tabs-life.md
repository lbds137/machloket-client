---
id: TASK-179
title: >-
  Login/register form captcha has no dismissal signal; a dismissed form keeps
  the cookie-login hold for the tab's life
status: To Do
assignee: []
created_date: '2026-11-26T09:54:00Z'
labels:
  - auth
dependencies: []
priority: medium
ordinal: 110920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the cross-family re-review of PR #222 (TASK-163), 2026-11-26. login.ts:165 and register.ts:116 call form.addCaptcha(), so Form.submit reaches handleCaptcha (settings.ts:2489), which awaits cap.makeCaptcha(json) with no AbortSignal; only the static Captcha.makeCaptcha fallback (settings.ts:~2287) wires float.onhide to an abort. Scenario (inferred, not run): a cookie-mode login gets an hCaptcha challenge, the user closes the dialog or switches to register; makeCaptcha keeps polling, Form.submit never reaches its finally (submitSettled), so the machloket-cookie-login:<slot> Web Lock stays held until the tab closes. Effects: later logins/registers on that host in any tab fall back to token mode, and retryPendingLogout skips the host. The TASK-163 docs (Form.submitSettled comment, token-storage.md) already claim a dismissed captcha releases the hold. Fix shape: pass the form dialog dismissal signal into cap.makeCaptcha, red-first test in cookieLogin.test.ts (captcha answer, hide the dialog, assert the hold is released).
<!-- SECTION:DESCRIPTION:END -->
