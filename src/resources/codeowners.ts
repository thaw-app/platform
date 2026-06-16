import github from "@pulumi/github";
import { mergeOptions, type ResourceOptions } from "@pulumi/pulumi";

const codeownersFileArgs = (
	repo: github.Repository,
	defaultBranch: string,
	content: string,
) => ({
	repository: repo.name,
	branch: defaultBranch,
	file: ".github/CODEOWNERS",
	content,
	commitMessage: "chore: sync CODEOWNERS from org config",
	overwriteOnCreate: true,
});

/** Seeds the default branch on repos that exist but have no commits yet. */
function bootstrapDefaultBranch(
	resourcePrefix: string,
	repo: github.Repository,
	defaultBranch: string,
	opts: ResourceOptions,
): github.RepositoryFile {
	return new github.RepositoryFile(
		`${resourcePrefix}-bootstrap`,
		{
			repository: repo.name,
			file: "README.md",
			content: `# ${resourcePrefix}\n\nManaged by [platform](https://github.com/thaw-app/platform).\n`,
			commitMessage: "chore: bootstrap default branch",
			overwriteOnCreate: true,
			autocreateBranch: true,
			autocreateBranchSourceBranch: defaultBranch,
		},
		opts,
	);
}

export function createCodeowners(
	resourcePrefix: string,
	repo: github.Repository,
	defaultBranch: string,
	content: string,
	autoInit: boolean,
	opts?: ResourceOptions,
): github.RepositoryFile | undefined {
	const trimmed = content.trim();
	if (!trimmed) return undefined;

	const baseOpts = mergeOptions(opts, { dependsOn: [repo] });

	if (autoInit) {
		// Repository.autoInit only runs at create time. For already-empty repos,
		// bootstrap README first (autocreateBranch), then CODEOWNERS on that branch.
		const bootstrap = bootstrapDefaultBranch(
			resourcePrefix,
			repo,
			defaultBranch,
			baseOpts,
		);

		return new github.RepositoryFile(
			`${resourcePrefix}-codeowners`,
			codeownersFileArgs(repo, defaultBranch, trimmed),
			mergeOptions(baseOpts, { dependsOn: [bootstrap] }),
		);
	}

	// Non-init repos must already have a default branch (manual bootstrap).
	return new github.RepositoryFile(
		`${resourcePrefix}-codeowners`,
		codeownersFileArgs(repo, defaultBranch, trimmed),
		baseOpts,
	);
}
