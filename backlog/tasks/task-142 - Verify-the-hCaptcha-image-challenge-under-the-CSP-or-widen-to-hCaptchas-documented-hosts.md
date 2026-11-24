---
id: TASK-142
title: >-
  Verify the hCaptcha image challenge under the CSP (or widen to hCaptcha's
  documented hosts)
status: To Do
assignee: []
created_date: '2026-11-24T20:45:00Z'
labels:
  - security
  - csp
dependencies: []
priority: medium
ordinal: 73920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #210 (TASK-135) allows only js.hcaptcha.com (script-src + allowedScriptURL in src/webpage/utils/trustedTypes.ts) and newassets.hcaptcha.com (frame-src), in src/webpage/utils/contentSecurityPolicy.ts. A one-off probe with hCaptcha's public test sitekey rendered the widget with zero violations, but the image-challenge path never ran. claude-review on #210 says hCaptcha's published CSP guidance lists https://hcaptcha.com and https://*.hcaptcha.com for script/frame/style/connect (not checked against hCaptcha's docs here). Captcha is a planned gate on the public instance, so a refused challenge host would lock users out of login/registration. Do first: probe with a sitekey that forces a challenge, under the shipped policy, and record which hosts it loads. Widening the allowlist is a security tradeoff: Lila's call.
<!-- SECTION:DESCRIPTION:END -->
