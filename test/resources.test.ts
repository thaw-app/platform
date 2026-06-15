import { beforeEach, describe, expect, it } from "bun:test";
import github from "@pulumi/github";
import pulumi from "@pulumi/pulumi";
import type { ResolvedRepoConfig, RulesetConfig, TeamsConfig } from "@/types";

interface Registered {
	type: string;
	name: string;
	inputs: Record<string, unknown>;
}
const registered: Registered[] = [];

pulumi.runtime.setMocks({
	newResource(args: pulumi.runtime.MockResourceArgs) {
		registered.push({ type: args.type, name: args.name, inputs: args.inputs });
		return { id: `${args.name}-id`, state: args.inputs };
	},
	call(args: pulumi.runtime.MockCallArgs) {
		return args.inputs;
	},
});

// Import AFTER setMocks so module-level pulumi state sees the mocks.
const { default: OrgRepository } = await import("@/resources/repo");
const { createRulesets } = await import("@/resources/rulesets");
const { createEnvironments } = await import("@/resources/environments");
const { createTeams, createTeamMemberships } = await import(
	"@/resources/teams"
);

beforeEach(() => {
	registered.length = 0;
});

// Resource registration settles asynchronously; flush microtasks/timers
// before asserting on `registered`.
const settle = () => new Promise((r) => setTimeout(r, 0));

const findByType = (t: string) => registered.filter((r) => r.type === t);

const first = <T>(items: T[]): T => {
	const item = items[0];
	if (!item) throw new Error("expected at least one item");
	return item;
};

const resolvedRepo = (
	overrides: Partial<ResolvedRepoConfig> = {},
): ResolvedRepoConfig => ({
	name: "test-repo",
	description: "d",
	visibility: "public",
	mergeStrategies: ["squash"],
	deleteBranchOnMerge: true,
	hasIssues: true,
	hasWiki: false,
	hasProjects: false,
	hasDiscussions: false,
	teams: [],
	resolvedBranchProtection: {},
	squashMergeCommitTitle: "PR_TITLE",
	squashMergeCommitMessage: "COMMIT_MESSAGES",
	defaultBranch: "main",
	codeownersContent: "* @acme-org/maintainers\n",
	...overrides,
});

const defaultRules = (): RulesetConfig["rules"] => ({
	creation: false,
	update: false,
	deletion: false,
	nonFastForward: false,
	requiredLinearHistory: false,
	requiredSignatures: false,
	copilotCodeReview: { reviewDraftPullRequests: false, reviewOnPush: false },
	pullRequest: {},
	requiredStatusChecks: { enabled: false },
	requiredCodeScanning: { enabled: false },
	mergeQueue: { enabled: false },
	requiredDeployments: { enabled: false },
});

const mainRuleset = (
	overrides: Partial<RulesetConfig> = {},
): RulesetConfig => ({
	id: "rs",
	target: "branch",
	enforcement: "active",
	conditions: { refName: { includes: ["~DEFAULT_BRANCH"] } },
	rules: defaultRules(),
	...overrides,
});

const teamsConfig = (overrides: Partial<TeamsConfig> = {}): TeamsConfig => ({
	teams: [{ slug: "maintainers", name: "Maintainers" }],
	repoAccess: {},
	...overrides,
});

