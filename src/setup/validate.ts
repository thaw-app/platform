import { groupBy, uniq } from "es-toolkit";
import type {
	InfraConfig,
	LabelGroups,
	MembersFileInput,
	RulesetConfig,
	TeamsFile,
} from "@/types";
import { rulesetAppliesToRepo } from "./rulesets";
import type { ValidationIssue } from "./types";
import { issue, normalizeBranchPattern } from "./utils";

const compareStrings = (a: string, b: string) => a.localeCompare(b);

function rulesetStatusContexts(r: RulesetConfig): string[] {
	const checks = r.rules.requiredStatusChecks;
	if (!checks?.enabled) return [];
	if (checks.requiredChecks?.length) {
		return checks.requiredChecks.map((c) => c.context);
	}
	return checks.acceptAnyOf ?? [];
}

function statusCheckSetsCompatible(
	rulesetContexts: string[],
	bpContexts: string[],
): boolean {
	if (rulesetContexts.length === 0 || bpContexts.length === 0) return true;
	const rulesetSorted = [...rulesetContexts].sort(compareStrings);
	const bpSorted = [...bpContexts].sort(compareStrings);
	if (rulesetSorted.join() === bpSorted.join()) return true;
	// acceptAnyOf: any listed name is valid; branch protection may pin one.
	const rulesetSet = new Set(rulesetContexts);
	return bpSorted.every((ctx) => rulesetSet.has(ctx));
}

type RepoCondition = { includes: string[]; excludes: string[] };

function repoCondition(r: RulesetConfig): RepoCondition {
	return {
		includes: r.conditions.repositoryName?.includes ?? ["~ALL"],
		excludes: r.conditions.repositoryName?.excludes ?? [],
	};
}

// Conservative overlap test: ~ALL overlaps everything; otherwise the
// include lists must intersect. Excludes are ignored, so two rulesets kept
// apart only by excludes are reported as overlapping and fail validation.
// Keep rulesets apart with include lists.
function repoSetsOverlap(a: RepoCondition, b: RepoCondition): boolean {
	if (a.includes.includes("~ALL") || b.includes.includes("~ALL")) return true;
	return a.includes.some((name) => b.includes.includes(name));
}

function validateTeamRefs(config: InfraConfig): ValidationIssue[] {
	const { repos, teams } = config;
	const teamSlugs = new Set(teams.teams.map((t) => t.slug));
	const repoNames = new Set(repos.map((r) => r.name));

	return [
		...Object.keys(teams.repoAccess)
			.filter((name) => !repoNames.has(name))
			.map((name) =>
				issue(`teams.repoAccess.${name}`, `unknown repo "${name}"`),
			),

		...Object.entries(teams.repoAccess).flatMap(([repoName, access]) =>
			access
				.filter((e) => !teamSlugs.has(e.team))
				.map((e) =>
					issue(`teams.repoAccess.${repoName}`, `unknown team "${e.team}"`),
				),
		),

		...repos.flatMap((repo) =>
			(repo.environments ?? []).flatMap((env) =>
				(env.requiredReviewerTeamSlugs ?? [])
					.filter((slug) => !teamSlugs.has(slug))
					.map((slug) =>
						issue(
							`repos.${repo.name}.environments.${env.name}`,
							`unknown team "${slug}"`,
						),
					),
			),
		),
	];
}

export function validateMemberRefs(
	teamsFile: TeamsFile,
	membersFile: MembersFileInput,
): ValidationIssue[] {
	const teamSlugs = new Set(teamsFile.teams.map((t) => t.slug));

	return membersFile.members.flatMap((member, i) =>
		member.teams
			.filter(({ slug }) => !teamSlugs.has(slug))
			.map(({ slug }, j) =>
				issue(`members.${i}.teams.${j}.slug`, `unknown team "${slug}"`),
			),
	);
}

function validateRulesetPatterns(config: InfraConfig): ValidationIssue[] {
	const { org, rulesets } = config;
	const defaultBranch = org.defaults.defaultBranch;

	const patternOwners = groupBy(
		rulesets
			.filter((r) => r.target === "branch" && r.enforcement !== "disabled")
			.flatMap((r) =>
				r.conditions.refName.includes.map((raw) => ({
					pattern: normalizeBranchPattern(raw, defaultBranch),
					ruleset: r,
				})),
			),
		(x) => x.pattern,
	);

	return Object.entries(patternOwners).flatMap(([pattern, entries]) => {
		const rulesetsAtPattern = uniq(entries.map((e) => e.ruleset));
		if (rulesetsAtPattern.length <= 1) return [];

		const conflicting = rulesetsAtPattern.filter((r) =>
			rulesetsAtPattern.some(
				(other) =>
					other.id !== r.id &&
					repoSetsOverlap(repoCondition(r), repoCondition(other)),
			),
		);

		if (conflicting.length <= 1) return [];

		return [
			issue(
				"rulesets",
				`branch pattern "${pattern}" appears in multiple rulesets (${uniq(conflicting.map((r) => r.id)).join(", ")})`,
			),
		];
	});
}

