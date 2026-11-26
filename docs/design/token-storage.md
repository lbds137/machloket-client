# Token storage: the client half

Status: **Agreed**, client half of TASK-136, joint with the Machloket Server project. The server half (the contract) is agreed and merged in the server repo, which stays private until its public release, so this doc restates every contract point the client depends on. The contract below was read from the server draft on 2026-11-24 at 16:08 EST, then updated from Server's answers and its contract PR's review changes (relayed by 2026-11-24 16:30). On 2026-11-24 this session diffed that 16:08 copy against the merged contract and added the one client-facing point it was missing (Other clears). Server's implementation units are its TASK-313, then TASK-321 to TASK-323.

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
- **How the client knows:** the pre-auth discovery answer carries `"authCookie": true` (answer 1 below).
- **Origins:** the client origin must differ from the API's origin (for example `https://machloket.chat` and `https://api.machloket.chat`). Serving the client from the API host turns cookie mode off.
- **Opting in:** a login-type request (login, register, the MFA steps of login) asks for a cookie with the header `X-Machloket-Auth: cookie`. That request must also carry `X-Machloket-CSRF: 1`; without it the opt-in is ignored.
  - **MFA logins:** a login answering `mfa: true` sets no cookie. The second-factor call (`/auth/mfa/totp` or `/auth/mfa/webauthn`) carries the opt-in and CSRF headers itself.
  - **Honoured:** the server sets an httpOnly, `Secure`, `SameSite=Strict`, host-only cookie on the API host. The body has no `token` and has `"auth_mode": "cookie"`.
  - **Ignored:** the server ignores the opt-in when cookie mode is off, when the origin is not allowlisted, or when the browser already holds a valid cookie for a different user. The body then has a `token` exactly as today.
  - **The rule for the client:** the body is the truth. `auth_mode === "cookie"` means a cookie session, and anything else is a header-token session.
- **Using it:**
  - Cookie-authenticated requests send no `Authorization`. If `Authorization` is present, it is the only credential the server reads; a bad header never falls back to the cookie.
  - Every cookie-authenticated request other than GET, HEAD or OPTIONS needs `X-Machloket-CSRF: 1` and an allowlisted `Origin`. Without both, the server answers 403. The three CSRF-checked GETs, which change state or hand out a credential, take the same checks: `/auth/generate-registration-tokens`, `/connections/:name/authorize` and `/users/@me/connections/:name/:id/access-token`.
- **Rotations:** a rotation on a cookie session (TOTP enable and disable, a password change) answers with a fresh cookie, `"auth_mode": "cookie"` and no body token. The gateway sends no token refresh to a cookie session (see Gateway). Bot create and reset still return the bot token in the body.
- **Gateway:** Identify (op 2) and Resume (op 6) may leave `d.token` empty or absent. The WebSocket upgrade's cookie then authenticates. READY carries no `auth_token` for a cookie session.
- **Migration:** `POST /auth/session-cookie`, sent with the current header token plus the opt-in and CSRF headers, moves the login into a new cookie session and answers 204. The old header token dies (answer 3).
  - **Refusals (Server, 2026-11-24 after 16:27):** 204 only when the cookie was set for this session. 403 when the opt-in, Origin or CSRF check fails, cookie mode is off, or the caller is a bot; 409 when the browser holds a valid cookie for a different user. On every refusal nothing changes: the old session and its header token stay valid, and the client keeps its header account.
