---
id: TASK-182
title: >-
  401 path: trust the server's 40001 dead-credential code, probe only as
  fallback
status: To Do
assignee: []
created_date: '2026-11-26T16:36:00Z'
labels:
  - auth
  - server-contract
dependencies: []
priority: medium
ordinal: 113920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Server TASK-310 (machloket-server #304, 1e70f444f; relayed by the Machloket Server session 2026-11-26, not yet deployed to A/B) gives a 401 a tested contract: 401 + body code 40001 = the credential THAT request carried was refused (Authorization header when present, even empty, else the auth cookie). Other 401 codes (401, 50014, 50027) are endpoint refusals with the session live (rare: 50014 from /auth/sessions after a racing account deletion; the next request answers 40001). Wrong-password forms answer 400. Contract: server docs/design/token-storage.md "Dead-credential answer".

Client today (src/webpage/utils/apiFetch.ts probeUnauthorized): every post-auth 401 sends a GET <api>/users/@me probe with the credential read at CALL time (PR #229 / TASK-169). With the contract the second request is unnecessary on instances that speak it.

Shape to decide at unit time: (1) read the 401 body code (bounded, a clone so callers keep the body); 40001 -> dead verdict for the credential the request SENT (capture it at send time, not at 401 time: a token READY swapped in since is not the refused one), then the existing cookieVerdictFor401 / invalidateAccount / one-nav path; other codes -> notDead with no probe. (2) Instances without the contract (other Spacebar servers, A/B until deployed): keep the /users/@me probe as the fallback. Decide how the client tells them apart (no code / non-JSON body -> probe, vs. an instance-capability flag); a plain 401 with code 0 from an old server must still probe. (3) Gateway 4004 carries no body code: stays on the probe. Mock tier + real-server tier (e2e-real) once A/B run #304.
<!-- SECTION:DESCRIPTION:END -->
