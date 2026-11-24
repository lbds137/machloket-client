# Token storage: the client half

Status: **DRAFT**, client half of TASK-136, joint with the Machloket Server project. The server half (the contract) is a draft in the server repo, which stays private until its public release, so this doc restates every contract point the client depends on. The contract below was read from the server draft on 2026-11-24 at 16:08 EST, while its review was still running. Re-read it before this doc leaves DRAFT.

## Decided

**Product decision (Lila, 2026-11-24): "ours first, others best-effort".**

- Browser sessions on our own deployment log in with a same-site httpOnly cookie.
- Header tokens (`Authorization`) stay for accounts on other instances and for bots.
- The server picker and instance discovery stay.
- No new workarounds for stock Spacebar.

**Lila's rulings (2026-11-24 16:04):**

1. **Several accounts on our deployment in one browser:** the first one gets the cookie, and any further ones keep header tokens, as accounts on other instances do. Account switching works as today.
2. **How long a login lasts:** the same as today. A cookie login lasts until logout, revocation or a password change.

## The contract the client depends on (server draft, restated)

- **When cookie mode exists:** only on a deployment where the client origin and the API share one site (`machloket.chat` and a subdomain of it), with the API and gateway on one host, and with the client's exact origin on the server's allowlist. Everywhere else, everything stays header tokens.
- **Opting in:** a login-type request (login, register, the MFA steps of login) asks for a cookie with the header `X-Machloket-Auth: cookie`. That request also carries `X-Machloket-CSRF: 1`.
  - **Honoured:** the server sets an httpOnly, `Secure`, `SameSite=Strict`, host-only cookie on the API host. The body has no `token` and has `"auth_mode": "cookie"`.
  - **Ignored:** the server ignores the opt-in when cookie mode is off, when the origin is not allowlisted, or when the browser already holds a valid cookie for a different user. The body then has a `token` exactly as today.
  - **The rule for the client:** the body is the truth. `auth_mode === "cookie"` means a cookie session, and anything else is a header-token session.
- **Using it:**
  - Cookie-authenticated requests send no `Authorization`. If `Authorization` is present, it is the only credential the server reads; a bad header never falls back to the cookie.
  - Every cookie-authenticated request other than GET, HEAD or OPTIONS needs `X-Machloket-CSRF: 1` and an allowlisted `Origin`. Without both, the server answers 403.
- **Rotations:** a rotation on a cookie session answers with a fresh cookie and no body token. The rotations are TOTP enable and disable, a password change, and the gateway's token refresh.
- **Gateway:** Identify (op 2) and Resume (op 6) may leave `d.token` empty or absent. The WebSocket upgrade's cookie then authenticates. READY carries no `auth_token` for a cookie session.
- **Migration:** `POST /auth/session-cookie`, sent with the current header token plus the opt-in and CSRF headers, converts that same session to a cookie and answers 204.
- **Logout:** logout clears the cookie. A 401 on a cookie-authenticated request also clears it.

## Open questions for Server (they block leaving DRAFT, not drafting)

1. **When to opt in.** The client cannot read an httpOnly cookie, and sending a custom header to a stock instance's login adds a preflight that may fail.
   - **Ask:** a pre-auth signal that cookie mode is on for this origin. For example, an `auth_cookie: true` field in a discovery response the client already fetches before login.
   - **Fallback** if Server declines: opt in only when the API host is the client's own host or a subdomain of it. That is a weaker test.