- **Logout:** a logout with no `Authorization` (the cookie account's) clears the cookie. A logout with `Authorization` (a header account on the same host) leaves the cookie alone. The auth layer clears a dead cookie on any API route, so a logout carrying only a dead cookie answers 401 with the cookie cleared: the client treats a 401 on logout as logged out. A route's own 401 never clears the cookie (answer 2).
- **Other clears:** a cookie-authenticated "log out all sessions", removing the caller's own session from the sessions list, account disable and account delete also clear the cookie. The client needs no special handling: the account's next request gets 401, and the 401 path marks it logged out.
- **Same user, new login:** a login by the same user while their valid cookie is present replaces the cookie and ends its old session.
- **Sliding refresh:** a cookie-authenticated response re-sets the cookie when it was last set over 30 days ago, so the browser's roughly 400-day cap only logs out someone idle that long. No client work.

## Server's answers to the client's questions (Machloket Server, 2026-11-24 16:15)

These answers are in the merged server contract (checked 2026-11-24).

1. **When to opt in:** the discovery route the client already fetches before login, `GET /policies/instance/domains` (`utils.ts` `discoverAuthCookie`, which asks the resolved API base), gains `"authCookie": true`. The server sends it only when cookie mode is on and the request's `Origin` is allowlisted, and leaves it out otherwise. The client opts in only when it is `true`. Stock instances never send it.
2. **Which 401s clear the cookie:** only the auth layer rejecting the cookie credential itself. A route's own 401 (a wrong password, a rejected TOTP code, an MFA step-up refusal) never clears it.
3. **A stale header token:**
   - **Migration rotates.** `POST /auth/session-cookie` mints a new session into the cookie and removes the old one, so the old header token dies. Any tab or stored record still holding it gets 401.
   - **Rotations on a cookie session** (TOTP enable or disable) replace the caller's own session, so only the new cookie stays valid. A password change already ends every other session.
4. **Migration repeated:** a call authenticated by the cookie, with no `Authorization`, answers 204 and changes nothing. A call with the dead header token answers 401.
5. **Logout by cookie:** `POST /auth/logout` with no `Authorization`, authenticated by the cookie, with the CSRF header and an allowlisted Origin, ends that session and clears the cookie. A retry at the next start works.
6. **CORS:** the preflight allows both custom headers, and allowlisted origins get credentials. `Access-Control-Max-Age` is 60 s.
7. **`resume_gateway_url`:** the client resumes on it (`localuser.ts:649`). Under the one-host precondition the contract requires it to be the API host; a deployment where it is not has cookie mode off.

## The client today (main `e6330c6b`, read 2026-11-24)

- **Storage:**
  - Every account is a `Specialuser` (`utils/utils.ts:180`). Each one is stored in localStorage `userinfos`, with its token in `token` (`utils/utils.ts:198`).
  - `writeAccounts` (`utils/storage/settingOverlay.ts:121`) is the single writer. When the store refuses a write, the value is held in an in-memory overlay.
  - An account is keyed by `uid` = email + well-known URL (`utils/utils.ts:344`).
  - sessionStorage holds the current account's `uid` (`currentuser`). When a store refusal left the accounts in the overlay, it also holds them, tokens included, under `machloket.sessionAccounts` (`ACCOUNT_HANDOFF_KEY`, `utils/storage/settingOverlay.ts:3`), to hand them across full-page navigations. That is the task description's "session-only copy".
- **Requests:**
  - A `Localuser` builds one `headers` object, with `Authorization`, at `localuser.ts:403`. In `src/webpage` (git grep, tests excluded):
    - 142 call sites in 17 files pass a `headers` object;
    - 119 call sites go through `apiFetch` in 27 files;
    - 30 raw `fetch(` calls sit in 16 files;
    - `Authorization` appears in 11 files.
  - Pages outside `Localuser` take a raw token: oauth2 bot invites (`oauth2/botInvite.ts:55`, `:80`), invite acceptance (`utils/acceptInvite.ts:18`), template joining (`templatePage.ts:80`), logout (`utils/utils.ts:222`), and the 401 probe (`utils/apiFetch.ts:63`).
  - The login MFA steps build their own headers (`settings.ts:2318`, `:2432`), not the login form's.
  - Message sends use two XHRs (`channel.ts:4757`, and `:4808` for sends with attachments). `FormData` sends (stickers in `guild.ts`, attachments) must not get a JSON `Content-type`.
- **Credentials:**
  - A global `fetch` wrapper sets `credentials: "include"` for every host in a list (`utils/utils.ts:1083`). The list is filled only when stored accounts are read (`getBulkUsers`, `utils/utils.ts:47`); `adduser` does not add to it.
  - So a first login's fetch uses the default `same-origin`, and a cross-origin `Set-Cookie` would be dropped. Requests made after an in-app login, before the list is next rebuilt, would send no cookie either.
  - XHRs do not set `withCredentials`.
- **401 handling:**
  - `handleUnauthorized` engages only when the request carries `Authorization` (`utils/apiFetch.ts:24`, `:81`).
  - It probes `/users/@me` with that token, and `invalidateAccount` finds the account by token equality (`utils/utils.ts:429`).
  - A cookie request carries no token, so today a 401 on it would be ignored.
- **Gateway:** Resume sends `d.token` at `localuser.ts:693` and Identify at `localuser.ts:707`. A READY `auth_token` replaces the stored token (`localuser.ts:506`). Close code 4004 (authentication failed) is not in the retry set (`localuser.ts:129`), and `localuser.ts` has no `4004` handling (git grep), so by code-reading a dead credential at boot ends at "Unable to connect" (TASK-147; not runtime-confirmed).
- **Other tabs:** no `storage` event listener updates a live tab's accounts (git grep `addEventListener("storage"` in non-test `src/webpage`: none).
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
  | bot token                    | `localuser.ts:5366` (memory), `:5600` (persisted if an entry exists)   | memory; `perminfo.applications`      |

## Client design

### The account record

- **The record:** a `Specialuser` gains `auth_mode?: "cookie"`. A cookie account stores no `token`. The constructor's "missing pieces" check accepts that shape.
- **One cookie account per API host,** because the cookie is host-only.
  - The client opts in only when no stored, logged-in account on that API host is a cookie account. `invalidateAccount` and logout clear `auth_mode` along with `loggedin`, so a dead cookie account never blocks the next opt-in.
  - Server's "already holds a cookie for another user" rule is the backstop, not the plan.
- **When the cookie account logs out:** the other own-deployment accounts stay on header tokens. Converting one of them is the migration below, run at the next start; the user is never asked.

### One account-keyed request path

- **Credentials:** every authenticated request gets them from the account, never from a raw token.
  - **Header account:** `Authorization: <token>`.
  - **Cookie account:** no `Authorization`, plus `X-Machloket-CSRF: 1` on every request. Sending it on every method is simpler than sorting by method at 142 call sites, and the three CSRF-checked GETs require it too (contract, CSRF; the client calls one, `/auth/generate-registration-tokens`, at `localuser.ts:5241`). Compared with a header account, the marker adds no CORS preflight: `Authorization` is not a CORS-safelisted header either, so every cross-origin header-account request is preflighted already, and the marker takes its place. The 60 s preflight cache (answer 6) helps only repeated requests to the same URL, so distinct paths and queries (history pages, per-guild routes, uploads to different channels) each pay their own, as they do today.
- **One builder:** `Localuser.headers` becomes the output of that builder, mutated in place on migration or rotation so every holder of the object (`guild.headers`, interaction hosts) sees the change. The builder can leave out `Content-type` for `FormData` sends. The raw-token pages (bot invite, invite acceptance, template joining, logout, the 401 probe) take the account instead of its token.
- **Bots stay outside it:** `Bot` requests keep their raw bot token, and the 401 path never matches them to an account.
- **XHRs:** the two message-send XHRs set `withCredentials` for a cookie account.
- **Credentials ride the CSRF marker:** `credentials` is a `RequestInit` field, not a header, so `Localuser.headers` cannot carry it, and the 142 call sites pass only `headers`. The global wrapper therefore keys on the marker the builder already adds: any request that carries `X-Machloket-CSRF: 1` gets `credentials: "include"` (unless the caller set `credentials` itself), whatever its host. The marker alone decides, with no host condition, so a first login (no stored record yet) is covered. Only four kinds of request carry the marker, and each is sent only to a host whose discovery answered `authCookie: true`: the cookie account's builder output, the issuing requests (login, register, MFA steps, migration), the pending-logout retry, and the two cookie probes in 401 handling (the cookie account's, and the one a header account runs before it is marked logged out). No call site changes. Unlike today's host list, this also covers a first login and an in-app login (see The client today).
  - **Why no host condition (decided in unit 1, TASK-148):** `credentials: "include"` sends only the destination host's own cookies, so a marked request that reached some other host could not carry our API host's cookie. A host condition would protect nothing and would need the in-flight login's host threaded into the wrapper. Instead, a unit test pins that the builder emits the marker only for a cookie account.