describe("OrgRepository", () => {
	it("exports a constructor function", () => {
		expect(typeof OrgRepository).toBe("function");
	});

	it("sets merge-strategy flags for squash", async () => {
		new OrgRepository(
			"r",
			resolvedRepo({
				mergeStrategies: ["squash"],
				squashMergeCommitTitle: "PR_TITLE",
				squashMergeCommitMessage: "COMMIT_MESSAGES",
			}),
			{},
		);
		await settle();

		const repo = first(findByType("github:index/repository:Repository"));
		expect(repo.inputs.allowSquashMerge).toBe(true);
		expect(repo.inputs.allowMergeCommit).toBe(false);
		expect(repo.inputs.allowRebaseMerge).toBe(false);
		expect(repo.inputs.squashMergeCommitTitle).toBe("PR_TITLE");
		expect(repo.inputs.squashMergeCommitMessage).toBe("COMMIT_MESSAGES");
	});

	it("omits squash settings when squash is not allowed", async () => {
		new OrgRepository("r", resolvedRepo({ mergeStrategies: ["merge"] }), {});
		await settle();

		const repo = first(findByType("github:index/repository:Repository"));
		expect(repo.inputs.allowSquashMerge).toBe(false);
		expect("squashMergeCommitTitle" in repo.inputs).toBe(false);
	});

	it("skips child resources for archived repos", async () => {
		new OrgRepository(
			"r",
			resolvedRepo({
				archived: true,
				teams: [{ slug: "maintainers", teamId: "42", permission: "admin" }],
				resolvedBranchProtection: {
					main: { enforceAdmins: true },
				},
				labels: { bug: { color: "ffffff" } },
				environments: [{ name: "prod" }],
			}),
			{},
		);
		await settle();

		expect(findByType("github:index/repository:Repository")).toHaveLength(1);
		expect(
			findByType("github:index/teamRepository:TeamRepository"),
		).toHaveLength(0);
		expect(
			findByType("github:index/branchProtection:BranchProtection"),
		).toHaveLength(0);
		expect(
			findByType("github:index/repositoryEnvironment:RepositoryEnvironment"),
		).toHaveLength(0);
		expect(findByType("github:index/issueLabel:IssueLabel")).toHaveLength(0);
	});

	it("creates child resources for active repos", async () => {
		new OrgRepository(
			"r",
			resolvedRepo({
				teams: [{ slug: "maintainers", teamId: "42", permission: "admin" }],
				resolvedBranchProtection: {
					main: { enforceAdmins: true },
				},
				labels: {
					bug: { color: "ffffff" },
					feature: { color: "000000" },
				},
			}),
			{},
		);
		await settle();

		expect(
			findByType("github:index/teamRepository:TeamRepository"),
		).toHaveLength(1);
		const bp = first(
			findByType("github:index/branchProtection:BranchProtection"),
		);
		expect(bp.inputs.pattern).toBe("main");
		expect(findByType("github:index/issueLabel:IssueLabel")).toHaveLength(2);
	});

	it("syncs CODEOWNERS from org config", async () => {
		new OrgRepository(
			"r",
			resolvedRepo({
				codeownersContent: "* @acme-org/maintainers\n",
			}),
			{},
		);
		await settle();

		const file = first(
			findByType("github:index/repositoryFile:RepositoryFile"),
		);
		expect(file.inputs.file).toBe(".github/CODEOWNERS");
		expect(file.inputs.content).toBe("* @acme-org/maintainers");
		expect(file.inputs.autocreateBranch).toBe(true);
	});
});

describe("createRulesets", () => {
	it("drops disabled rulesets", async () => {
		const result = createRulesets([
			mainRuleset({ id: "off", enforcement: "disabled" }),
		]);
		await settle();

		expect(result).toHaveLength(0);
		expect(
			findByType("github:index/organizationRuleset:OrganizationRuleset"),
		).toHaveLength(0);
	});

	it("defaults name and repositoryName includes", async () => {
		createRulesets([mainRuleset({ id: "default-rs" })]);
		await settle();

		const rs = first(
			findByType("github:index/organizationRuleset:OrganizationRuleset"),
		);
		expect(rs.inputs.name).toBe("default-rs");
		expect(
			(rs.inputs.conditions as { repositoryName: { includes: string[] } })
				.repositoryName.includes,
		).toEqual(["~ALL"]);
	});

	it("maps requiredChecks when requiredStatusChecks is enabled", async () => {
		createRulesets([
			mainRuleset({
				id: "checks",
				rules: {
					...defaultRules(),
					requiredStatusChecks: {
						enabled: true,
						requiredChecks: [{ context: "ci" }],
						strictRequiredStatusChecksPolicy: true,
					},
				},
			}),
		]);
		await settle();

		const rs = first(
			findByType("github:index/organizationRuleset:OrganizationRuleset"),
		);
		expect(
			(
				rs.inputs.rules as {
					requiredStatusChecks: { requiredChecks: unknown[] };
				}
			).requiredStatusChecks.requiredChecks,
		).toEqual([{ context: "ci" }]);
	});

	it("omits requiredStatusChecks when acceptAnyOf is set", async () => {
		createRulesets([
			mainRuleset({
				id: "any-ci",
				rules: {
					...defaultRules(),
					requiredStatusChecks: {
						enabled: true,
						acceptAnyOf: ["ci", "build", "test"],
					},
				},
			}),
		]);
		await settle();

		const rs = first(
			findByType("github:index/organizationRuleset:OrganizationRuleset"),
		);
		expect(
			(rs.inputs.rules as Record<string, unknown>).requiredStatusChecks,
		).toBeUndefined();
	});

	it("omits requiredStatusChecks when disabled in config", async () => {
		createRulesets([mainRuleset({ id: "no-checks" })]);
		await settle();

		const rs = first(
			findByType("github:index/organizationRuleset:OrganizationRuleset"),
		);
		expect(
			(rs.inputs.rules as Record<string, unknown>).requiredStatusChecks,
		).toBeUndefined();
	});
});

