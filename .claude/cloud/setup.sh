#!/usr/bin/env bash
# Cloud VM setup for machloket-client (TASK-383 S3 per-repo adoption), run once by
# .claude/cloud/step0.md. Drafted by Deck Platform 11-26 from deck-platform's landed
# setup (r1-r8); the Machloket Client session owns this file after adoption.
# Prints what the VM has, installs what the gate chain needs (npm ci, Playwright chromium
# + system deps), and writes an env file every later Bash call sources. Exit 0 = env file
# written; 1 = the env file could not be written (no env file); 2 = refused (the local
# host's hostname, or a path under the invoking user's home). Installs are best effort and reported, so the
# suite run shows what is still missing. As root, it also copies the repo to an
# unprivileged test user (CLOUD_TEST_USER, default cloudtest), runs `npm ci` there,
# installs the chromium browser into that user's cache, writes the user's env file
# ($CLOUD_ENV_FILE.user) and prints a "suite as <user>:" line (best effort).
# machloket-client needs no seyag clone: its gate chain (format:check, check, test, build,
# e2e) is self-contained. CI=1 keeps the Deck-local screenshot pins skipped (its
# CLAUDE.md), so the DOM asserts still run.
set -u
envf=${CLOUD_ENV_FILE:-/tmp/cloud-env.sh}
local_host=${CLOUD_SETUP_LOCAL_HOST:-steamdeck}   # tests set it to run the body on the Deck
case "$(uname -n)" in "$local_host") echo "cloud setup: refusing on the Deck ($(uname -n))" >&2; exit 2 ;; esac
for p in "$(pwd -P)" "$envf"; do   # a convenience guard against running on the Deck, not a boundary
  case "$p" in "$HOME"|"$HOME"/*) echo "cloud setup: refusing a path under HOME ($p)" >&2; exit 2 ;; esac
done

echo "== host"
uname -n; nproc; . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
echo "node: $(node --version 2>&1)"
echo "npm: $(npm --version 2>&1)"
for t in git chromium flock script timeout; do
  printf '%s: %s\n' "$t" "$(command -v "$t" || echo MISSING)"
done
case "$(node --version 2>&1)" in
  v1[89].*|v[2-9][0-9].*) ;;
  *) echo "node: VERSION PROBLEM (vite/vitest 5 need Node 18+); install Node 20+ and rerun" ;;
esac

echo "== installs (best effort)"
# command:package pairs the gate chain calls; playwright's own installer names its apt
# deps, so the system libraries come from `npx playwright install-deps` below, not here.
need=()
for t in git; do
  command -v "$t" >/dev/null || need+=("$t")
done
if [ ${#need[@]} -gt 0 ]; then
  sudo=; [ "$(id -u)" = 0 ] || sudo=sudo
  if command -v apt-get >/dev/null; then
    # apt's own error is kept and its last lines printed on failure (deck-platform r2's
    # update failed with no reason in the log). The update gets one retry.
    alog=$(mktemp) || alog=/dev/null
    apt_tail() { tail -n 3 "$alog" | cut -c1-200 | sed 's/^/  apt: /'; }
    wait_s=${CLOUD_APT_RETRY_SLEEP:-15}   # the probe sets 0
    for try in 1 2; do
      if timeout 120 $sudo apt-get update -qq >"$alog" 2>&1; then break; else rc=$?; fi
      if [ "$try" = 1 ]; then echo "apt-get update failed (status $rc), retrying in $wait_s s:"; apt_tail; sleep "$wait_s"
      else echo "apt-get update failed again (status $rc):"; apt_tail; fi
    done
    for p in "${need[@]}"; do
      if timeout 180 $sudo apt-get install -y -qq "$p" >"$alog" 2>&1; then echo "installed $p"
      else rc=$?; echo "install FAILED: $p (status $rc)"; apt_tail; fi
    done
    [ "$alog" = /dev/null ] || rm -f "$alog"
  else
    echo "no apt-get; still missing: ${need[*]}"
  fi
fi

tmp=$(mktemp "$envf.XXXXXX") || { echo "cloud setup: can't create a temp file beside $envf" >&2; exit 1; }
{ echo "# written by .claude/cloud/setup.sh; source before running repo tools"
  # Skips the Deck-local screenshot pins (pinShot baselines); the DOM asserts still run.
  echo 'export CI=1'
} > "$tmp" && mv -f "$tmp" "$envf" || { rm -f "$tmp"; echo "cloud setup: can't write $envf" >&2; exit 1; }
echo "user $(id -un) (uid $(id -u))"
echo "== env file $envf"; cat "$envf"

# Root ignores file modes, and Chromium refuses to run sandboxed browser tests as root.
# As root, copy the repo to an unprivileged user, install node_modules and the chromium
# browser there, and print the line that runs the suite as that user. Best effort: any
# failed step says so, and the suite still runs as root with the limits named in suite.md.
[ "$(id -u)" = 0 ] || exit 0
echo "== test user"
tuser=${CLOUD_TEST_USER:-cloudtest}
user_fail() { echo "test user FAILED: $1; run the suite as root (browser tiers will fail: Chromium cannot run as root without --no-sandbox)"; exit 0; }
id "$tuser" >/dev/null 2>&1 || useradd -m "$tuser" >/dev/null 2>&1 || user_fail "useradd $tuser"
thome=$(getent passwd "$tuser" | cut -d: -f6); [ -n "$thome" ] && [ -d "$thome" ] || user_fail "no home for $tuser"
twork="$thome/cloud"; trepo="$twork/repo"
# cp -a, not rsync: rsync is one of the installs that can fail (deck-platform r2). A re-run
# copies over the last copy; npm ci below rebuilds node_modules, so a stale one cannot survive.
src=$(pwd -P) && [ -n "$src" ] || user_fail "copy into $twork (no source dir)"
mkdir -p "$trepo" && cp -a -- "$src/." "$trepo/" || user_fail "copy into $trepo"
# docs/local/ is this repo's git-ignored machine-local state: session notes, dispatch
# artifacts, and the private tracker for withheld security work. It must not leave the
# machine; settings.local.json is machine-local too.
rm -rf -- "$trepo/docs/local" "$trepo/.claude/settings.local.json"
chown -R "$tuser:" "$twork" || user_fail "chown $twork"
# Ref hygiene before anything can commit or push in the copy. cp -a carried the whole .git:
# machine-local refs (embargo/*, pre-rebase backups, the session's working branch) and the
# linked-worktree checkouts under .claude/worktrees. The VM has no pre-push hook, so a local
# ref surviving here could ride a cloud-test/* push to GitHub (Machloket Client, 11-26).
# The suite flow cuts cloud-test/* from origin refs only (cloud-launch refuses a base not on
# an origin branch), so no local branch is wanted on the VM at all: drop the copied worktree
# dirs first (worktree prune releases only stale entries, not live-held branches), detach
# HEAD, then delete every local branch and refuse loudly if any survive.
rm -rf -- "$trepo/.claude/worktrees"
git -C "$trepo" worktree prune
git -C "$trepo" checkout -q --detach origin/main 2>/dev/null || git -C "$trepo" checkout -q --detach
git -C "$trepo" for-each-ref --format='%(refname:short)' refs/heads/ \
  | while read -r b; do git -C "$trepo" branch -D "$b" >/dev/null 2>&1; done
left=$(git -C "$trepo" for-each-ref --format='%(refname:short)' refs/heads/ | head -1)
[ -z "$left" ] || user_fail "local branches survived the VM-copy cleanup: $left"
if runuser -u "$tuser" -- bash -c "cd $(printf %q "$trepo") && npm ci --no-audit --no-fund" >/tmp/npm-ci.out 2>&1; then
  echo "npm ci ok ($(grep -c '^added' /tmp/npm-ci.out 2>/dev/null || echo '?') lines)"
else
  rc=$?; echo "npm ci FAILED (status $rc); tail:"; tail -n 5 /tmp/npm-ci.out 2>/dev/null | cut -c1-200 | sed 's/^/  npm: /'
  user_fail "npm ci"
fi
# Playwright's chromium: system libraries as root (its installer names the apt packages),
# then the browser binary into the test user's cache.
if npx playwright install-deps chromium >/tmp/pw-deps.out 2>&1; then
  echo "playwright system deps ok"
else
  rc=$?; echo "playwright install-deps FAILED (status $rc); tail:"
  tail -n 5 /tmp/pw-deps.out 2>/dev/null | cut -c1-200 | sed 's/^/  pw: /'
fi
if runuser -u "$tuser" -- bash -c "cd $(printf %q "$trepo") && npx playwright install chromium" >/tmp/pw-browser.out 2>&1; then
  echo "chromium browser ok"
else
  rc=$?; echo "chromium install FAILED (status $rc); tail:"
  tail -n 5 /tmp/pw-browser.out 2>/dev/null | cut -c1-200 | sed 's/^/  pw: /'
fi
uenv="$envf.user"
{ echo "# written by .claude/cloud/setup.sh for $tuser; source before running repo tools"
  echo 'export CI=1'
  # runuser keeps root's PATH; an entry this user can't search (under /root) turns a missing
  # command's ENOENT into EACCES (deck-platform r4). Keep only the entries it can search.
  echo '_p=; IFS=: read -ra _ds <<< "$PATH"; for _d in "${_ds[@]}"; do [ -n "$_d" ] && [ -x "$_d" ] && _p="${_p:+$_p:}$_d"; done; PATH=$_p; unset _p _d _ds'
} > "$uenv" && chmod 644 "$uenv" || user_fail "write $uenv"
GATE="npm run format:check && npm run check && npm test && npm run build && npm run check:e2e && npm run test:e2e"
printf 'suite as %s: runuser -u %q -- bash -c %q\n' "$tuser" "$tuser" "cd $(printf %q "$trepo") && . $(printf %q "$uenv") && $GATE"
