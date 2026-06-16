#!/usr/bin/env bash
# Drop legacy *-bootstrap RepositoryFile resources from Pulumi state without
# deleting the README on GitHub. Required after removing bootstrap from code
# when branch protection already blocks direct API file deletes (409).
set -euo pipefail

stack="${PULUMI_STACK:-dev}"

resources=(
	"custom:github:OrgRepository\$github:index/repositoryFile:RepositoryFile::dot-github-bootstrap"
	"custom:github:OrgRepository\$github:index/repositoryFile:RepositoryFile::homebrew-tap-bootstrap"
	"custom:github:OrgRepository\$github:index/repositoryFile:RepositoryFile::org-ci-bootstrap"
	"custom:github:OrgRepository\$github:index/repositoryFile:RepositoryFile::website-bootstrap"
)

pulumi stack select "$stack"

for resource in "${resources[@]}"; do
	urn="urn:pulumi:${stack}::thaw-config::${resource}"
	if pulumi state delete "$urn" --yes 2>/dev/null; then
		echo "Removed from state: ${resource##*::}"
	else
		echo "Skipped (not in state): ${resource##*::}"
	fi
done

echo "Done. Re-run: pulumi preview"
