import { describe, expect, it } from "bun:test";
import {
	bootstrapBranchProtectionFromRulesets,
	mergeRepoBranchProtection,
	rulesetAppliesToRepo,
	rulesetToBranchProtectionConfig,
} from "@/setup/rulesets";
import type { RepoConfig, RulesetConfig } from "@/types";

const defaultRules = (): RulesetConfig["rules"] => ({
	creation: true,
	update: false,
	deletion: true,
	nonFastForward: true,
	requiredLinearHistory: true,
	requiredSignatures: false,
	copilotCodeReview: { reviewDraftPullRequests: false, reviewOnPush: false },
	pullRequest: {
		requiredApprovingReviewCount: 2,
		dismissStaleReviewsOnPush: true,
		requireCodeOwnerReview: true,
		requireLastPushApproval: true,
		requiredReviewThreadResolution: true,
		allowedMergeMethods: ["squash"],
	},
	requiredStatusChecks: {
		enabled: true,
		acceptAnyOf: ["ci", "build", "test"],
		strictRequiredStatusChecksPolicy: true,
	},
	requiredCodeScanning: { enabled: false },
	mergeQueue: { enabled: false },
	requiredDeployments: { enabled: false },
});

const mainRuleset = (
	overrides: Partial<RulesetConfig> = {},
): RulesetConfig => ({
	id: "main-default",
	target: "branch",
	enforcement: "active",
	conditions: { refName: { includes: ["~DEFAULT_BRANCH"] } },
	rules: defaultRules(),
	...overrides,
});

const releaseRuleset = (): RulesetConfig => ({
	id: "release",
	target: "branch",
	enforcement: "active",
	conditions: { refName: { includes: ["refs/heads/release/*"] } },
	rules: defaultRules(),
});

describe("rulesetAppliesToRepo", () => {
	it("applies to all repos by default", () => {
		expect(rulesetAppliesToRepo(mainRuleset(), "website")).toBe(true);
	});

	it("respects repository excludes", () => {
		const ruleset = mainRuleset({
			conditions: {
				refName: { includes: ["~DEFAULT_BRANCH"] },
				repositoryName: { includes: ["~ALL"], excludes: ["website"] },
			},
		});
		expect(rulesetAppliesToRepo(ruleset, "website")).toBe(false);
		expect(rulesetAppliesToRepo(ruleset, "org-ci")).toBe(true);
	});
});

describe("rulesetToBranchProtectionConfig", () => {
	it("maps review and status-check policy", () => {
		const config = rulesetToBranchProtectionConfig(mainRuleset());
		expect(config).toMatchObject({
			requiredReviewCount: 2,
			dismissStaleReviews: true,
			requireCodeOwnerReviews: true,
			requireLastPushApproval: true,
			requireConversationResolution: true,
			requiredLinearHistory: true,
			allowsDeletions: false,
			allowsForcePushes: false,
			requiredStatusChecks: ["ci"],
			strictStatusChecks: true,
		});
	});
});

describe("bootstrapBranchProtectionFromRulesets", () => {
	it("bootstraps default-branch and release patterns", () => {
		const bootstrapped = bootstrapBranchProtectionFromRulesets(
			"website",
			[mainRuleset(), releaseRuleset()],
			"main",
		);
		expect(
			Object.keys(bootstrapped).sort((a, b) => a.localeCompare(b)),
		).toEqual(["main", "release/*"]);
		expect(bootstrapped.main?.requiredReviewCount).toBe(2);
	});

	it("skips disabled rulesets and non-matching repos", () => {
		const ruleset = mainRuleset({
			enforcement: "disabled",
			conditions: {
				refName: { includes: ["~DEFAULT_BRANCH"] },
				repositoryName: { includes: ["website"], excludes: [] },
			},
		});
		expect(
			bootstrapBranchProtectionFromRulesets("org-ci", [ruleset], "main"),
		).toEqual({});
	});
});

describe("mergeRepoBranchProtection", () => {
	const repo = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
		name: "website",
		description: "d",
		...overrides,
	});

	it("returns only explicit config when bootstrap is off", () => {
		const merged = mergeRepoBranchProtection(
			repo({
				branchProtection: { main: { requiredReviewCount: 1 } },
			}),
			[mainRuleset()],
			"main",
			false,
		);
		expect(merged).toEqual({ main: { requiredReviewCount: 1 } });
	});

	it("bootstraps from rulesets and lets repo overrides win", () => {
		const merged = mergeRepoBranchProtection(
			repo({
				branchProtection: {
					main: { requiredStatusChecks: ["build"] },
				},
			}),
			[mainRuleset()],
			"main",
			true,
		);
		expect(merged.main).toMatchObject({
			requiredReviewCount: 2,
			requiredStatusChecks: ["build"],
		});
	});
});
