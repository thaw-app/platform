import github from "@pulumi/github";
import { mergeOptions, type ResourceOptions } from "@pulumi/pulumi";

export function createCodeowners(
	resourcePrefix: string,
	repo: github.Repository,
	defaultBranch: string,
	content: string,
	opts?: ResourceOptions,
): github.RepositoryFile | undefined {
	const trimmed = content.trim();
	if (!trimmed) return undefined;

	return new github.RepositoryFile(
		`${resourcePrefix}-codeowners`,
		{
			repository: repo.name,
			branch: defaultBranch,
			file: ".github/CODEOWNERS",
			content: trimmed,
			commitMessage: "chore: sync CODEOWNERS from org config",
			overwriteOnCreate: true,
		},
		mergeOptions(opts, { dependsOn: [repo] }),
	);
}
