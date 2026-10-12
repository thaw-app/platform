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
	security: {
		dependabotAlerts: true,
		dependabotSecurityUpdates: false,
		secretScanning: true,
		pushProtection: true,
	},
	dependabot: {
		interval: "weekly",
		day: "monday",
		openPullRequestsLimit: 10,
		labels: ["dependencies"],
		assignees: ["someone"],
	},
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

	it("takes security settings from org defaults, overridden per repo", () => {
		expect(buildRepoConfig(repo(), baseCtx).security).toEqual(
			defaults.security,
		);
		expect(
			buildRepoConfig(repo({ security: { dependabotAlerts: false } }), baseCtx)
				.security,
		).toEqual({ ...defaults.security, dependabotAlerts: false });
	});

	it("uses a repo's own CODEOWNERS over the org template, bare or not", () => {
		const own = { codeowners: "* @someone\n" };
		expect(buildRepoConfig(repo(), baseCtx).codeownersContent).toBe(
			baseCtx.codeownersContent,
		);
		expect(buildRepoConfig(repo(own), baseCtx).codeownersContent).toBe(
			own.codeowners,
		);
		expect(
			buildRepoConfig(repo({ bare: true }), baseCtx).codeownersContent,
		).toBe("");
		expect(
			buildRepoConfig(repo({ ...own, bare: true }), baseCtx).codeownersContent,
		).toBe(own.codeowners);
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
		expect(bp.enforceAdmins).toBe(false);
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

	it("renders a dependabot.yml for the ecosystems a repo lists", () => {
		expect(buildRepoConfig(repo(), baseCtx).dependabotContent).toBe("");

		const built = buildRepoConfig(
			repo({ dependabot: ["bun", "github-actions"] }),
			baseCtx,
		);
		expect(built.dependabotContent).toBe(
			[
				"# Synced from thaw-app/platform. Edit config/repos.yaml there.",
				"version: 2",
				"multi-ecosystem-groups:",
				"  dependencies:",
				"    schedule:",
				'      interval: "weekly"',
				'      day: "monday"',
				"    labels:",
				'      - "dependencies"',
				"    assignees:",
				'      - "someone"',
				"",
				"updates:",
				'  - package-ecosystem: "bun"',
				'    directory: "/"',
				"    open-pull-requests-limit: 10",
				"    patterns:",
				'      - "*"',
				'    multi-ecosystem-group: "dependencies"',
				"",
				'  - package-ecosystem: "github-actions"',
				'    directory: "/"',
				"    open-pull-requests-limit: 10",
				"    patterns:",
				'      - "*"',
				'    multi-ecosystem-group: "dependencies"',
				"",
			].join("\n"),
		);
	});

	it("leaves out the day, labels and assignees the defaults do not set", () => {
		const built = buildRepoConfig(repo({ dependabot: ["npm"] }), {
			...baseCtx,
			defaults: {
				...defaults,
				dependabot: {
					interval: "monthly",
					openPullRequestsLimit: 5,
					labels: [],
					assignees: [],
				},
			},
		});
		expect(built.dependabotContent).not.toContain("day:");
		expect(built.dependabotContent).not.toContain("labels:");
		expect(built.dependabotContent).not.toContain("assignees:");
		expect(built.dependabotContent).toContain('interval: "monthly"');
	});

	it("bare repos skip org labels and CODEOWNERS, and keep their rulesets", () => {
		const built = buildRepoConfig(repo({ name: "brand-assets", bare: true }), {
			...baseCtx,
			labels: { global: { color: "000000" } },
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
		expect(built.labels).toEqual({});
		expect(built.resolvedRepoRulesets.map((r) => r.id)).toEqual([
			"main-default",
		]);
		expect(built.codeownersContent).toBe("");
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