- **The wrapper stops adding credentials for unmarked requests:** for a cookie-mode host, a request without the marker keeps `credentials` as the caller set it. A cookie-mode host is one whose discovery answered `"authCookie": true` (kept with the account's server record) or that has a pending logout. That does not depend on a cookie account being stored: after a removed cookie account's logout failed, the orphaned cookie is still in the browser while a header account on the same host keeps the host in the wrapper's list. Only marked requests send the cookie (see The ambient-cookie hazard).
  - **When the stored `authCookie` flag is refreshed:** from every discovery the client runs, namely the login's, the reconnect recovery's (`localuser.ts:877`–`899`) and the instance-URL refresh (`localuser.ts:5009`). A plain start runs no discovery today, so the migration check at start (unit 4) runs its own. A deployment that turns cookie mode on after a login migrates at the next start if the record's flag is unset, and at the start after that if the record says `false`: that start refreshes the flag behind it and doesn't wait (TASK-164, below). A stale `true` only withholds credentials from unmarked requests, which is the safe direction.
  - **Unit 1 ships the seam only:** the cookie-mode host set exists but stays empty until unit 3 fills it from discovery. Until then every unmarked request to a known API host keeps today's `credentials: "include"`, so header accounts behave exactly as before.

### The ambient-cookie hazard

Today's global wrapper (before this design) sends credentials to every known API host. If it stayed that way, once a cookie existed, any request to our API host would carry it, including a request made for a second, header-token account.

- **The hazard:** if that request lacks `Authorization` (a call site that forgot it), the server acts as the cookie account.
- **The guard:** the account-keyed builder makes "no `Authorization`" possible only for the cookie account. A unit test pins that a header account's request always carries its token.
- **Requests outside the builder:** today's 30 raw `fetch(` calls, pre-auth requests (discovery, a second account's login or register) and any future call site that skips the builder would still carry the cookie if the wrapper added it. Unsafe methods are stopped by the CSRF check, but GETs are not. So the wrapper adds credentials on a cookie-mode host only to requests carrying the CSRF marker (One account-keyed request path), and a unit test pins that a raw `fetch` to that host goes without them.

