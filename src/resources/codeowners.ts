import github from "@pulumi/github";
import { mergeOptions, type ResourceOptions } from "@pulumi/pulumi";

const fileArgs = (
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
	const fileInputs = fileArgs(repo, defaultBranch, trimmed);

	if (autoInit) {
		// github.Branch requires an existing commit (409 on empty repos). autoInit on
		// the Repository only applies at creation time — for already-empty repos,
		// autocreateBranch on the first file seeds the default branch.
		return new github.RepositoryFile(
			`${resourcePrefix}-codeowners`,
			{
				...fileInputs,
				autocreateBranch: true,
				autocreateBranchSourceBranch: defaultBranch,
			},
			baseOpts,
		);
	}

	// Non-init repos must already have a default branch (manual bootstrap).
	return new github.RepositoryFile(
		`${resourcePrefix}-codeowners`,
		fileInputs,
		baseOpts,
	);
}