2. **Which 401s clear the cookie.** Some routes answer a bare 401 for a wrong password or a rejected TOTP code (the client's 401 handler already guards against this: see `isPreAuthEndpoint` and `tokenIsDead` in `utils/apiFetch.ts`). Does the clear fire only when the auth middleware rejects the credential? Otherwise a typo logs the user out.
3. **A stale header token after migration or rotation.** A second tab, or a failed storage write, may still send the old header token. Because a bad header never falls back to the cookie, that request gets 401.
   - Does the migrated session's JWT stay valid as a header token? The contract says the same session is converted in place, which suggests it does.
   - On a rotation, does the old token die?
4. **Migration idempotency.** Does a second `POST /auth/session-cookie` on an already-converted session answer 204 again?
5. **A failed logout.** If logout never reaches the server, the client removes the account locally, but the httpOnly cookie stays and still authenticates.
   - The client plans to retry the logout at the next start, by cookie alone (see Logout below).
   - Does `POST /auth/logout` with no `Authorization` log out the cookie session?
6. **CORS for the new headers.** Does the preflight answer allow `X-Machloket-Auth` and `X-Machloket-CSRF`, and with what `Access-Control-Max-Age`?
7. **`resume_gateway_url`.** The client resumes on the URL READY gives it (`localuser.ts:649`). In cookie mode, that must be the API's host, or the cookie never reaches the resume upgrade.

## The client today (main `e6330c6b`, read 2026-11-24)

- **Storage:**
  - Every account is a `Specialuser` (`utils/utils.ts:180`). Each one is stored in localStorage `userinfos`, with its token in `token` (`utils/utils.ts:198`).
  - `writeAccounts` (`utils/storage/settingOverlay.ts:121`) is the single writer. When the store refuses a write, the value is held in an in-memory overlay.
  - An account is keyed by `uid` = email + well-known URL (`utils/utils.ts:344`).
  - sessionStorage holds only the current account's `uid` (`currentuser`), not a token copy. The task description's "session-only copy" is the in-memory overlay.
- **Requests:**
  - A `Localuser` builds one `headers` object, with `Authorization`, at `localuser.ts:403`. In `src/webpage` (git grep, tests excluded):
    - 142 call sites in 17 files pass a `headers` object;
    - 119 call sites go through `apiFetch` in 27 files;
    - 30 raw `fetch(` calls sit in 16 files;
    - `Authorization` appears in 11 files.
  - Pages outside `Localuser` take a raw token: oauth2 bot invites (`oauth2/botInvite.ts:55`, `:80`), invite acceptance (`utils/acceptInvite.ts:18`), logout (`utils/utils.ts:222`), and the 401 probe (`utils/apiFetch.ts:63`).
  - Attachment uploads use two XHRs (`channel.ts:4757`, `:4808`).
- **Credentials:**
  - A global `fetch` wrapper sets `credentials: "include"` for every API host of a stored account (`utils/utils.ts:1083`). The host list is filled from stored accounts (`utils/utils.ts:47`).
  - With no stored accounts (the first login), the login fetch therefore uses the default `same-origin`. A cross-origin `Set-Cookie` would then be dropped.
  - XHRs do not set `withCredentials`.
- **401 handling:**
  - `handleUnauthorized` engages only when the request carries `Authorization` (`utils/apiFetch.ts:24`, `:81`).
  - It probes `/users/@me` with that token, and `invalidateAccount` finds the account by token equality (`utils/utils.ts:429`).
  - A cookie request carries no token, so today a 401 on it would be ignored.
- **Gateway:** Resume sends `d.token` at `localuser.ts:693` and Identify at `localuser.ts:707`. A READY `auth_token` replaces the stored token (`localuser.ts:506`).
- **Token issuers:** what the client does with each one today.

  | Server issuer                | Client site                                                            | What the client does with the token  |
  | ---------------------------- | ---------------------------------------------------------------------- | ------------------------------------ |
  | login                        | `login.ts:74`, stored at `:100`                                        | stores it                            |
  | register                     | `register.ts:25`, stored at `:57`                                      | stores it                            |
  | login MFA (TOTP, WebAuthn)   | `settings.ts:2315`, `:2430`, into the login form                       | stores it via login                  |
  | email verify                 | none (the only `/auth/verify` use is a sub-route, `localuser.ts:4036`) | n/a                                  |
  | password reset               | `recover.ts:48`                                                        | ignores it, goes to `/login` (`:43`) |
  | TOTP enable / disable        | `localuser.ts:3915` / `:3889`                                          | **ignores it**                       |
  | password change (`newToken`) | `localuser.ts:4244`                                                    | **ignores it**                       |
  | READY `auth_token`           | `localuser.ts:506`                                                     | replaces the stored one              |
  | bot token                    | `localuser.ts:5366`, `:5601`                                           | stores it in `perminfo.applications` |

## Client design

### The account record

- **The record:** a `Specialuser` gains `auth_mode?: "cookie"`. A cookie account stores no `token`. The constructor's "missing pieces" check accepts that shape.
- **One cookie account per API host,** because the cookie is host-only.
  - The client opts in only when no stored account on that API host is already a cookie account.
  - Server's "already holds a cookie for another user" rule is the backstop, not the plan.
- **When the cookie account logs out:** the other own-deployment accounts stay on header tokens. Converting one of them is the migration below, run at the next start; the user is never asked.

### One account-keyed request path

- **Credentials:** every authenticated request gets them from the account, never from a raw token.
  - **Header account:** `Authorization: <token>`.
  - **Cookie account:** no `Authorization`, plus `X-Machloket-CSRF: 1` on every request. Sending it on every method is simpler than sorting by method at 142 call sites. It adds no preflight, because those requests already carry `Content-type: application/json`.
- **One builder:** `Localuser.headers` becomes the output of that builder. The raw-token pages (bot invite, invite acceptance, logout, the 401 probe) take the account instead of its token.
- **XHR uploads:** these set `withCredentials` for a cookie account.
- **Issuing requests:** these set `credentials: "include"` themselves. They cannot rely on the global wrapper, whose host list is empty before the first account.

### The ambient-cookie hazard

The global wrapper sends credentials to every known API host. Once a cookie exists, any request to our API host carries it, including a request made for a second, header-token account.

- **The hazard:** if that request lacks `Authorization` (a call site that forgot it), the server acts as the cookie account.
- **The guard:** the account-keyed builder makes "no `Authorization`" possible only for the cookie account. A unit test pins that a header account's request always carries its token.

### Login, register and the MFA steps of login

- **When the client opts in:** only when the instance signals cookie mode (Open question 1) and no cookie account exists on that host.
- **Response handling:** the login handler branches on `auth_mode`. It stores a cookie account, or a header account exactly as today.
- **Reset and email verify:** these send no opt-in, because the client does not consume their token.

### Rotations

- **Cookie account:** a rotation needs nothing from the client; the server re-sets the cookie.
- **Header account:** the client starts storing the rotated token from TOTP enable and disable and from a password change. Today it drops them (see Found work).
- **The rule in every handler:** never write an absent `token` over a stored one.

### Gateway

- **Cookie account:** Identify and Resume send no `d.token`. The WebSocket upgrade carries the cookie on its own, because it is same-site.
- **Header account:** as today.
- **READY's `auth_token`:** still applies to header accounts only.

### 401 handling

- **Keyed by account:** `handleUnauthorized` and `invalidateAccount` are keyed by account (`uid`), not by token.
- **The cookie account's probe:** `GET /users/@me` with credentials and no `Authorization`. The existing guards stay: the pre-auth exemption, verifying before invalidating, and a single page-wide latch.

### Migrating existing sessions

- **When:** at start, for the current account, if it is a header account on a cookie-mode instance and that host has no cookie account yet.
- **The steps:**
  1. `POST /auth/session-cookie`.
  2. On 204, set `auth_mode`, remove `token`, and save through the existing `tryUpdateLocal` path (its refusal semantics are pinned in `utils/accountSave.test.ts`).
- **A refused save:** the old token stays stored, and the next start migrates again. That depends on Open questions 3 and 4.
- **Other tabs:**
  - Other tabs read the record from storage and switch at their next request build.
  - Until then, a tab that still sends the old header token depends on Open question 3.

### Logout and removing an account

- **Cookie account logout:** logout of a cookie account sends credentials and the CSRF header.
- **A failed logout:** if the logout fails and the user removes the account anyway, the client records a pending logout for that API host. It retries `POST /auth/logout` by cookie at the next start (Open question 5), so a removed account's cookie does not linger.

### When the record and the cookie disagree

- **The record says cookie, but the cookie is gone** (cleared site data, expiry): requests get 401, and the 401 path marks the account logged out. The user logs in again.
- **A cookie exists, but no record does** (the failed logout above): the pending logout covers the case the client knows about. Any other case is server-revocable, and the hazard guard keeps the client from acting through it.

## What this does and does not fix

- **Fixes:** the own-deployment session token is no longer readable by page script. A script injection cannot copy it out of the browser, which a clear-text localStorage token allows today.
- **Does not fix:**
  - A script injection can still act through the open session while the page is open. The CSP from TASK-135 is the layer for that.
  - These still sit in localStorage as today: tokens of extra own-deployment accounts, other-instance accounts, and bots.
- **The CodeQL "clear-text storage" dismissals:** their wording stays Lila's call after this ships.

## Found work (TASK-145, TASK-146)

- **Rotated tokens are dropped:** TOTP enable and disable and the password change ignore the token they return. If the server invalidates the old token on those rotations, the account is logged out at its next 401. This is from reading the code; no run has confirmed it, and the real-server tier can.
- **Bot tokens are stored in clear text:** they are stored in `perminfo.applications` in localStorage. decision-9 keeps bots on header tokens, but whether they must be persisted is separate.

## Tests

- **Unit (Vitest):**
  - the builder's output for each account mode;
  - a header account always sends its token;
  - the 401 path for a cookie account;
  - both login response shapes;
  - migration: 204, a refused save, and a non-204;
  - no handler writes an absent token.
- **Mock e2e:**
  - the opt-in and CSRF headers on login;
  - cookie-mode requests carry no `Authorization`;
  - a token-less Identify.
- **Real-server tier** (once the server tasks land):
  - log in to a cookie session, then READY, then send a message;
  - migration;
  - logout;
  - a header-token second account on the same instance.

## Sequence

1. **The account-keyed request path and 401 handling.** A refactor with no behaviour change. It can land before any server work.
2. **Storing rotated tokens for header accounts** (Found work).
3. **Cookie login and register,** after the server's issuance, CSRF and CORS tasks and an answer to Open question 1.
4. **Token-less gateway,** after the server's gateway task.
5. **Migration and pending logout,** after `POST /auth/session-cookie`.
6. **The real-server specs.**
