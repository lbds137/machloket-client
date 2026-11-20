---
id: TASK-43
title: 'US-4: Form error-body migration sweep'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - deferred
dependencies: []
priority: medium
ordinal: 90
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Nine posting forms handle error bodies inside onSubmit and must move to the Form error hook before Form stops calling onSubmit on non-2xx: direct.ts ~183 add-friend; localuser.ts ~2377 template create, ~3320 TOTP disable, ~3350 TOTP enable, ~3801 delete account, ~3976 create app; login.ts ~76 (errors.at(0) is broken — errors is an object); recover.ts ~51 forgot (the captcha branch is unreachable — handleCaptcha eats it); settings.ts ~2065 TOTP 2FA prompt. The Class-C forms acting on error bodies today gain the most (guild.ts 1313/1357 templates, role.ts 334, message.ts 266, channel.ts 544/587). Trigger: next forms/Form touch.
<!-- SECTION:DESCRIPTION:END -->
