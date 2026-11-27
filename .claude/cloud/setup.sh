#!/usr/bin/env bash
# Cloud VM setup for machloket-client (TASK-383 S3 per-repo adoption), run once by
# .claude/cloud/step0.md. Drafted by Deck Platform 11-26 from deck-platform's landed
# setup (r1-r8); the Machloket Client session owns this file after adoption.
# Prints what the VM has, installs what the gate chain needs (npm ci, Playwright chromium
# + system deps), and writes an env file every later Bash call sources. Exit 0 = env file
# written; 1 = the env file could not be written (no env file); 2 = refused (the local
# host's hostname). Installs are best effort and reported, so the
# suite run shows what is still missing. As root, it also copies the repo to an
# unprivileged test user (CLOUD_TEST_USER, default cloudtest), runs `npm ci` there,
# installs the chromium browser as root into the image's browser dir (/opt/pw-browsers;
# a test-user install dies on EACCES there, run 1), writes the user's env file
# ($CLOUD_ENV_FILE.user) and prints "suite as <user>:" and "e2e as <user>:" lines (best effort).
# machloket-client needs no seyag clone: its gate chain (format:check, check, test, build,
# e2e) is self-contained. CI=1 keeps the Deck-local screenshot pins skipped (its
# CLAUDE.md), so the DOM asserts still run.
set -u
envf=${CLOUD_ENV_FILE:-/tmp/cloud-env.sh}
local_host=${CLOUD_SETUP_LOCAL_HOST:-steamdeck}   # set it to this machine's name to run the body elsewhere
case "$(uname -n)" in "$local_host") echo "cloud setup: refusing on the Deck ($(uname -n))" >&2; exit 2 ;; esac
# No path guard here: the VM session is root with the checkout under /home/user (dp-383-smoke),
# so nothing checkable at runtime names the Deck's home. The hostname check above and
# cloud-launch's own prompt guard (its Deck path is resolved launcher-side) carry that boundary.

echo "== host"
uname -n; nproc; . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
echo "node: $(node --version 2>&1)"
echo "npm: $(npm --version 2>&1)"
for t in git chromium flock script timeout; do
  printf '%s: %s\n' "$t" "$(command -v "$t" || echo MISSING)"
