#!/bin/bash
set -euo pipefail

BUMP="${1:-patch}"

if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEW_VERSION="$BUMP"
else
  CURRENT=$(node -p "require('./package.json').version")
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  case "$BUMP" in
    major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
    minor) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    patch) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    *) echo "Usage: $0 [patch|minor|major|x.y.z]"; exit 1 ;;
  esac
fi

echo "Publishing v${NEW_VERSION}..."

# Update version in package.json and src/index.ts
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '${NEW_VERSION}';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
sed -i '' "s/^const VERSION = \".*\";$/const VERSION = \"${NEW_VERSION}\";/" src/index.ts

bun install --frozen-lockfile 2>/dev/null || true
bun run build

git add -A
git commit -m "v${NEW_VERSION}"
git tag "v${NEW_VERSION}"
git push origin main --tags

echo "Done. v${NEW_VERSION} released — Use github command to the rest."