### Login, register and the MFA steps of login

- **When the client opts in:** only when the instance's discovery answer has `"authCookie": true` and no logged-in cookie account exists on that hostname. Cookies ignore the port, so the cookie slot is the hostname: two API ports on one hostname share one cookie. A login there first waits for a running retry of its pending logout. From the opt-in until the form's submit is over (an answer handled, a refusal, a dismissed captcha or second factor), it holds an exclusive Web Lock for the hostname, taken only if free and under the slot lock, which also re-checks for a cookie account stored meanwhile. A second cookie login on the hostname that finds the hold taken, in this tab or another, doesn't opt in and goes by token: the browser keeps one cookie per hostname, and two cookie logins' answers could land in either order. A retry that starts meanwhile, in another tab, finds it held and leaves its pending logout for a later start: the login's cookie may land before its account is stored, and a logout by cookie would end it. The retry asks for the hold before it reads the store, so a login that finished meanwhile is seen stored. The slot lock itself isn't held through the login, which can wait minutes on a second factor while another tab's start waits on that lock to migrate. The browser drops the hold with its page, so a closed tab never keeps it. Cookie login needs Web Locks: without them (an insecure context or a very old browser) none of these guards exist across tabs, so the client doesn't opt in and the login goes by token. A re-submit of the same form while its first submit waits on a second factor finds that submit's hold taken and goes by token too; the code prompt sets no focus trap, so Tab reaches the form behind it.
- **One cookie account per hostname:** storing a cookie login demotes any other logged-in cookie account on the hostname to logged out (its record stays, without `auth_mode`), because the browser's one cookie is the new session now; otherwise that record would send the new account's session as its own.
- **MFA steps:** the opt-in, CSRF header and `credentials: "include"` reach the second-factor calls too (`settings.ts:2318`, `:2432` build their own headers today), because a login answering `mfa: true` sets no cookie.
- **Response handling:** the login handler branches on `auth_mode`. It stores a cookie account, or a header account exactly as today.
- **Reset and email verify:** these send no opt-in, because the client does not consume their token.