done
nv=$(node --version 2>&1); nvok=   # vite 8 floor: Node 20.19 (this repo's CI uses 24)
case $nv in v[0-9]*.[0-9]*)
  v=${nv#v}; maj=${v%%.*}; min=${v#*.}; min=${min%%.*}
  if [ "$maj" -gt 20 ] || { [ "$maj" -eq 20 ] && [ "$min" -ge 19 ]; }; then nvok=1; fi ;;
esac
[ "$nvok" = 1 ] || echo "node: VERSION PROBLEM ($nv; vite 8 needs 20.19+, this repo's CI uses 24); install Node 24 and rerun"

echo "== installs (best effort)"
# command:package pairs the gate chain calls; playwright's own installer names its apt
# deps, so the system libraries come from the copy's playwright install-deps below, not here.
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
    wait_s=${CLOUD_APT_RETRY_SLEEP:-15}   # set 0 to skip the retry wait
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
# As root, copy the repo to an unprivileged user, install node_modules there, install the
# chromium browser into the image's browser dir, and print the line that runs the suite as
# that user. Best effort: any failed step says so, and the suite still runs as root with
# the limits named in suite.md.
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
# The copy must be exactly the tree the launcher cut, carrying nothing machine-local. cp -a
# took the whole .git: machine-local refs (embargo/*, pre-rebase backups, the session's
# working branch) and the linked-worktree checkouts under .claude/worktrees. The copy never
# pushes anything (the suite only runs in it; pushes come from the session's own checkout, a
# fresh clone whose refs all came from origin), so this is state hygiene, not a leak guard:
# drop the copied worktree checkout dirs AND the copied .git/worktrees metadata (its gitdir
# files hold absolute paths into the SOURCE checkout, so a prune would never call the entries
# stale), detach HEAD IN PLACE — the suite tests the cut tree, not wherever origin/main sits —
# then delete every local branch and refuse loudly if any survive. All of this runs as root
# BEFORE the chown below: git refuses a repo owned by another uid (dubious ownership, 2.35.2+),
# and every git call here checks its rc so a refusal cannot pass as an empty-but-fine result.
rm -rf -- "$trepo/.claude/worktrees" "$trepo/.git/worktrees"
git -C "$trepo" checkout -q --detach || user_fail "detach HEAD in the copy"
git -C "$trepo" for-each-ref --format='%(refname:short)' refs/heads/ \
  | while read -r b; do git -C "$trepo" branch -D "$b" >/dev/null 2>&1; done
left=$(git -C "$trepo" for-each-ref --format='%(refname:short)' refs/heads/) || user_fail "list the copy's local branches"
[ -z "$left" ] || user_fail "local branches survived the VM-copy cleanup: $left"
treh=$(git -C "$trepo" rev-parse HEAD) || user_fail "read the copy's HEAD"
srch=$(git -C "$src" rev-parse HEAD) || user_fail "read the source checkout's HEAD"
[ "$treh" = "$srch" ] || { echo "test tree FAILED: copy is on $treh, source checkout on $srch; fix the copy or rerun setup before the suite"; exit 0; }
echo "test tree: $treh"
# Hand the copy to the test user only after the root-side git work above.
chown -R "$tuser:" "$twork" || user_fail "chown $twork"
ciout=$(mktemp) || user_fail "temp file for the npm ci log"
if runuser -u "$tuser" -- bash -c "cd $(printf %q "$trepo") && npm ci --no-audit --no-fund" >"$ciout" 2>&1; then
  echo "npm ci ok ($(grep -m1 '^added' "$ciout" 2>/dev/null || echo '?'))"
  rm -f "$ciout"
else
  rc=$?; echo "npm ci FAILED (status $rc); tail:"; tail -n 5 "$ciout" 2>/dev/null | cut -c1-200 | sed 's/^/  npm: /'
  echo "  npm: full log kept at $ciout"
  user_fail "npm ci"
fi
# Playwright's chromium: system libraries as root (its installer names the apt packages),
# then the browser binary, also as root (see the install below).
# The deps installer must be the LOCKED playwright from the copy's node_modules: npx in the
# source checkout (no node_modules yet) would fetch the latest release and run it as root.
depout=$(mktemp) || user_fail "temp file for the install-deps log"
if "$trepo/node_modules/.bin/playwright" install-deps chromium >"$depout" 2>&1; then
  echo "playwright system deps ok"
  rm -f "$depout"
else
  rc=$?; echo "playwright install-deps FAILED (status $rc); tail:"
  tail -n 5 "$depout" 2>/dev/null | cut -c1-200 | sed 's/^/  pw: /'; echo "  pw: full log kept at $depout"
fi
brout=$(mktemp) || user_fail "temp file for the chromium log"
# This image resolves playwright's browser dir to /opt/pw-browsers and keeps it root-owned
# (run 1: the test-user install died on EACCES mkdir /opt/pw-browsers/__dirlock, and the
# suites' launch errors named /opt/pw-browsers/chromium_headless_shell-*), so ROOT installs
# the LOCKED playwright's chromium there and the test user only reads+executes it. The var
# is set explicitly so the browser lands where the lookups go even if root's own env lacks
# it; ${PLAYWRIGHT_BROWSERS_PATH:-...} honours an inherited override.
if PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}" "$trepo/node_modules/.bin/playwright" install chromium >"$brout" 2>&1; then
  echo "chromium browser ok"
  rm -f "$brout"
else
  rc=$?; echo "chromium install FAILED (status $rc); tail:"
  tail -n 5 "$brout" 2>/dev/null | cut -c1-200 | sed 's/^/  pw: /'; echo "  pw: full log kept at $brout"
fi
uenv="$envf.user"
{ echo "# written by .claude/cloud/setup.sh for $tuser; source before running repo tools"
  echo 'export CI=1'
  # runuser keeps root's PATH; an entry this user can't search (under /root) turns a missing
  # command's ENOENT into EACCES (deck-platform r4). Keep only the entries it can search.
  echo '_p=; IFS=: read -ra _ds <<< "$PATH"; for _d in "${_ds[@]}"; do [ -n "$_d" ] && [ -x "$_d" ] && _p="${_p:+$_p:}$_d"; done; PATH=$_p; unset _p _d _ds'
} > "$uenv" && chmod 644 "$uenv" || user_fail "write $uenv"
GATE="npm run format:check && npm run check && npm test && npm run build"
E2E="npm run check:e2e && npm run test:e2e"
printf 'suite as %s: runuser -u %q -- bash -c %q\n' "$tuser" "$tuser" "cd $(printf %q "$trepo") && . $(printf %q "$uenv") && $GATE"
printf 'e2e as %s: runuser -u %q -- bash -c %q\n' "$tuser" "$tuser" "cd $(printf %q "$trepo") && . $(printf %q "$uenv") && $E2E"
