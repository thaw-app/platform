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
const { createRulesets, createRepositoryRulesets } = await import(
	"@/resources/rulesets"
);
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

const VULNERABILITY_ALERTS =
	"github:index/repositoryVulnerabilityAlerts:RepositoryVulnerabilityAlerts";

const SECURITY_UPDATES =
	"github:index/repositoryDependabotSecurityUpdates:RepositoryDependabotSecurityUpdates";

const first = <T>(items: T[]): T => {
	const item = items[0];
	if (!item) throw new Error("expected at least one item");
	return item;
};

const resolvedRepo = (
	overrides: Partial<ResolvedRepoConfig> = {},
): ResolvedRepoConfig => ({
	name: "test-repo",
	pulumiName: "test-repo",
	organization: "acme-org",
	description: "d",
	visibility: "public",
	mergeStrategies: ["squash"],
	deleteBranchOnMerge: true,
	hasIssues: true,
	hasWiki: false,
	hasProjects: false,
	hasDiscussions: false,
	security: {
		dependabotAlerts: true,
		dependabotSecurityUpdates: false,
		secretScanning: true,
		pushProtection: true,
	},
	teams: [],
	resolvedRepoRulesets: [],
	resolvedBranchProtection: {},
	squashMergeCommitTitle: "PR_TITLE",
	squashMergeCommitMessage: "COMMIT_MESSAGES",
	defaultBranch: "main",
	codeownersContent: "* @acme-org/maintainers\n",
	dependabotContent: "",
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

function provisionOrgRepository(
	name: string,
	config: ResolvedRepoConfig,
	teams: Record<string, github.Team> = {},
): void {
	new OrgRepository(name, config, teams); // NOSONAR
}

describe("OrgRepository", () => {
	it("exports a constructor function", () => {
		expect(typeof OrgRepository).toBe("function");
	});

	it("sets merge-strategy flags for squash", async () => {
		provisionOrgRepository(
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
		provisionOrgRepository(
			"r",
			resolvedRepo({ mergeStrategies: ["merge"] }),
			{},
		);
		await settle();

		const repo = first(findByType("github:index/repository:Repository"));
		expect(repo.inputs.allowSquashMerge).toBe(false);
		expect("squashMergeCommitTitle" in repo.inputs).toBe(false);
	});

	it("skips child resources for archived repos", async () => {
		provisionOrgRepository(
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
		expect(findByType(VULNERABILITY_ALERTS)).toHaveLength(0);
	});

	it("sets Dependabot alerts and security updates from the resolved config", async () => {
		provisionOrgRepository("r", resolvedRepo());
		await settle();

		const alerts = first(findByType(VULNERABILITY_ALERTS));
		expect(alerts.name).toBe("r-dependabot-alerts");
		expect(alerts.inputs.enabled).toBe(true);
		const updates = first(findByType(SECURITY_UPDATES));
		expect(updates.name).toBe("r-dependabot-security-updates");
		expect(updates.inputs.enabled).toBe(false);
	});

	it("sets secret scanning on public repos and leaves private ones alone", async () => {
		provisionOrgRepository("pub", resolvedRepo());
		provisionOrgRepository("priv", resolvedRepo({ visibility: "private" }));
		await settle();

		const repos = findByType("github:index/repository:Repository");
		const analysis = (name: string) =>
			repos.find((r) => r.name === name)?.inputs.securityAndAnalysis;
		expect(analysis("pub")).toEqual({
			secretScanning: { status: "enabled" },
			secretScanningPushProtection: { status: "enabled" },
		});
		expect(analysis("priv")).toBeUndefined();
	});

	it("creates repository rulesets when resolvedRepoRulesets is set", async () => {
		provisionOrgRepository(
			"r",
			resolvedRepo({
				resolvedRepoRulesets: [mainRuleset({ id: "main-default" })],
			}),
			{},
		);
		await settle();

		expect(
			findByType("github:index/repositoryRuleset:RepositoryRuleset"),
		).toHaveLength(1);
		expect(
			findByType("github:index/branchProtection:BranchProtection"),
		).toHaveLength(0);
	});

	it("creates child resources for active repos", async () => {
		provisionOrgRepository(
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
		provisionOrgRepository(
			"r",
			resolvedRepo({
				codeownersContent: "* @acme-org/maintainers\n",
			}),
			{},
		);
		await settle();

		const files = findByType("github:index/repositoryFile:RepositoryFile");
		expect(files).toHaveLength(1);

		const codeowners = first(files);
		expect(codeowners.inputs.file).toBe(".github/CODEOWNERS");
		expect(codeowners.inputs.content).toBe("* @acme-org/maintainers");
		expect(codeowners.inputs.overwriteOnCreate).toBe(true);
		expect("autocreateBranch" in codeowners.inputs).toBe(false);
	});

	it("syncs dependabot.yml next to CODEOWNERS when the repo has one", async () => {
		provisionOrgRepository(
			"r",
			resolvedRepo({ dependabotContent: "version: 2\nupdates: []\n" }),
			{},
		);
		await settle();

		const files = findByType("github:index/repositoryFile:RepositoryFile");
		expect(files.map((f) => f.inputs.file)).toEqual([
			".github/CODEOWNERS",
			".github/dependabot.yml",
		]);
		expect(files.map((f) => f.name)).toEqual(["r-codeowners", "r-dependabot"]);
	});

	it("adopts an existing GitHub repository when adopt is true", async () => {
		provisionOrgRepository(
			"r",
			resolvedRepo({
				name: "existing",
				adopt: true,
				organization: "acme-org",
			}),
			{},
		);
		await settle();

		const repo = first(findByType("github:index/repository:Repository"));
		expect(repo.inputs.name).toBe("existing");
	});

	it("uses pulumiName for resources and name for the GitHub repo", async () => {
		provisionOrgRepository(
			"dot-github",
			resolvedRepo({
				name: ".github",
				pulumiName: "dot-github",
			}),
			{},
		);
		await settle();

		const repo = first(findByType("github:index/repository:Repository"));
		expect(repo.name).toBe("dot-github");
		expect(repo.inputs.name).toBe(".github");
	});

	it("syncs CODEOWNERS without bootstrap when autoInit is false", async () => {
		provisionOrgRepository(
			"r",
			resolvedRepo({
				autoInit: false,
				codeownersContent: "* @acme-org/maintainers\n",
			}),
			{},
		);
		await settle();

		expect(findByType("github:index/branch:Branch")).toHaveLength(0);
		const file = first(
			findByType("github:index/repositoryFile:RepositoryFile"),
		);
		expect(file.inputs.overwriteOnCreate).toBe(true);
		expect(file.inputs.autocreateBranch).toBeUndefined();
	});
});

describe("createRepositoryRulesets", () => {
	it("normalizes default-branch patterns", async () => {
		const repo = new github.Repository("ruleset-repo", {
			name: "website",
			description: "d",
		});
		createRepositoryRulesets("website", repo, [
			mainRuleset({
				id: "main-default",
				rules: {
					...defaultRules(),
					requiredStatusChecks: {
						enabled: true,
						acceptAnyOf: ["ci", "build", "test"],
						strictRequiredStatusChecksPolicy: true,
					},
				},
			}),
		]);
		await settle();

		const rs = first(
			findByType("github:index/repositoryRuleset:RepositoryRuleset"),
		);
		expect(
			(rs.inputs.conditions as { refName: { includes: string[] } }).refName
				.includes,
		).toEqual(["~DEFAULT_BRANCH"]);
		expect(
			(
				rs.inputs.rules as {
					requiredStatusChecks: { requiredChecks: unknown[] };
				}
			).requiredStatusChecks.requiredChecks,
		).toEqual([{ context: "ci" }]);
	});
});

it("asks for no pull request when the ruleset has no pull request rule", async () => {
	const repo = new github.Repository("r", { name: "r" });
	await settle();
	const {
		pullRequest: _pr,
		copilotCodeReview: _review,
		...rules
	} = defaultRules();
	createRepositoryRulesets("brand-assets", repo, [
		mainRuleset({
			id: "main-basic",
			rules: { ...rules, deletion: true, nonFastForward: true },
		}),
	]);
	await settle();
	const rs = first(
		findByType("github:index/repositoryRuleset:RepositoryRuleset"),
	);
	const sent = rs.inputs.rules as Record<string, unknown>;
	expect(sent.pullRequest).toBeUndefined();
	expect(sent.copilotCodeReview).toBeUndefined();
	expect(sent.requiredStatusChecks).toBeUndefined();
	expect(sent.nonFastForward).toBe(true);
});

it("sends a tag ruleset's bare patterns as tag refs", async () => {
	const repo = new github.Repository("r", { name: "r" });
	await settle();
	createRepositoryRulesets("website", repo, [
		mainRuleset({
			id: "tags",
			target: "tag",
			conditions: { refName: { includes: ["v*"], excludes: ["v0*"] } },
		}),
	]);
	await settle();
	const rs = first(
		findByType("github:index/repositoryRuleset:RepositoryRuleset"),
	);
	expect((rs.inputs.conditions as { refName: unknown }).refName).toEqual({
		includes: ["refs/tags/v*"],
		excludes: ["refs/tags/v0*"],
	});
});

it("passes bypassActors through to repository rulesets", async () => {
	const repo = new github.Repository("r", { name: "r" });
	await settle();
	createRepositoryRulesets("website", repo, [
		mainRuleset({
			id: "with-bypass",
			bypassActors: [
				{ actorType: "OrganizationAdmin", actorId: 1, bypassMode: "always" },
				{ actorType: "RepositoryRole", actorId: 5, bypassMode: "pull_request" },
			],
		}),
	]);
	await settle();
	const rs = first(
		findByType("github:index/repositoryRuleset:RepositoryRuleset"),
	);
	expect(rs.inputs.bypassActors).toEqual([
		{ actorType: "OrganizationAdmin", actorId: 1, bypassMode: "always" },
		{ actorType: "RepositoryRole", actorId: 5, bypassMode: "pull_request" },
	]);
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
