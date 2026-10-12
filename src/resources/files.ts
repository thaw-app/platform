import { createHash } from "node:crypto";
import github from "@pulumi/github";
import { mergeOptions, type ResourceOptions } from "@pulumi/pulumi";

interface SyncedFile {
	resourceName: string;
	repo: github.Repository;
	defaultBranch: string;
	file: string;
	content: string;
	commitMessage: string;
}

// Commits a file to the repo's default branch. Empty content means the repo
// does not have the file synced.
function createSyncedFile(
	{
		resourceName,
		repo,
		defaultBranch,
		file,
		content,
		commitMessage,
	}: SyncedFile,
	opts?: ResourceOptions,
): github.RepositoryFile | undefined {
	const trimmed = content.trim();
	if (!trimmed) return undefined;

	return new github.RepositoryFile(
		resourceName,
		{
			repository: repo.name,
			branch: defaultBranch,
			file,
			content: trimmed,
			commitMessage,
			overwriteOnCreate: true,
		},
		mergeOptions(opts, { dependsOn: [repo] }),
	);
}

export function createCodeowners(
	resourcePrefix: string,
	repo: github.Repository,
	defaultBranch: string,
	content: string,
	opts?: ResourceOptions,
): github.RepositoryFile | undefined {
	return createSyncedFile(
		{
			resourceName: `${resourcePrefix}-codeowners`,
			repo,
			defaultBranch,
			file: ".github/CODEOWNERS",
			content,
			commitMessage: "chore: sync CODEOWNERS from org config",
		},
		opts,
	);
}

const DEPENDABOT_FILE = ".github/dependabot.yml";
const DEPENDABOT_MESSAGE = "chore: sync dependabot.yml from org config";

// Whether the repo's default branch already holds this content. The provider
// reads a missing file as empty, which does not match. Any other failure
// stops the run: answering "no" to it would open a pull request that offers
// what the branch already has.
export async function defaultBranchHasDependabot(
	repository: string,
	defaultBranch: string,
	content: string,
): Promise<boolean> {
	const current = await github.getRepositoryFile({
		repository,
		branch: defaultBranch,
		file: DEPENDABOT_FILE,
	});
	return (current.content ?? "").trim() === content.trim();
}

// For a default branch that refuses direct commits: the file goes on a branch
// of its own and a pull request offers it. The branch is named after the
// content, so a later change opens a new pull request and leaves a merged one
// alone. Nothing here is deleted when it leaves the program: GitHub removes a
// merged branch itself, and a merged pull request cannot be closed.
function createDependabotPullRequest(
	resourcePrefix: string,
	repo: github.Repository,
	defaultBranch: string,
	content: string,
	opts?: ResourceOptions,
): github.RepositoryPullRequest {
	const version = createHash("sha256")
		.update(content)
		.digest("hex")
		.slice(0, 8);
	const headRef = `platform/dependabot-${version}`;
	const kept = mergeOptions(opts, { retainOnDelete: true });

	const branch = new github.Branch(
		`${resourcePrefix}-dependabot-branch-${version}`,
		{ repository: repo.name, branch: headRef, sourceBranch: defaultBranch },
		mergeOptions(kept, { dependsOn: [repo] }),
	);
	const file = new github.RepositoryFile(
		`${resourcePrefix}-dependabot-${version}`,
		{
			repository: repo.name,
			branch: headRef,
			file: DEPENDABOT_FILE,
			content,
			commitMessage: DEPENDABOT_MESSAGE,
			overwriteOnCreate: true,
		},
		mergeOptions(kept, { dependsOn: [branch] }),
	);
	return new github.RepositoryPullRequest(
		`${resourcePrefix}-dependabot-pr-${version}`,
		{
			baseRepository: repo.name,
			baseRef: defaultBranch,
			headRef,
			title: DEPENDABOT_MESSAGE,
			body: "Written by thaw-app/platform from `config/repos.yaml` and `defaults.dependabot` in `config/org.yaml`. This branch takes changes by pull request only, so the file is offered here and not committed.",
		},
		mergeOptions(kept, { dependsOn: [file] }),
	);
}

export function createDependabot(
	resourcePrefix: string,
	repo: github.Repository,
	defaultBranch: string,
	content: string,
	byPullRequest: boolean,
	opts?: ResourceOptions,
): github.RepositoryFile | github.RepositoryPullRequest | undefined {
	if (byPullRequest) {
		const trimmed = content.trim();
		return trimmed
			? createDependabotPullRequest(
					resourcePrefix,
					repo,
					defaultBranch,
					trimmed,
					opts,
				)
			: undefined;
	}

	return createSyncedFile(
		{
			resourceName: `${resourcePrefix}-dependabot`,
			repo,
			defaultBranch,
			file: DEPENDABOT_FILE,
			content,
			commitMessage: DEPENDABOT_MESSAGE,
		},
		// A repo that stops listing ecosystems keeps the file it has.
		mergeOptions(opts, { retainOnDelete: true }),
	);
}
