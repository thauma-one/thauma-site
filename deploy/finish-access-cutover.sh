#!/usr/bin/env bash
# finish-access-cutover.sh — put the production Access audience tag in place
#
#   bash deploy/finish-access-cutover.sh <AUD-TAG>
#
# Does the whole of Phase 5 step 2 after you have created the Access
# application in the dashboard: edits wrangler.toml, rebuilds the gated
# production site, deploys, and verifies.
#
# Safe to re-run. If the tag is already set it just rebuilds and redeploys.
#
# WHY THIS EXISTS RATHER THAN "edit wrangler.toml": the edit is four lines in
# the middle of a commented block, and getting it subtly wrong — pasting dev's
# tag, leaving a stray quote, putting it under the wrong section — fails in
# ways that look like something else entirely. The checks below are the ones
# worth having a machine do.
set -euo pipefail

cd "$(dirname "$0")/.."
TOML=wrangler.toml

# Tags that must NEVER appear here. Access sets CF_Authorization across the
# parent domain, so a dev or staging token would reach thauma.one and be
# accepted — the exact cross-application hole the aud check exists to close.
DEV_AUD=04468ad531e25f3c53af5d0b4ed0bdd3073241f76a070c741efe40f58019fdfb
NEXT_AUD=da1b6265b663e9152e863952d84ead73be8f8f8aa9b2ac90f50404ba707219f8

AUD="${1:-}"

if [ -z "$AUD" ]; then
  cat <<'USAGE'
usage: bash deploy/finish-access-cutover.sh <AUD-TAG>

Get the tag from the Zero Trust dashboard:
  Access -> Applications -> your new thauma.one app -> Overview
  -> "Application Audience (AUD) Tag"

It is 64 hexadecimal characters.
USAGE
  exit 1
fi

if ! printf '%s' "$AUD" | grep -qE '^[0-9a-f]{64}$'; then
  echo "ERROR: that does not look like an AUD tag." >&2
  echo "  Expected 64 lowercase hex characters, got ${#AUD}: $AUD" >&2
  echo "  Copy the 'Application Audience (AUD) Tag' from the app's Overview tab." >&2
  exit 1
fi

if [ "$AUD" = "$DEV_AUD" ]; then
  echo "ERROR: that is dev.thauma.one's tag, not production's." >&2
  echo "  Using it would let a dev login open thauma.one/staff/." >&2
  exit 1
fi
if [ "$AUD" = "$NEXT_AUD" ]; then
  echo "ERROR: that is next.thauma.one's tag, not production's." >&2
  exit 1
fi

echo "==> Setting ACCESS_AUD in [env.production.vars]"
python3 - "$TOML" "$AUD" <<'PY'
import re, sys, pathlib

path, aud = pathlib.Path(sys.argv[1]), sys.argv[2]
text = path.read_text()

# Operate ONLY inside [env.production.vars]: the file has three vars blocks and
# writing to the wrong one would point staging at production's audience.
start = text.index("[env.production.vars]")
end = len(text)
for m in re.finditer(r"^\[", text[start + 1:], re.M):
    end = start + 1 + m.start()
    break

block = text[start:end]

if re.search(r"^ACCESS_AUD\s*=", block, re.M):
    block = re.sub(r'^ACCESS_AUD\s*=.*$', f'ACCESS_AUD = "{aud}"', block, flags=re.M)
    action = "replaced the existing value"
else:
    # Drop the "deliberately absent" explanation — it is no longer true — and
    # put the tag directly after the team domain.
    block = re.sub(r"\n# ACCESS_AUD IS DELIBERATELY ABSENT.*?Phase 5\.\n", "\n", block, flags=re.S)
    block = block.replace(
        'ACCESS_TEAM_DOMAIN = "thaumaone.cloudflareaccess.com"',
        'ACCESS_TEAM_DOMAIN = "thaumaone.cloudflareaccess.com"\n'
        '# thauma.one\'s OWN Access application tag. Not dev\'s, not staging\'s:\n'
        '# Access sets CF_Authorization across the parent domain, so another\n'
        '# application\'s token would reach this host and be accepted.\n'
        f'ACCESS_AUD = "{aud}"', 1)
    action = "added it"

text = text[:start] + block + text[end:]
path.write_text(text)
print(f"    {action}")
PY

grep -A4 '^\[env.production.vars\]' "$TOML" | sed 's/^/    /'

echo "==> Building the gated production site"
rm -rf _site_prod
npx @11ty/eleventy --output=_site_prod --quiet
pages=$(find _site_prod -name '*.html' | wc -l)
echo "    $pages pages"

# The guard that matters. _site_prod must be the comingSoon-gated build; if an
# interior page is present, something set ELEVENTY_RUN_MODE and this deploy
# would publish the unreleased site.
if [ -f _site_prod/en/about/index.html ]; then
  echo "ERROR: _site_prod contains interior pages — this is NOT the gated build." >&2
  echo "  Refusing to deploy. Run the build again in a clean shell." >&2
  exit 1
fi
echo "    gated build confirmed (interior pages absent)"

echo "==> Deploying"
set -a; . "$HOME/.config/cloudflare-thauma.env"; set +a
npx wrangler deploy --env production 2>&1 | grep -E "Version ID|thauma.one/\*" | sed 's/^/    /'

echo "==> Verifying"
sleep 3
for probe in "staff https://thauma.one/staff/ 302" \
             "snapshot https://thauma.one/api/staff-snapshot 401" \
             "public https://thauma.one/en/ 200" \
             "www https://www.thauma.one/ 301"; do
  set -- $probe
  got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$2")
  if [ "$got" = "$3" ]; then
    printf '    ok   %-9s %s\n' "$1" "$got"
  else
    printf '    XX   %-9s got %s, expected %s\n' "$1" "$got" "$3"
  fi
done

cat <<'DONE'

Done. Load https://thauma.one/staff/ in a browser — you should get the Access
login, then the console.

The console will then say your address has no partner access. That is correct:
production's database has the schema and zero rows, so there is no
partner_users grant yet. Populating production is a separate decision.
DONE
