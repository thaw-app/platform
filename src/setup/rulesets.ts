import type {
	BranchProtectionConfig,
	RepoConfig,
	RulesetConfig,
} from "@/types";
import { compact, normalizeBranchPattern } from "./utils";

type RepoCondition = { includes: string[]; excludes: string[] };

function repoCondition(r: RulesetConfig): RepoCondition {
	return {
		includes: r.conditions.repositoryName?.includes ?? ["~ALL"],
		excludes: r.conditions.repositoryName?.excludes ?? [],
	};
}

export function rulesetAppliesToRepo(
	r: RulesetConfig,
	repoName: string,
): boolean {
	const cond = repoCondition(r);
	if (cond.excludes.includes(repoName)) return false;
	if (cond.includes.includes("~ALL") || cond.includes.includes(repoName))
		return true;
	return cond.includes.some((p) => p.includes("*"));
}

function rulesetStatusChecksForBootstrap(
	ruleset: RulesetConfig,
): string[] | undefined {
	const checks = ruleset.rules.requiredStatusChecks;
	if (!checks?.enabled) return undefined;
	if (checks.requiredChecks?.length) {
		return checks.requiredChecks.map((c) => c.context);
	}
	const pinned = checks.acceptAnyOf?.[0];
	return pinned ? [pinned] : undefined;
}

export function rulesetToBranchProtectionConfig(
	ruleset: RulesetConfig,
): BranchProtectionConfig {
	const { rules } = ruleset;
	const pr = rules.pullRequest;

	return compact({
		requiredReviewCount: pr.requiredApprovingReviewCount,
		dismissStaleReviews: pr.dismissStaleReviewsOnPush,
		requireCodeOwnerReviews: pr.requireCodeOwnerReview,
		requireLastPushApproval: pr.requireLastPushApproval,
		requireConversationResolution: pr.requiredReviewThreadResolution,
		requiredLinearHistory: rules.requiredLinearHistory,
		requireSignedCommits: rules.requiredSignatures,
		allowsDeletions: rules.deletion ? false : undefined,
		allowsForcePushes: rules.nonFastForward ? false : undefined,
		requiredStatusChecks: rulesetStatusChecksForBootstrap(ruleset),
		strictStatusChecks:
			rules.requiredStatusChecks?.strictRequiredStatusChecksPolicy,
	});
}

export function bootstrapBranchProtectionFromRulesets(
	repoName: string,
	rulesets: RulesetConfig[],
	defaultBranch: string,
): Record<string, BranchProtectionConfig> {
	const merged: Record<string, BranchProtectionConfig> = {};

	for (const ruleset of rulesets) {
		if (ruleset.target !== "branch" || ruleset.enforcement === "disabled") {
			continue;
		}
		if (!rulesetAppliesToRepo(ruleset, repoName)) continue;

		const config = rulesetToBranchProtectionConfig(ruleset);
		for (const rawPattern of ruleset.conditions.refName.includes) {
			const pattern = normalizeBranchPattern(rawPattern, defaultBranch);
			merged[pattern] = { ...merged[pattern], ...config };
		}
	}

	return merged;
}

export function mergeRepoBranchProtection(
	repo: RepoConfig,
	rulesets: RulesetConfig[],
	defaultBranch: string,
	bootstrapFromRulesets: boolean,
): Record<string, BranchProtectionConfig> {
	const bootstrapped = bootstrapFromRulesets
		? bootstrapBranchProtectionFromRulesets(repo.name, rulesets, defaultBranch)
		: {};

	const merged = { ...bootstrapped };
	for (const [pattern, config] of Object.entries(repo.branchProtection ?? {})) {
		const normalized = normalizeBranchPattern(pattern, defaultBranch);
		merged[normalized] = { ...merged[normalized], ...config };
	}

	return merged;
}
