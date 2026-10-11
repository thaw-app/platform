import type { RepoConfig, RulesetConfig } from "@/types";
import type { ValidationIssue } from "./types";

export function normalizeBranchPattern(
	pattern: string,
	defaultBranch: string,
): string {
	if (pattern === "~DEFAULT_BRANCH") return defaultBranch;
	return pattern.replace(/^refs\/heads\//, "");
}

const escapeRegex = (text: string) =>
	text.replace(/[.+^${}()|[\]\\*?]/g, String.raw`\$&`);

const GLOB_WILDCARDS: Record<string, string> = {
	"**/": "(?:.*/)?",
	"**": ".*",
	"*": "[^/]*",
	"?": "[^/]",
};

// One piece of a glob at a time: a wildcard, an escaped character, a
// character class, or any other single character.
// A class stops at the next bracket of either kind, so a run of unclosed
// `[` is not rescanned to the end from each one.
const GLOB_TOKEN = /\*\*\/?|[*?]|\\(.)|\[([!^]?)([^\][]+)\]|./gs;

// An fnmatch glob as a regex, the way GitHub reads ruleset patterns: `*` and
// `?` stay within a path segment, `**/` spans any number of segments
// including none, and `[...]` is a character class.
function globToRegexSource(glob: string): string {
	return glob.replace(
		GLOB_TOKEN,
		(token: string, escaped?: string, negation?: string, members?: string) => {
			if (escaped !== undefined) return escapeRegex(escaped);
			if (members !== undefined) {
				const body = members.replace(/[\\\]^]/g, String.raw`\$&`);
				return `[${negation ? "^" : ""}${body}]`;
			}
			return GLOB_WILDCARDS[token] ?? escapeRegex(token);
		},
	);
}

/** Whether an fnmatch glob, as GitHub reads ruleset conditions, matches a name. */
export function globMatches(glob: string, name: string): boolean {
	return new RegExp(`^${globToRegexSource(glob)}$`).test(name);
}

export function branchPatternCovers(
	pattern: string,
	branch: string,
	defaultBranch: string,
): boolean {
	if (pattern === "~ALL") return true;
	return globMatches(normalizeBranchPattern(pattern, defaultBranch), branch);
}

/**
 * Ref names for github:RepositoryRuleset conditions. A bare pattern names a
 * tag in a tag ruleset and a branch in any other.
 */
export function normalizeRulesetRefName(
	pattern: string,
	target: RulesetConfig["target"] = "branch",
): string {
	if (pattern === "~DEFAULT_BRANCH" || pattern === "~ALL") return pattern;
	if (pattern.startsWith("refs/")) return pattern;
	return `${target === "tag" ? "refs/tags" : "refs/heads"}/${pattern}`;
}

export function normalizeActors(actors: string[], org: string): string[] {
	if (!actors?.length) return [];
	return actors.map((a) => {
		const trimmed = a.trim();
		if (!trimmed) {
			throw new Error(`invalid actor "${a}"`);
		}
		return trimmed.includes("/") ? trimmed : `${org}/${trimmed}`;
	});
}

export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(obj).filter(([, v]) => v !== undefined),
	) as Partial<T>;
}

export function issue(
	path: string,
	message: string,
	severity: ValidationIssue["severity"] = "error",
): ValidationIssue {
	return { path, message, severity };
}

/**
 * When team creation is disabled (enableTeams=false), environments that
 * require reviewer teams cannot be provisioned. Surface every offender at
 * once, before any resource is created.
 */
export function assertReviewerTeamsCreatable(
	repos: RepoConfig[],
	enableTeams: boolean,
): void {
	if (enableTeams) return;
	const offenders = repos.flatMap((repo) =>
		(repo.environments ?? [])
			.filter((env) => (env.requiredReviewerTeamSlugs ?? []).length > 0)
			.map((env) => `repos.${repo.name}.environments.${env.name}`),
	);
	if (offenders.length > 0) {
		const lines = offenders.map((o) => `- ${o}`).join("\n");
		throw new Error(
			`enableTeams is false, but these environments require reviewer teams:\n${lines}`,
		);
	}
}
