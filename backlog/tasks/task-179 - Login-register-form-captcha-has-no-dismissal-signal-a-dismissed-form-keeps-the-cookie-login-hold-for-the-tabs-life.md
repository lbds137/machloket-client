---
id: TASK-179
title: >-
  Login/register form captcha has no dismissal signal; a dismissed form keeps
  the cookie-login hold for the tab's life
status: To Do
assignee: []
created_date: '2026-11-26T09:54:00Z'
updated_date: '2026-11-26T13:36:00Z'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Prep 2026-11-26: Dialog.hide (settings.ts:1546) runs removeAni, and the element leaves the DOM once its exit animation ends, so the inline wait can end when the form captcha div is no longer connected (per-instance this.div.isConnected, not the shared static Captcha.hcaptcha node, which another form can adopt). Covers dialog close AND the switch to register (dialog.hide then makeRegister). Standalone login.html never detaches the form, so it is unaffected. Red-first: cookieLogin.test.ts, a captcha answer to /auth/login, hide the dialog, assert the cookie-login hold is free.

Same class, fold in (review low, 2026-11-26): a second submit of the same login form while its first submit waits on a second factor leaves the first 2FA dialog and its cookie-login hold open (the re-submit logs in by token by design, see TASK-176). Fix with the dismissal signal: closing or superseding the first 2FA dialog releases its hold; red-first test in cookieLogin.test.ts.
<!-- SECTION:NOTES:END -->
