#!/usr/bin/env python3
"""set-app-key.py — put a rotated GitHub App private key into .dev.vars

    python3 deploy/set-app-key.py /tmp/key-pkcs8.pem

WHY A SCRIPT AND NOT AN EDITOR. The value is a multi-line PEM inside a quoted
shell-style variable, and hand-editing it in nano is how you end up with a
stray newline, a lost closing quote, or half the old key still in the file —
none of which fail loudly. This replaces exactly one entry and leaves the rest
of the file byte-for-byte alone.

IT PRINTS NOTHING BUT A CONFIRMATION. The key never reaches the terminal, so
running it in a shared session or a transcript does not leak it.

FORMAT IS CHECKED FIRST. GitHub downloads PKCS#1 ("BEGIN RSA PRIVATE KEY");
WebCrypto in Workers imports PKCS#8 and nothing else, and its failure for the
wrong one is an opaque DOMException naming neither format. See pemToArrayBuffer
in workers/src/lib/github.js — this refuses early with the command to run.
"""
import re
import sys
from pathlib import Path

VAR = "GITHUB_APP_PRIVATE_KEY"


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <key-pkcs8.pem>", file=sys.stderr)
        return 2

    pem_path = Path(sys.argv[1])
    if not pem_path.is_file():
        print(f"no such file: {pem_path}", file=sys.stderr)
        return 2

    pem = pem_path.read_text().strip()

    if "BEGIN RSA PRIVATE KEY" in pem:
        print(
            "That is a PKCS#1 key, which Workers cannot import. Convert it first:\n"
            "  openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \\\n"
            f"    -in {pem_path} -out /tmp/key-pkcs8.pem",
            file=sys.stderr)
        return 1
    if "BEGIN PRIVATE KEY" not in pem:
        print("That does not look like a PEM private key.", file=sys.stderr)
        return 1

    env_path = Path(".dev.vars")
    if not env_path.is_file():
        print("no .dev.vars here — run this from the repository root", file=sys.stderr)
        return 2

    original = env_path.read_text()

    # The existing entry spans lines and ends at the closing quote, so the match
    # is anchored on that rather than on a newline.
    pattern = re.compile(rf'^{VAR}\s*=\s*"[^"]*"', re.MULTILINE | re.DOTALL)
    replacement = f'{VAR}="{pem}"'

    if pattern.search(original):
        updated = pattern.sub(lambda _m: replacement, original, count=1)
        what = "replaced"
    else:
        updated = original.rstrip("\n") + "\n" + replacement + "\n"
        what = "added"

    # Written alongside and moved into place, so an interrupted run cannot
    # leave .dev.vars truncated — losing the OTHER secrets in it would be a
    # worse afternoon than the one this is fixing.
    tmp = env_path.with_suffix(".dev.vars.tmp")
    tmp.write_text(updated)
    tmp.chmod(0o600)
    tmp.replace(env_path)

    print(f"{what} {VAR} in .dev.vars ({len(pem)} characters, not shown)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
