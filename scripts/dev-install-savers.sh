#!/usr/bin/env bash
# Dev-only: installs the savers saver-audit replays, plus ccusage for cross-checks,
# into ONE folder so they can be removed with `rm -rf "$SAVER_AUDIT_TOOLS"`.
# Nothing here runs a saver's own init/setup, so no Claude Code or Codex hooks or
# settings are touched. Telemetry is switched off for every step.
#   bash scripts/dev-install-savers.sh            # default: ~/.saver-audit-tools
set -euo pipefail

T="${SAVER_AUDIT_TOOLS:-$HOME/.saver-audit-tools}"
RTK_VERSION="v0.50.0"
CAVEMAN_BIN_RELEASE="bin-v1.1.7"    # engine binaries shipped with caveman v2.7.0
HEADROOM_VERSION="0.38.0"
CCUSAGE_VERSION="${CCUSAGE_VERSION:-latest}"
export DO_NOT_TRACK=1 HEADROOM_BEACON=off HF_HOME="$T/hf" CAVEMAN_HOME="$T/caveman-home"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) RTK_ASSET=rtk-aarch64-apple-darwin.tar.gz; CAVE_ASSET=caveman-engine_darwin_arm64 ;;
  Darwin-x86_64) RTK_ASSET=rtk-x86_64-apple-darwin.tar.gz; CAVE_ASSET=caveman-engine_darwin_amd64 ;;
  Linux-aarch64) RTK_ASSET=rtk-aarch64-unknown-linux-gnu.tar.gz; CAVE_ASSET=caveman-engine_linux_arm64 ;;
  Linux-x86_64) RTK_ASSET=rtk-x86_64-unknown-linux-musl.tar.gz; CAVE_ASSET="" ;;
  *) echo "unsupported platform" >&2; exit 1 ;;
esac

mkdir -p "$T/bin" "$T/dl" "$HF_HOME" "$CAVEMAN_HOME"
cd "$T/dl"

sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }

echo "== rtk $RTK_VERSION"
gh release download "$RTK_VERSION" -R rtk-ai/rtk -p "$RTK_ASSET" -p checksums.txt --clobber
want=$(grep " $RTK_ASSET\$" checksums.txt | cut -d' ' -f1)
[ -n "$want" ] && [ "$(sha256 "$RTK_ASSET")" = "$want" ] || { echo "rtk checksum mismatch" >&2; exit 1; }
tar -xzf "$RTK_ASSET" -C "$T/bin" rtk
mv checksums.txt rtk-checksums.txt

if [ -n "$CAVE_ASSET" ]; then
  echo "== caveman-engine ($CAVEMAN_BIN_RELEASE, BSL-1.1: local use only, never redistributed)"
  gh release download "$CAVEMAN_BIN_RELEASE" -R JuliusBrussee/caveman -p "$CAVE_ASSET" -p checksums.txt -p checksums.txt.keysig --clobber
  # Same check as caveman's own installer: sigstore bundle over checksums.txt, then SHA-256.
  gh api "repos/JuliusBrussee/caveman/contents/packages/cli/BINARY_SIGNING_PUBKEY.pub?ref=v2.7.0" --jq .content | base64 -d > caveman-pubkey.pem
  node -e '
    const { readFileSync } = require("fs"); const { createHash, createPublicKey, verify } = require("crypto");
    const sums = readFileSync("checksums.txt"); const b = JSON.parse(readFileSync("checksums.txt.keysig", "utf8"));
    const ok = b.messageSignature.messageDigest.algorithm === "SHA2_256"
      && createHash("sha256").update(sums).digest().equals(Buffer.from(b.messageSignature.messageDigest.digest, "base64"))
      && verify("sha256", sums, createPublicKey(readFileSync("caveman-pubkey.pem")), Buffer.from(b.messageSignature.signature, "base64"));
    if (!ok) { console.error("caveman checksums signature INVALID"); process.exit(1); }
    console.log("caveman checksums signature OK");'
  want=$(grep -E "[ *]$CAVE_ASSET\$" checksums.txt | cut -d' ' -f1)
  [ -n "$want" ] && [ "$(sha256 "$CAVE_ASSET")" = "$want" ] || { echo "caveman-engine checksum mismatch" >&2; exit 1; }
  install -m 0755 "$CAVE_ASSET" "$T/bin/caveman-engine"
  mv checksums.txt caveman-checksums.txt
fi

echo "== headroom-ai[ml] $HEADROOM_VERSION (own virtualenv)"
python3 -m venv "$T/headroom-venv"
"$T/headroom-venv/bin/pip" install --quiet --disable-pip-version-check "headroom-ai[ml]==$HEADROOM_VERSION"

echo "== ccusage $CCUSAGE_VERSION (own npm prefix)"
npm install --silent --no-fund --no-audit --prefix "$T/npm" "ccusage@$CCUSAGE_VERSION"
ln -sf "$T/npm/node_modules/.bin/ccusage" "$T/bin/ccusage"

cat > "$T/README.txt" <<EOF
Tools installed by saver-audit/scripts/dev-install-savers.sh on $(date -u +%Y-%m-%d).
rtk $RTK_VERSION, caveman-engine $CAVEMAN_BIN_RELEASE, headroom-ai $HEADROOM_VERSION, ccusage.
No hooks or agent settings were changed. Remove everything with:
  rm -rf "$T"
EOF
echo "done: $T  (remove with: rm -rf \"$T\")"
