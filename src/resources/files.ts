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

export function createDependabot(
	resourcePrefix: string,
	repo: github.Repository,
	defaultBranch: string,
	content: string,
	opts?: ResourceOptions,
): github.RepositoryFile | undefined {
	return createSyncedFile(
		{
			resourceName: `${resourcePrefix}-dependabot`,
			repo,
			defaultBranch,
			file: ".github/dependabot.yml",
			content,
			commitMessage: "chore: sync dependabot.yml from org config",
		},
		// A repo that stops listing ecosystems keeps the file it has.
		mergeOptions(opts, { retainOnDelete: true }),
	);
}
