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

	if (!autoInit) {
		// Empty repos have no git refs. Without the deprecated autocreateBranch
		// flag, the first CODEOWNERS commit only succeeds once a branch exists
		// (e.g. from a prior apply or manual bootstrap). Prefer autoInit: true.
		return new github.RepositoryFile(
			`${resourcePrefix}-codeowners`,
			fileInputs,
			baseOpts,
		);
	}

	const branch = new github.Branch(
		`${resourcePrefix}-codeowners-branch`,
		{
			repository: repo.name,
			branch: defaultBranch,
		},
		baseOpts,
	);

	return new github.RepositoryFile(
		`${resourcePrefix}-codeowners`,
		fileInputs,
		mergeOptions(baseOpts, { dependsOn: [branch] }),
	);
}
