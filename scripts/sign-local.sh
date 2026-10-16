#!/usr/bin/env bash
# Signs a local Pensée build with the same identity every time.
#
# macOS remembers privacy answers ("access data from other apps", Documents
# folder, ...) per signing identity. An ad-hoc signature is a hash of the build,
# so every rebuild looked like a new app and asked again. A self-signed
# certificate gives every build the same designated requirement
# (identifier + certificate leaf), so an Allow given once sticks.
#
# Each Mac makes its own identity on first use, in a private folder under the
# user's Library: a keychain holding the key, and its random password (mode
# 600). Nothing secret is in the repo or in the app; a signed app carries only
# the public certificate. The login keychain and trust settings are never
# touched. The keychain joins the search list only while codesign runs
# (codesign can't find it otherwise).
#
# Usage: sign-local.sh <path/to/App.app>
# PENSEE_SIGN_IDENTITY overrides the identity (e.g. a Developer ID).
set -euo pipefail

APP="${1:?usage: sign-local.sh <path/to/App.app>}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENTITLEMENTS="$ROOT_DIR/apps/desktop/src-tauri/Entitlements.plist"
IDENTITY_NAME="Pensee Local Signing"
STORE="$HOME/Library/Application Support/Pensee Local Signing"
KEYCHAIN="$STORE/signing.keychain-db"
PASSWORD_FILE="$STORE/keychain-password"

sign() {
  codesign --force --deep --options runtime \
    --entitlements "$ENTITLEMENTS" --sign "$1" "$APP"
}

if [ -n "${PENSEE_SIGN_IDENTITY:-}" ]; then
  sign "$PENSEE_SIGN_IDENTITY"
  exit 0
fi

if [ ! -f "$KEYCHAIN" ]; then
  echo "[sign-local] creating this Mac's signing identity (once) in $STORE"
  mkdir -p "$STORE"
  chmod 700 "$STORE"
  (umask 077 && openssl rand -hex 32 >"$PASSWORD_FILE")
  KEYCHAIN_PASSWORD="$(cat "$PASSWORD_FILE")"
  TMP="$(mktemp -d)"
  cat >"$TMP/cert.cnf" <<EOF
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=$IDENTITY_NAME
[ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
EOF
  openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -config "$TMP/cert.cnf" \
    -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
  security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
  security set-keychain-settings "$KEYCHAIN" # no auto-lock timeout
  security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
  security import "$TMP/key.pem" -k "$KEYCHAIN" -T /usr/bin/codesign >/dev/null
  security import "$TMP/cert.pem" -k "$KEYCHAIN" >/dev/null
  rm -rf "$TMP"
  # Lets codesign use the key without a keychain prompt.
  security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
fi

security unlock-keychain -p "$(cat "$PASSWORD_FILE")" "$KEYCHAIN"

ORIGINAL_LIST=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line#\"}"
  ORIGINAL_LIST+=("${line%\"}")
done < <(security list-keychains -d user)

restore_list() { security list-keychains -d user -s "${ORIGINAL_LIST[@]}"; }
trap restore_list EXIT
security list-keychains -d user -s "${ORIGINAL_LIST[@]}" "$KEYCHAIN"

sign "$IDENTITY_NAME"
