import { describe, expect, it } from "bun:test";
import { buildRepoConfig, resolveTeamAccess } from "@/setup";
import type {
	OrgConfig,
	RepoConfig,
	TeamResourceMap,
	TeamsConfig,
} from "@/types";

const defaults = {
	visibility: "private",
	defaultBranch: "main",
	deleteBranchOnMerge: true,
	mergeStrategies: ["squash"],
	squashMergeCommitTitle: "PR_TITLE",
	squashMergeCommitMessage: "COMMIT_MESSAGES",
	features: { issues: true, wiki: false, projects: false, discussions: false },
} satisfies OrgConfig["defaults"];

const baseCtx = {
	defaults,
	teamAccess: [],
	labels: {},
	organization: "acme",
	codeownersContent: "* @acme-org/maintainers\n",
	rulesets: [],
	bootstrapBranchProtection: false,
};

const repo = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
	name: "r",
	description: "d",
	...overrides,
});

describe("buildRepoConfig", () => {
	it("falls back to org defaults for omitted fields", () => {
		const built = buildRepoConfig(repo(), baseCtx);
		expect(built.visibility).toBe("private");
		expect(built.mergeStrategies).toEqual(["squash"]);
		expect(built.deleteBranchOnMerge).toBe(true);
		expect(built.hasIssues).toBe(true);
		expect(built.hasWiki).toBe(false);
		expect(built.squashMergeCommitTitle).toBe("PR_TITLE");
		expect(built.squashMergeCommitMessage).toBe("COMMIT_MESSAGES");
	});

	it("lets the repo override defaults", () => {
		const built = buildRepoConfig(repo({ visibility: "public" }), baseCtx);
		expect(built.visibility).toBe("public");
	});

	it("derives branch protection only from explicit repo config when bootstrap is off", () => {
		expect(buildRepoConfig(repo(), baseCtx).resolvedBranchProtection).toEqual(
			{},
		);
	});

	it("normalizes branch-protection keys so aliases collapse to one pattern", () => {
		const built = buildRepoConfig(
			repo({
				branchProtection: { "refs/heads/main": { requiredReviewCount: 2 } },
			}),
			baseCtx,
		);
		expect(Object.keys(built.resolvedBranchProtection)).toEqual(["main"]);
		const bp = built.resolvedBranchProtection.main;
		if (!bp) throw new Error("expected branch protection for main");
		expect(bp.enforceAdmins).toBe(true);
		// requiredPullRequestReviews is typed as a Pulumi Input union; at build
		// time it's a plain array, so narrow it for the assertion.
		const reviews = bp.requiredPullRequestReviews as Array<{
			requiredApprovingReviewCount?: number;
		}>;
		expect(reviews[0]).toMatchObject({ requiredApprovingReviewCount: 2 });
	});

	it("merges org-wide labels with repo-specific labels", () => {
		const built = buildRepoConfig(
			repo({ labels: { local: { color: "ffffff" } } }),
			{
				...baseCtx,
				labels: { global: { color: "000000" } },
			},
		);
		expect(Object.keys(built.labels ?? {})).toEqual(["global", "local"]);
	});
});

describe("resolveTeamAccess", () => {
	const teamResources = {
		maintainers: { id: "42" },
	} as unknown as TeamResourceMap;

	const repoAccess: TeamsConfig["repoAccess"] = {
		r: [{ team: "maintainers", permission: "admin" }],
	};

	it("resolves team ids for a repo's access list", () => {
		const access = resolveTeamAccess("r", repoAccess, teamResources);
		expect(access).toEqual([
			{ slug: "maintainers", teamId: "42", permission: "admin" },
		]);
	});

	it("returns an empty list when the repo has no access entries", () => {
		expect(resolveTeamAccess("other", repoAccess, teamResources)).toEqual([]);
	});

	it("throws when a referenced team has no resource", () => {
		const bad: TeamsConfig["repoAccess"] = {
			r: [{ team: "ghosts", permission: "push" }],
		};
		expect(() => resolveTeamAccess("r", bad, teamResources)).toThrow(/ghosts/);
	});
});
