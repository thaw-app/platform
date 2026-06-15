import { describe, expect, it } from "bun:test";
import { validateCrossRefs } from "@/setup";
import type {
	InfraConfig,
	LabelGroups,
	OrgConfig,
	RulesetConfig,
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

const baseConfig = (): InfraConfig => ({
	org: { owner: "acme", organization: "acme-org", defaults },
	labels: {},
	repos: [{ name: "r", description: "d" }],
	rulesets: [],
	teams: {
		teams: [{ slug: "maintainers", name: "Maintainers" }],
		repoAccess: {},
	},
	codeownersContent: "* @acme-org/maintainers\n",
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

const repoEntry = (cfg: InfraConfig) => {
	const repo = cfg.repos[0];
	if (!repo) throw new Error("expected repo in base config");
	return repo;
};

const mainRuleset = (id: string): RulesetConfig => ({
	id,
	target: "branch",
	enforcement: "active",
	conditions: { refName: { includes: ["~DEFAULT_BRANCH"] } },
	rules: defaultRules(),
});

describe("validateCrossRefs", () => {
	it("passes a fully consistent config", () => {
		expect(validateCrossRefs(baseConfig(), {})).toEqual([]);
	});

	it("flags repoAccess pointing at an unknown repo", () => {
		const cfg = baseConfig();
		cfg.teams.repoAccess = {
			ghost: [{ team: "maintainers", permission: "push" }],
		};
		const issues = validateCrossRefs(cfg, {});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.message).toMatch(/unknown repo "ghost"/);
	});

	it("flags repoAccess pointing at an unknown team", () => {
		const cfg = baseConfig();
		cfg.teams.repoAccess = { r: [{ team: "ghosts", permission: "push" }] };
		const issues = validateCrossRefs(cfg, {});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.message).toMatch(/unknown team "ghosts"/);
	});

	it("flags environment reviewers referencing an unknown team", () => {
		const cfg = baseConfig();
		repoEntry(cfg).environments = [
			{ name: "prod", requiredReviewerTeamSlugs: ["ghosts"] },
		];
		const issues = validateCrossRefs(cfg, {});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.path).toBe("repos.r.environments.prod");
	});

	it("flags a branch pattern owned by multiple rulesets", () => {
		const cfg = baseConfig();
		cfg.rulesets = [mainRuleset("a"), mainRuleset("b")];
		const issues = validateCrossRefs(cfg, {});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.message).toMatch(/appears in multiple rulesets \(a, b\)/);
	});

	it("flags a label defined in more than one group", () => {
		const labelGroups: LabelGroups = {
			bugs: { dup: { color: "ffffff" } },
			triage: { dup: { color: "000000" } },
		};
		const issues = validateCrossRefs(baseConfig(), labelGroups);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.path).toBe("labels.dup");
	});

	it("warns when ruleset and branch protection require different status checks", () => {
		const cfg = baseConfig();
		cfg.rulesets = [
			{
				...mainRuleset("org-main"),
				rules: {
					...defaultRules(),
					requiredStatusChecks: {
						enabled: true,
						requiredChecks: [{ context: "ci" }],
					},
				},
			},
		];
		repoEntry(cfg).branchProtection = {
			main: { requiredStatusChecks: ["test"] },
		};
		const issues = validateCrossRefs(cfg, {});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.severity).toBe("warning");
		expect(issues[0]?.message).toMatch(/different required status checks/);
	});

	it("passes when branch protection uses an acceptAnyOf CI context", () => {
		const cfg = baseConfig();
		cfg.rulesets = [
			{
				...mainRuleset("org-main"),
				rules: {
					...defaultRules(),
					requiredStatusChecks: {
						enabled: true,
						acceptAnyOf: ["ci", "build", "test"],
					},
				},
			},
		];
		repoEntry(cfg).branchProtection = {
			main: { requiredStatusChecks: ["build"] },
		};
		expect(validateCrossRefs(cfg, {})).toEqual([]);
	});

	it("passes when ruleset and branch protection share the same status checks", () => {
		const cfg = baseConfig();
		cfg.rulesets = [
			{
				...mainRuleset("org-main"),
				rules: {
					...defaultRules(),
					requiredStatusChecks: {
						enabled: true,
						requiredChecks: [{ context: "ci" }],
					},
				},
			},
		];
		repoEntry(cfg).branchProtection = {
			main: { requiredStatusChecks: ["ci"] },
		};
		expect(validateCrossRefs(cfg, {})).toEqual([]);
	});

	it("ignores branch protection when ruleset repo condition excludes the repo", () => {
		const cfg = baseConfig();
		cfg.rulesets = [
			{
				...mainRuleset("scoped"),
				conditions: {
					refName: { includes: ["~DEFAULT_BRANCH"] },
					repositoryName: { includes: ["other-repo"], excludes: [] },
				},
				rules: {
					...defaultRules(),
					requiredStatusChecks: {
						enabled: true,
						requiredChecks: [{ context: "ci" }],
					},
				},
			},
		];
		repoEntry(cfg).branchProtection = {
			main: { requiredStatusChecks: ["test"] },
		};
		expect(validateCrossRefs(cfg, {})).toEqual([]);
	});

	it("normalizes branch patterns before comparing ruleset and branch protection", () => {
		const cfg = baseConfig();
		cfg.rulesets = [
			{
				...mainRuleset("org-main"),
				rules: {
					...defaultRules(),
					requiredStatusChecks: {
						enabled: true,
						requiredChecks: [{ context: "ci" }],
					},
				},
			},
		];
		repoEntry(cfg).branchProtection = {
			"refs/heads/main": { requiredStatusChecks: ["test"] },
		};
		const issues = validateCrossRefs(cfg, {});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.severity).toBe("warning");
	});

	it("does not flag duplicate patterns across disjoint repository scopes", () => {
		const cfg = baseConfig();
		cfg.rulesets = [
			{
				...mainRuleset("a"),
				conditions: {
					refName: { includes: ["~DEFAULT_BRANCH"] },
					repositoryName: { includes: ["repo-a"], excludes: [] },
				},
			},
			{
				...mainRuleset("b"),
				conditions: {
					refName: { includes: ["~DEFAULT_BRANCH"] },
					repositoryName: { includes: ["repo-b"], excludes: [] },
				},
			},
		];
		expect(validateCrossRefs(cfg, {})).toEqual([]);
	});
});
