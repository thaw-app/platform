import github from "@pulumi/github";
import {
	ComponentResource,
	type ComponentResourceOptions,
	mergeOptions,
} from "@pulumi/pulumi";
import type { ResolvedRepoConfig, TeamResourceMap } from "@/types";
import { createBranchProtection } from "./branch";
import { createCodeowners } from "./codeowners";
import { createEnvironments } from "./environments";
import { createLabels } from "./labels";

export default class OrgRepository extends ComponentResource {
	constructor(
		resourcePrefix: string,
		config: ResolvedRepoConfig,
		teamResources: TeamResourceMap,
		opts?: ComponentResourceOptions,
	) {
		super("custom:github:OrgRepository", resourcePrefix, {}, opts);

		const {
			name: githubName,
			organization,
			adopt,
			description,
			visibility,
			topics,
			homepage,
			mergeStrategies,
			deleteBranchOnMerge,
			hasIssues,
			hasWiki,
			hasProjects,
			hasDiscussions,
			autoInit,
			archived,
			teams,
			resolvedBranchProtection,
			environments,
			labels,
			squashMergeCommitTitle,
			squashMergeCommitMessage,
			defaultBranch,
			codeownersContent,
		} = config;

		const allowSquashMerge = mergeStrategies.includes("squash");

		const repo = new github.Repository(
			resourcePrefix,
			{
				name: githubName,
				description,
				visibility,
				deleteBranchOnMerge,
				hasIssues,
				hasWiki,
				hasProjects,
				hasDiscussions,
				autoInit,
				archived,
				topics: topics ?? [],
				homepageUrl: homepage,
				allowMergeCommit: mergeStrategies.includes("merge"),
				allowRebaseMerge: mergeStrategies.includes("rebase"),
				allowSquashMerge,
				...(allowSquashMerge && {
					squashMergeCommitTitle,
					squashMergeCommitMessage,
				}),
			},
			{
				parent: this,
				...(adopt ? { import: `${organization}/${githubName}` } : {}),
			},
		);

		if (!archived) {
			if (teams.length > 0) {
				const teamsComponent = new ComponentResource(
					"custom:github:OrgRepositoryTeams",
					`${resourcePrefix}-teams`,
					{},
					{ parent: this },
				);
				for (const { slug, teamId, permission } of teams) {
					new github.TeamRepository(
						`${resourcePrefix}-team-${slug}`,
						{ repository: repo.name, teamId, permission },
						{
							parent: teamsComponent,
							dependsOn: [repo],
							aliases: [{ parent: this }],
						},
					);
				}
			}

			const bpEntries = Object.entries(resolvedBranchProtection);
			if (bpEntries.length > 0) {
				const bpComponent = new ComponentResource(
					"custom:github:OrgRepositoryBranchProtection",
					`${resourcePrefix}-branch-protection`,
					{},
					{ parent: this },
				);
				for (const [pattern, protection] of bpEntries) {
					createBranchProtection(
						{
							resourceName: `${resourcePrefix}-bp-${pattern.replace(/[/*?[\]]/g, "-")}`,
							pattern,
							protection,
							repo,
						},
						mergeOptions(
							{ parent: bpComponent },
							{ aliases: [{ parent: this }] },
						),
					);
				}
			}

			createEnvironments(
				{
					resourcePrefix,
					environments: environments ?? [],
					repo,
					teamResources,
				},
				{ parent: this },
			);

			if (labels && Object.keys(labels).length > 0) {
				createLabels({ resourcePrefix, labels, repo }, { parent: this });
			}

			createCodeowners(resourcePrefix, repo, defaultBranch, codeownersContent, {
				parent: this,
				dependsOn: [repo],
			});
		}

		this.registerOutputs();
	}
}
