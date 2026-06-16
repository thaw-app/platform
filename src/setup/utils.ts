import type { RepoConfig } from "@/types";
import type { ValidationIssue } from "./types";

export function normalizeBranchPattern(
	pattern: string,
	defaultBranch: string,
): string {
	if (pattern === "~DEFAULT_BRANCH") return defaultBranch;
	return pattern.replace(/^refs\/heads\//, "");
}

/** Ref names for github:RepositoryRuleset / OrganizationRuleset conditions. */
export function normalizeRulesetRefName(pattern: string): string {
	if (pattern === "~DEFAULT_BRANCH" || pattern === "~ALL") return pattern;
	if (pattern.startsWith("refs/")) return pattern;
	return `refs/heads/${pattern}`;
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
