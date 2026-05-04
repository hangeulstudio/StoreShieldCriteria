#!/usr/bin/env bash
# make-release.sh — manually create a GitHub release for the current manifest version.
# Usage: ./scripts/make-release.sh [version]
#        Version defaults to value in manifest.json
# Requires: gh (GitHub CLI), zip, jq

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-$(jq -r '.version' manifest.json)}"
TAG="v$VERSION"
CHANGELOG=$(jq -r '.changelog // "Criteria update"' manifest.json)

echo "→ Packaging criteria.zip for $TAG …"
mkdir -p dist
zip -j dist/criteria.zip sensitive_apis.yaml risky_frameworks.yaml risk_scoring.yaml
unzip -l dist/criteria.zip

echo "→ Verifying checksums …"
for f in sensitive_apis.yaml risky_frameworks.yaml risk_scoring.yaml; do
  expected=$(jq -r --arg f "$f" '.checksums[$f] // empty' manifest.json | sed 's/^sha256://')
  if [ -z "$expected" ]; then
    echo "  (no checksum for $f in manifest — skipping)"
    continue
  fi
  actual=$(shasum -a 256 "$f" | awk '{print $1}')
  if [ "$actual" != "$expected" ]; then
    echo "CHECKSUM MISMATCH for $f"
    echo "  expected: $expected"
    echo "  actual:   $actual"
    exit 1
  fi
  echo "  ✓ $f"
done

echo "→ Creating release $TAG …"
if gh release view "$TAG" > /dev/null 2>&1; then
  echo "Release $TAG already exists."
  echo "To upload asset only: gh release upload $TAG dist/criteria.zip"
else
  gh release create "$TAG" \
    --title "Criteria $VERSION" \
    --notes "$CHANGELOG" \
    dist/criteria.zip
  echo "✓ Release $TAG created and criteria.zip uploaded."
fi
