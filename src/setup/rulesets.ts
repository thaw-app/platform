import type {
	BranchProtectionConfig,
	RepoConfig,
	RulesetConfig,
} from "@/types";
import { globMatches, normalizeBranchPattern } from "./utils";

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
	const matches = (pattern: string) =>
		pattern === "~ALL" || globMatches(pattern, repoName);
	return cond.includes.some(matches) && !cond.excludes.some(matches);
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

/**
 * An org ruleset is one resource for every repo it covers, so it cannot carry
 * a repo's own check names, and it has no form of acceptAnyOf. Provisioning
 * either would leave those repos with no required checks and no error.
 * Surface every offender at once, before any resource is created.
 */
export function assertOrgRulesetsSupported(
	repos: RepoConfig[],
	rulesets: RulesetConfig[],
): void {
	const requiringChecks = rulesets.filter(
		(r) => r.enforcement !== "disabled" && r.rules.requiredStatusChecks.enabled,
	);
	const offenders = [
		...requiringChecks
			.filter((r) => !r.rules.requiredStatusChecks.requiredChecks?.length)
			.map((r) => `rulesets.${r.id}.rules.requiredStatusChecks.acceptAnyOf`),
		...repos
			.filter(
				(repo) =>
					repo.requiredStatusChecks?.length &&
					requiringChecks.some((r) => rulesetAppliesToRepo(r, repo.name)),
			)
			.map((repo) => `repos.${repo.name}.requiredStatusChecks`),
	];
	if (offenders.length > 0) {
		const lines = offenders.map((o) => `- ${o}`).join("\n");
		throw new Error(
			`enableRulesets is true, but org rulesets cannot enforce these status checks:\n${lines}`,
		);
	}
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