### Rotations

- **Cookie account:** a rotation needs nothing from the client; the server re-sets the cookie.
- **Header account:** today the client drops the rotated token from TOTP enable and disable and from a password change. Whether it should store it is TASK-145 (see Found work).
- **The rule in every handler:** never write an absent `token` over a stored one.

### Gateway

- **Cookie account:** Identify and Resume send no `d.token`. The WebSocket upgrade carries the cookie on its own, because it is same-site.
- **Header account:** as today.
- **READY's `auth_token`:** still applies to header accounts only.
- **Close code 4004:** runs the account's verified 401 path (the probe, then logout to `/login` if dead) instead of ending at "Unable to connect". This applies to header accounts too.

### 401 handling

- **Keyed by account:** `handleUnauthorized` and `invalidateAccount` are keyed by account (`uid`), not by token. The builder records which account a request was built for, so `apiFetch` needs no header matching. A request built for no account (a bot's, a pre-auth one) never invalidates anything.
- **The cookie account's probe:** `GET /users/@me` with credentials and no `Authorization`. The existing guards stay: the pre-auth exemption, verifying before invalidating, and one latch per account (TASK-156: an account switch keeps the page, so the account switched to never waits behind the old one's probe, and a probe that outlives the switch routes nowhere).
- **A header account whose token died by migration:** before marking a header account on a cookie-mode host logged out, the client also probes by cookie. If that answers 200 for the same user id, the account was migrated (by another tab, or by a save that was refused), and the client converts the record to a cookie account instead of logging it out.
  - **As built (unit 4, TASK-150):** the cookie-mode check re-reads the store, since a tab started before cookie mode was on learns it only from the record another tab's start refreshed. The probe fails closed: no stored user id (READY stores it), another user's id, a cookie the server calls dead (401), or a JSON 200 without an id logs the account out as before; a probe without a verdict (no answer, a redirect, a cut-off or non-JSON body, a 429 or 5xx) leaves the account alone, as an unanswered token probe does. A later decision also wins over the conversion, read after the probe: a logout pending on the hostname (the cookie is to end), the account logged out, or a newer header login stored for it each leave the 401 path its usual outcome instead (invalidation, which spares the newer login). A conversion re-applies the live `Localuser.headers` in place, so the gateway's token goes too, and a gateway that had closed with 4004 reconnects instead of staying at "Unable to connect". The other tab's case takes that path: the server ends the old session's socket (op 9, close 4006), and its next Identify, with the dead token, gets 4004. A 4004 for a token the account no longer sends (a REST 401 converted it while the socket opened) reconnects at once: the 401 path would find the cookie alive and leave the gateway closed.
  - **Without Web Locks** this conversion still runs, unlocked: it only adopts a cookie that already answers for the same user, and no cookie session starts without the locks (login, register and migration all go by token there), so it is reachable only from cookie state made where they existed.

### Migrating existing sessions

- **When:** at start, for the current account, if it is a header account on a cookie-mode instance and that host has no cookie account yet.
- **The steps:**
  1. `POST /auth/session-cookie`.
  2. On 204, set `auth_mode`, remove `token`, and save through the existing `tryUpdateLocal` path. Its refusal semantics are pinned in `utils/accountSave.test.ts`: when only `localuserStore` overflows, its `saveFieldsQuietly` fallback still persists the change.
