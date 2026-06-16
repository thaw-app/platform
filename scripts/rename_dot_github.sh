#!/usr/bin/env bash
# Rename thaw-app/dot-github to the org-level .github repository.
# Run once before the first pulumi up that uses name: .github in config/repos.yaml.
set -euo pipefail

org="${GITHUB_OWNER:-thaw-app}"
old_name="dot-github"
new_name=".github"

if gh repo view "${org}/${new_name}" >/dev/null 2>&1; then
	echo "${org}/${new_name} already exists — nothing to do."
	exit 0
fi

if ! gh repo view "${org}/${old_name}" >/dev/null 2>&1; then
	echo "::error::${org}/${old_name} not found. Create or import it first."
	exit 1
fi

gh api "repos/${org}/${old_name}" -X PATCH -f "name=${new_name}"
echo "Renamed ${org}/${old_name} → ${org}/${new_name}"
echo "Update local clones: git remote set-url origin https://github.com/${org}/${new_name}.git"