describe("createEnvironments", () => {
	const mockRepo = () =>
		new github.Repository("env-repo", {
			name: "env-repo",
			description: "d",
		});

	it("maps protected deployment branch policy", async () => {
		const repo = mockRepo();
		createEnvironments(
			{
				resourcePrefix: "r",
				environments: [{ name: "prod", deploymentBranchPolicy: "protected" }],
				repo,
				teamResources: {},
			},
			{},
		);
		await settle();

		const env = first(
			findByType("github:index/repositoryEnvironment:RepositoryEnvironment"),
		);
		expect(env.inputs.deploymentBranchPolicy).toEqual({
			protectedBranches: true,
			customBranchPolicies: false,
		});
	});

	it("omits deployment branch policy when unprotected or omitted", async () => {
		const repo = mockRepo();
		createEnvironments(
			{
				resourcePrefix: "r",
				environments: [
					{ name: "prod", deploymentBranchPolicy: "unprotected" },
					{ name: "staging" },
				],
				repo,
				teamResources: {},
			},
			{},
		);
		await settle();

		for (const env of findByType(
			"github:index/repositoryEnvironment:RepositoryEnvironment",
		)) {
			expect(env.inputs.deploymentBranchPolicy).toBeUndefined();
		}
	});

	it("throws for unknown reviewer team slugs", () => {
		const repo = mockRepo();
		expect(() =>
			createEnvironments(
				{
					resourcePrefix: "r",
					environments: [
						{ name: "prod", requiredReviewerTeamSlugs: ["ghosts"] },
					],
					repo,
					teamResources: {},
				},
				{},
			),
		).toThrow(/unknown team/);
	});
});

describe("createTeams", () => {
	it("returns a map keyed by slug", async () => {
		const map = createTeams(teamsConfig());
		await settle();

		expect(Object.keys(map)).toEqual(["maintainers"]);
		expect(
			findByType("github:index/team:Team").some(
				(t) => t.name === "maintainers",
			),
		).toBe(true);
	});

	it("registers team memberships with roles", async () => {
		const map = createTeams(
			teamsConfig({
				teams: [
					{
						slug: "maintainers",
						name: "Maintainers",
						members: [
							{ username: "alice", role: "maintainer" },
							{ username: "bob", role: "member" },
						],
					},
				],
			}),
		);
		createTeamMemberships(
			teamsConfig({
				teams: [
					{
						slug: "maintainers",
						name: "Maintainers",
						members: [
							{ username: "alice", role: "maintainer" },
							{ username: "bob", role: "member" },
						],
					},
				],
			}),
			map,
		);
		await settle();

		const memberships = findByType(
			"github:index/teamMembership:TeamMembership",
		);
		expect(memberships).toHaveLength(2);
		expect(memberships.map((m) => m.inputs.role)).toEqual(
			expect.arrayContaining(["member", "maintainer"]),
		);
	});
});
