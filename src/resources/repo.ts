import github from "@pulumi/github";
import {
	ComponentResource,
	type ComponentResourceOptions,
	mergeOptions,
} from "@pulumi/pulumi";
import type { ResolvedRepoConfig, TeamAccess, TeamResourceMap } from "@/types";
import { createBranchProtection } from "./branch";
import { createCodeowners } from "./codeowners";
import { createEnvironments } from "./environments";
import { createLabels } from "./labels";
import { createRepositoryRulesets } from "./rulesets";

type ActiveRepoContext = {
	resourcePrefix: string;
	repo: github.Repository;
	teams: TeamAccess[];
	resolvedRepoRulesets: ResolvedRepoConfig["resolvedRepoRulesets"];
	resolvedBranchProtection: ResolvedRepoConfig["resolvedBranchProtection"];
	environments: ResolvedRepoConfig["environments"];
	labels: ResolvedRepoConfig["labels"];
	defaultBranch: string;
	codeownersContent: string;
	teamResources: TeamResourceMap;
};

function provisionTeamAccess(
	parent: OrgRepository,
	ctx: ActiveRepoContext,
): void {
	if (ctx.teams.length === 0) return;

	const teamsComponent = new ComponentResource(
		"custom:github:OrgRepositoryTeams",
		`${ctx.resourcePrefix}-teams`,
		{},
		{ parent },
	);
	for (const { slug, teamId, permission } of ctx.teams) {
		new github.TeamRepository(
			`${ctx.resourcePrefix}-team-${slug}`,
			{ repository: ctx.repo.name, teamId, permission },
			{
				parent: teamsComponent,
				dependsOn: [ctx.repo],
				aliases: [{ parent }],
			},
		);
	}
}

function provisionRepositoryRulesets(
	parent: OrgRepository,
	ctx: ActiveRepoContext,
): void {
	if (ctx.resolvedRepoRulesets.length === 0) return;

	const rulesetsComponent = new ComponentResource(
		"custom:github:OrgRepositoryRulesets",
		`${ctx.resourcePrefix}-rulesets`,
		{},
		{ parent },
	);
	createRepositoryRulesets(
		ctx.resourcePrefix,
		ctx.repo,
		ctx.resolvedRepoRulesets,
		{
			parent: rulesetsComponent,
			aliases: [{ parent }],
		},
	);
}

function provisionBranchProtection(
	parent: OrgRepository,
	ctx: ActiveRepoContext,
): void {
	const bpEntries = Object.entries(ctx.resolvedBranchProtection);
	if (bpEntries.length === 0) return;

	const bpComponent = new ComponentResource(
		"custom:github:OrgRepositoryBranchProtection",
		`${ctx.resourcePrefix}-branch-protection`,
		{},
		{ parent },
	);
	for (const [pattern, protection] of bpEntries) {
		createBranchProtection(
			{
				resourceName: `${ctx.resourcePrefix}-bp-${pattern.replace(/[/*?[\]]/g, "-")}`,
				pattern,
				protection,
				repo: ctx.repo,
			},
			mergeOptions({ parent: bpComponent }, { aliases: [{ parent }] }),
		);
	}
}

function provisionActiveRepoResources(
	parent: OrgRepository,
	ctx: ActiveRepoContext,
): void {
	provisionTeamAccess(parent, ctx);
	provisionRepositoryRulesets(parent, ctx);
	provisionBranchProtection(parent, ctx);

	createEnvironments(
		{
			resourcePrefix: ctx.resourcePrefix,
			environments: ctx.environments ?? [],
			repo: ctx.repo,
			teamResources: ctx.teamResources,
		},
		{ parent },
	);

	if (ctx.labels && Object.keys(ctx.labels).length > 0) {
		createLabels(
			{
				resourcePrefix: ctx.resourcePrefix,
				labels: ctx.labels,
				repo: ctx.repo,
			},
			{ parent },
		);
	}

	createCodeowners(
		ctx.resourcePrefix,
		ctx.repo,
		ctx.defaultBranch,
		ctx.codeownersContent,
		{
			parent,
			dependsOn: [ctx.repo],
		},
	);
}

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
			resolvedRepoRulesets,
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
				...(adopt ? { import: githubName } : {}),
			},
		);

		if (!archived) {
			provisionActiveRepoResources(this, {
				resourcePrefix,
				repo,
				teams,
				resolvedRepoRulesets,
				resolvedBranchProtection,
				environments,
				labels,
				defaultBranch,
				codeownersContent,
				teamResources,
			});
		}

		this.registerOutputs();
	}
}
