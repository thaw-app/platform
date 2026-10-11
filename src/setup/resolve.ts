import type {
	BranchProtectionConfig,
	BranchProtectionEntry,
	RepoConfig,
	ResolvedRepoConfig,
	TeamAccess,
	TeamResourceMap,
	TeamsConfig,
} from "@/types";
import {
	mergeRepoBranchProtection,
	rulesetsForRepo,
	withRepoStatusChecks,
} from "./rulesets";
import type { RepoBuildContext } from "./types";
import { compact, normalizeActors, normalizeBranchPattern } from "./utils";

// Branch protection
function toBranchProtectionEntry(
	config: BranchProtectionConfig,
	organization: string,
): BranchProtectionEntry {
	const dismissalRestrictions = normalizeActors(
		config.restrictDismissalsToTeams || [],
		organization,
	);

	const prReviewConfig = {
		...compact({
			requiredApprovingReviewCount: config.requiredReviewCount,
			dismissStaleReviews: config.dismissStaleReviews,
			requireCodeOwnerReviews: config.requireCodeOwnerReviews,
			requireLastPushApproval: config.requireLastPushApproval,
		}),
		...(dismissalRestrictions.length ? { dismissalRestrictions } : {}),
	};

	return {
		enforceAdmins: config.enforceAdmins ?? false,
		allowsDeletions: config.allowsDeletions,
		allowsForcePushes: config.allowsForcePushes,
		requireSignedCommits: config.requireSignedCommits,
		requiredLinearHistory: config.requiredLinearHistory,
		requireConversationResolution: config.requireConversationResolution,
		...(config.requiredStatusChecks?.length
			? {
					requiredStatusChecks: [
						{
							contexts: config.requiredStatusChecks,
							strict: config.strictStatusChecks,
						},
					],
				}
			: {}),
		...(Object.keys(prReviewConfig).length
			? { requiredPullRequestReviews: [prReviewConfig] }
			: {}),
	};
}

// Team access
export function resolveTeamAccess(
	repoName: string,
	repoAccess: TeamsConfig["repoAccess"],
	teamResources: TeamResourceMap,
): TeamAccess[] {
	return (repoAccess[repoName] ?? []).map(({ team, permission }) => {
		const resource = teamResources[team];
		if (!resource)
			throw new Error(`Team "${team}" in repoAccess["${repoName}"] not found`);
		return { slug: team, teamId: resource.id, permission };
	});
}

// Repo config
export function buildRepoConfig(
	repo: RepoConfig,
	ctx: RepoBuildContext,
): ResolvedRepoConfig {
	const {
		defaults,
		teamAccess,
		labels,
		organization,
		rulesets,
		provisionRepoRulesets,
	} = ctx;
	const { features, security } = defaults;

	const branchProtection = mergeRepoBranchProtection(
		repo,
		defaults.defaultBranch,
	);

	const resolvedBranchProtection: Record<string, BranchProtectionEntry> =
		Object.fromEntries(
			Object.entries(branchProtection).map(([pattern, config]) => [
				normalizeBranchPattern(pattern, defaults.defaultBranch),
				toBranchProtectionEntry(config, organization),
			]),
		);

	return {
		...repo,
		visibility: repo.visibility ?? defaults.visibility,
		mergeStrategies: repo.mergeStrategies ?? defaults.mergeStrategies,
		deleteBranchOnMerge:
			repo.deleteBranchOnMerge ?? defaults.deleteBranchOnMerge,
		hasIssues: repo.hasIssues ?? features.issues,
		hasWiki: repo.hasWiki ?? features.wiki,
		hasProjects: repo.hasProjects ?? features.projects,
		hasDiscussions: repo.hasDiscussions ?? features.discussions,
		security: { ...security, ...repo.security },
		labels: repo.bare
			? { ...(repo.labels ?? {}) }
			: { ...labels, ...repo.labels },
		teams: teamAccess,
		// rulesets.yaml alone decides which repos a ruleset is on. A bare repo
		// skips labels and CODEOWNERS but can still have rulesets.
		resolvedRepoRulesets: provisionRepoRulesets
			? rulesetsForRepo(repo.name, rulesets).map((r) =>
					withRepoStatusChecks(r, repo.requiredStatusChecks),
				)
			: [],
		resolvedBranchProtection,
		squashMergeCommitTitle: defaults.squashMergeCommitTitle,
		squashMergeCommitMessage: defaults.squashMergeCommitMessage,
		defaultBranch: defaults.defaultBranch,
		codeownersContent: repo.bare ? "" : ctx.codeownersContent,
		pulumiName: repo.pulumiName ?? repo.name,
		organization,
	};
}