- **A save refused outright:** the stored record keeps the now-dead token, while the overlay holds the converted record for this session. At the next start, the dead token's 401 runs the cookie probe above, which converts the record.
- **Other tabs:** with no `storage` listener, an open tab keeps the old header token until it reloads. Its next request gets 401, and the cookie probe converts its record instead of logging the account out. A `storage` listener that would switch tabs live is not part of this design: the probe already covers the case, and a module-level listener cross-fires between concurrently running Vitest browser test files.
- **A repeated migration** by cookie is a no-op 204 (answer 4), so a retry is safe.
- **As built (unit 4, TASK-150):**
  - **Before the gateway:** the app's start awaits the migration before it builds the `Localuser`, because the exchange ends the header session and the server would drop a socket identified with it. The cost is one discovery (at most 5 s) on each start of a header account whose record's `authCookie` is unset or `true`, plus the exchange (at most 10 s) where it runs; any failure keeps the header account.
  - **A `false` flag doesn't wait (TASK-164, Lila 2026-11-26):** the start doesn't wait for that discovery, which only refreshes the stored flag in the background (`startCookieMigration`). The exchange never runs behind a live gateway, so an instance that turns cookie mode on migrates such an account one start later: its token stays in storage for one more session. The trade: no round trip on every start of an instance that offers no cookie sessions.
  - **Locking:** it waits for the host's pending-logout retry, then holds the slot's lock from the "no cookie account here" check through the exchange and the save. A 204 also drops the hostname's pending logouts and demotes any other cookie record there, in a second write. Without Web Locks it doesn't run: the account stays on its token, as a login there does.
  - **The exchange's own 401** (another tab already moved the session) is answered inline, by the cookie probe, never by the 401 path: its headers are untagged.

### Logout and removing an account

- **Cookie account logout:** logout of a cookie account sends credentials and the CSRF header.
- **A header account's logout** sends its `Authorization`, so the cookie account on the same host stays logged in (contract, Logout).
- **A failed logout:** if the logout of the host's cookie account fails and the user removes the account anyway, the client records a pending logout for that API host, in the same store write that removes the account. A header account's failed logout records none: a cookie retry would end the cookie account's session, not the header account's. The client retries that pending `POST /auth/logout` by cookie at the next start (answer 5), so a removed account's cookie does not linger. A 2xx or a 401 ends the pending logout (a 401 means the cookie was already dead, and the server cleared it); any other answer, a 403 included, keeps it for the next start, since the cookie may still be live. The retry reads the entry under the slot lock and clears it only if it is still the one it sent for. Without Web Locks it doesn't run and the entry stays: a cookie login out in another tab can't be seen, and its cookie may be the one the logout would end.
  - **Cleared first:** a pending logout is dropped when a new cookie login or a migration on that host succeeds first, so the retry never ends the new session. A retry that starts while a cookie login on the hostname is still out is held off by the login's hold (see Login, register and the MFA steps of login).
  - **No session stranded by the drop:** by the contract, a login over another user's valid cookie is answered with a token, so it never drops anything, and a login by the same user ends the old cookie's session as it replaces it. The cookie the pending logout was for is then gone either way. Not runtime-confirmed against the server.
  - **A header login over a live cookie record** (the same account answered with a token, the server having ignored the opt-in) records a pending logout for that host, at the replaced record's API base: no record holds that cookie any more. So does a cookie login of the same account on another hostname (the instance's API moved).
  - **Dropped at start, instead of retried,** when a stored, logged-in cookie account exists on that host: the cookie then belongs to that account. This check runs before the retry.
  - **Runs first:** at start, the pending logout runs before migration.
  - **Session-only store:** the pending logout is written like the accounts. When the store refuses the write, it rides the same session overlay, so a refused store gives a pending logout that lasts the session, not one that is lost silently.

### When the record and the cookie disagree

- **The record says cookie, but the cookie is gone** (cleared site data, expiry): HTTP requests get 401, and the gateway closes with 4004. Both run the 401 path, which marks the account logged out and clears its `auth_mode`. The user logs in again.
- **A cookie exists, but no record does** (the failed logout above): the pending logout covers the case the client knows about. Any other case is server-revocable. For `fetch` requests, the hazard guard and the wrapper rule (unmarked requests to cookie-mode hosts get no credentials) keep the client from acting through it. Other channels are covered under What this does and does not fix.

## What this does and does not fix

