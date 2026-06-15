import type {
	BranchProtectionConfig,
	BranchProtectionEntry,
	RepoConfig,
	ResolvedRepoConfig,
	TeamAccess,
	TeamResourceMap,
	TeamsConfig,
} from "@/types";
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
		}),
		...(dismissalRestrictions.length ? { dismissalRestrictions } : {}),
	};

	return {
		enforceAdmins: config.enforceAdmins ?? true,
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
	const { defaults, teamAccess, labels, organization } = ctx;
	const { features } = defaults;

	// Branch protection comes only from explicit per-repo config; org rulesets
	// own branch enforcement. Keys are normalized so "main", "~DEFAULT_BRANCH",
	// and "refs/heads/main" collapse to a single pattern.
	const resolvedBranchProtection: Record<string, BranchProtectionEntry> =
		Object.fromEntries(
			Object.entries(repo.branchProtection ?? {}).map(([pattern, config]) => [
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
		labels: { ...labels, ...repo.labels },
		teams: teamAccess,
		resolvedBranchProtection,
		squashMergeCommitTitle: defaults.squashMergeCommitTitle,
		squashMergeCommitMessage: defaults.squashMergeCommitMessage,
		defaultBranch: defaults.defaultBranch,
		codeownersContent: ctx.codeownersContent,
	};
}