// A ruleset lists its repos by name, so a misspelt or removed name would
// leave that repo with no rules and no error. ~ALL and glob patterns are not
// names and are not checked.
function validateRulesetRepoRefs(config: InfraConfig): ValidationIssue[] {
	const repoNames = new Set(config.repos.map((r) => r.name));
	const isName = (entry: string) =>
		!entry.startsWith("~") && !entry.includes("*");

	return config.rulesets.flatMap((r) => {
		const { includes, excludes } = repoCondition(r);
		return uniq([...includes, ...excludes])
			.filter((name) => isName(name) && !repoNames.has(name))
			.map((name) =>
				issue(
					`rulesets.${r.id}.conditions.repositoryName`,
					`unknown repo "${name}"`,
				),
			);
	});
}

// A repo's check names only take effect through a ruleset that requires
// status checks. If no such ruleset is on the repo, nothing requires them.
function validateRepoStatusChecks(config: InfraConfig): ValidationIssue[] {
	const requiringChecks = config.rulesets.filter(
		(r) => r.enforcement !== "disabled" && r.rules.requiredStatusChecks.enabled,
	);

	return config.repos
		.filter(
			(repo) =>
				repo.requiredStatusChecks?.length &&
				!requiringChecks.some((r) => rulesetAppliesToRepo(r, repo.name)),
		)
		.map((repo) =>
			issue(
				`repos.${repo.name}.requiredStatusChecks`,
				"no ruleset on this repo requires status checks, so these are not enforced",
				"warning",
			),
		);
}

function validateRulesetBranchProtectionOverlap(
	config: InfraConfig,
): ValidationIssue[] {
	const { org, repos, rulesets } = config;
	const defaultBranch = org.defaults.defaultBranch;

	const activeBranchRulesets = rulesets.filter(
		(r) => r.target === "branch" && r.enforcement !== "disabled",
	);

	return activeBranchRulesets.flatMap((r) => {
		const rulesetPatterns = new Set(
			r.conditions.refName.includes.map((raw) =>
				normalizeBranchPattern(raw, defaultBranch),
			),
		);
		const rulesetContexts = rulesetStatusContexts(r);

		return repos.flatMap((repo) => {
			if (!rulesetAppliesToRepo(r, repo.name) || !repo.branchProtection) {
				return [];
			}

			return Object.entries(repo.branchProtection).flatMap(([pattern, bp]) => {
				// Exact match after normalization only. Glob-pattern overlap
				// (e.g. BP release/* vs ruleset release/v*) is out of scope.
				const normalizedBp = normalizeBranchPattern(pattern, defaultBranch);
				if (!rulesetPatterns.has(normalizedBp)) return [];

				const bpContexts = bp.requiredStatusChecks ?? [];
				if (rulesetContexts.length === 0 || bpContexts.length === 0) {
					return [];
				}

				if (statusCheckSetsCompatible(rulesetContexts, bpContexts)) return [];

				const rulesetSorted = [...rulesetContexts].sort(compareStrings);
				const bpSorted = [...bpContexts].sort(compareStrings);

				return [
					issue(
						`repos.${repo.name}.branchProtection.${pattern}`,
						`org ruleset "${r.id}" also targets "${pattern}" with different required status checks (ruleset: [${rulesetSorted.join(", ")}], repo: [${bpSorted.join(", ")}]); PRs must satisfy the union of both`,
						"warning",
					),
				];
			});
		});
	});
}

// GitHub rejects these pairs: each feature builds on the one it needs.
function validateSecurity(config: InfraConfig): ValidationIssue[] {
	const { defaults } = config.org;
	return config.repos.flatMap((repo) => {
		const security = { ...defaults.security, ...repo.security };
		const path = `repos.${repo.name}.security`;
		return [
			...(security.dependabotSecurityUpdates && !security.dependabotAlerts
				? [issue(path, "dependabotSecurityUpdates needs dependabotAlerts")]
				: []),
			...(security.pushProtection && !security.secretScanning
				? [issue(path, "pushProtection needs secretScanning")]
				: []),
		];
	});
}

function validateLabelGroups(labelGroups: LabelGroups): ValidationIssue[] {
	const labelOwners = groupBy(
		Object.entries(labelGroups).flatMap(([group, labels]) =>
			Object.keys(labels).map((name) => ({ name, group })),
		),
		(x) => x.name,
	);

	return Object.entries(labelOwners)
		.filter(([, owners]) => owners.length > 1)
		.map(([name, owners]) =>
			issue(
				`labels.${name}`,
				`defined in multiple groups (${owners.map((o) => o.group).join(", ")})`,
			),
		);
}

export function validateCrossRefs(
	config: InfraConfig,
	labelGroups: LabelGroups,
): ValidationIssue[] {
	return [
		...validateTeamRefs(config),
		...validateRulesetPatterns(config),
		...validateRulesetRepoRefs(config),
		...validateRepoStatusChecks(config),
		...validateRulesetBranchProtectionOverlap(config),
		...validateSecurity(config),
		...validateLabelGroups(labelGroups),
	];
}