- **Fixes:** the own-deployment session token is no longer readable by page script. A script injection cannot copy it out of the browser, which a clear-text localStorage token allows today.
- **Does not fix:**
  - A script injection can still act through the open session while the page is open. The CSP from TASK-135 is the layer for that.
  - These still sit in localStorage as today: tokens of extra own-deployment accounts, other-instance accounts, and bots.
  - The wrapper rule governs `fetch` only. The browser still sends the cookie, whatever the client does, on a WebSocket upgrade, on `<img>` and media GETs, and on navigations to the API host. That is accepted: header accounts' Identify carries their own token, the cookie is read on API paths only, and the three CSRF-checked GETs need the CSRF header and an allowlisted Origin.
- **The CodeQL "clear-text storage" dismissals:** their wording stays Lila's call after this ships.

## Found work (TASK-145, TASK-146, TASK-147)

- **Rotated tokens are dropped:** TOTP enable and disable and the password change ignore the token they return. For a header session, per Server (from its code; recorded in TASK-145's notes), the caller's old session stays valid on all three, so the account is not logged out. Answer 3's second bullet covers cookie sessions, where a rotation replaces the old session. The cost is an unused live session left on the server per TOTP rotation. A password change ends every other session; whether its `newToken` also leaves a second live session is not known. None of this has been confirmed by a run; the real-server tier can.
- **Bot tokens are stored in clear text:** a reset bot token is persisted in `perminfo.applications` in localStorage when an entry exists there (`localuser.ts:5600`), and loaded from it (`:5370`). decision-9 keeps bots on header tokens, but whether they must be persisted is separate.
- **Gateway close 4004 ends at "Unable to connect"** (TASK-147): see The client today. It can land on its own before this design; its red-first test is the mock-e2e case "gateway close 4004 routes to `/login`" below.

## Tests

- **Unit (Vitest):**
  - the builder's output for each account mode;
  - a header account always sends its token;
  - the 401 path for a cookie account;
  - both login response shapes, including an opt-in the cookie-mode host ignored (a body `token`, no `auth_mode`);
  - migration: 204, a refused save, and a non-204;
  - a header account's 401 whose cookie probe answers 200 converts the record instead of logging out;
  - no handler writes an absent token;
  - no opt-in without `authCookie: true`, or when a logged-in cookie account exists on the hostname (any port), or while another cookie login on the hostname is out;
  - `FormData` sends get no JSON `Content-type`; the message-send XHRs set `withCredentials` for a cookie account;
  - each raw-token page builds through the account;
  - a bot request never invalidates an account;
  - an unmarked raw `fetch` to a cookie-mode host goes without credentials, including a host with a pending logout and only header accounts stored;
  - a cookie account's `apiFetch(url, {headers: this.headers})` and a raw `fetch` with its headers both go with credentials;
  - the pending-logout retry and both cookie probes send credentials and the CSRF header;
  - a first login's marked request to a host with no stored account goes with credentials;
  - pending logout: recorded only for the cookie account, never for a header account; retried at start; dropped by a newer cookie login or a logged-in cookie account on the hostname; kept on a 403; left alone while a cookie login on the hostname is out, and sent once a refused one's submit is over; run before migration.
  - a cookie login demotes another logged-in cookie account on the same hostname;
- **Mock e2e:**
  - the opt-in and CSRF headers on login, and on both MFA steps;
  - cookie-mode requests carry no `Authorization`, and send credentials right after an in-app login; the account's REST after login carries the CSRF header, and a header account's carries none;
  - a token-less Identify and Resume;
  - gateway close 4004 routes to `/login`.
- **Real-server tier** (once the server tasks land):
  - log in to a cookie session, then READY, then send a message;
  - migration;
  - logout;
  - a header-token second account on the same instance.

## Sequence

1. **The account-keyed request path and 401 handling.** A refactor with no behaviour change. It can land before any server work.
2. **TASK-145, rotated tokens for header accounts:** confirm the behaviour on the real-server tier, then decide.
3. **Cookie login, register and a token-less gateway, in one unit,** after the server's issuance, CSRF, CORS and gateway tasks and its `authCookie` discovery field. A cookie login without the token-less gateway could not connect. The pending logout lands here too, since a cookie login can fail to log out from this unit on.
4. **Migration,** after `POST /auth/session-cookie`.
5. **The real-server specs.**
