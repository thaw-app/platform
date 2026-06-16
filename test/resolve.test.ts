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
	provisionRepoRulesets: false,
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

	it("resolves pulumiName and organization", () => {
		const built = buildRepoConfig(
			repo({ pulumiName: "dot-github", name: ".github" }),
			{
				...baseCtx,
				organization: "thaw-app",
			},
		);
		expect(built.pulumiName).toBe("dot-github");
		expect(built.name).toBe(".github");
		expect(built.organization).toBe("thaw-app");
	});

	it("derives branch protection only from explicit repo config", () => {
		expect(buildRepoConfig(repo(), baseCtx).resolvedBranchProtection).toEqual(
			{},
		);
	});

	it("resolves per-repo rulesets when provisionRepoRulesets is on", () => {
		const built = buildRepoConfig(repo({ name: "website" }), {
			...baseCtx,
			provisionRepoRulesets: true,
			rulesets: [
				{
					id: "main-default",
					target: "branch",
					enforcement: "active",
					conditions: { refName: { includes: ["~DEFAULT_BRANCH"] } },
					rules: {
						creation: false,
						update: false,
						deletion: false,
						nonFastForward: false,
						requiredLinearHistory: false,
						requiredSignatures: false,
						copilotCodeReview: {
							reviewDraftPullRequests: false,
							reviewOnPush: false,
						},
						pullRequest: {},
						requiredStatusChecks: { enabled: false },
						requiredCodeScanning: { enabled: false },
						mergeQueue: { enabled: false },
						requiredDeployments: { enabled: false },
					},
				},
			],
		});
		expect(built.resolvedRepoRulesets).toHaveLength(1);
		expect(built.resolvedRepoRulesets[0]?.id).toBe("main-default");
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
