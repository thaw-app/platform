import type {
	BranchProtectionConfig,
	RepoConfig,
	RulesetConfig,
} from "@/types";
import { normalizeBranchPattern } from "./utils";

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

export function rulesetsForRepo(
	repoName: string,
	rulesets: RulesetConfig[],
): RulesetConfig[] {
	return rulesets.filter(
		(r) => r.enforcement !== "disabled" && rulesetAppliesToRepo(r, repoName),
	);
}

// The ruleset as it applies to one repo. When the ruleset requires status
// checks and the repo names its own, those replace the ruleset's.
export function withRepoStatusChecks(
	ruleset: RulesetConfig,
	contexts: string[] | undefined,
): RulesetConfig {
	const checks = ruleset.rules.requiredStatusChecks;
	if (!checks.enabled || !contexts?.length) return ruleset;

	const { acceptAnyOf: _replaced, ...rest } = checks;
	return {
		...ruleset,
		rules: {
			...ruleset.rules,
			requiredStatusChecks: {
				...rest,
				requiredChecks: contexts.map((context) => ({ context })),
			},
		},
	};
}

export function mergeRepoBranchProtection(
	repo: RepoConfig,
	defaultBranch: string,
): Record<string, BranchProtectionConfig> {
	const merged: Record<string, BranchProtectionConfig> = {};
	for (const [pattern, config] of Object.entries(repo.branchProtection ?? {})) {
		merged[normalizeBranchPattern(pattern, defaultBranch)] = config;
	}
	return merged;
}
