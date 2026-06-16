import { describe, expect, it } from "bun:test";
import {
	mergeRepoBranchProtection,
	rulesetAppliesToRepo,
	rulesetsForRepo,
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

describe("rulesetsForRepo", () => {
	it("returns applicable active rulesets", () => {
		const rulesets = rulesetsForRepo("website", [mainRuleset()]);
		expect(rulesets.map((r) => r.id)).toEqual(["main-default"]);
	});

	it("skips disabled rulesets and non-matching repos", () => {
		const disabled = mainRuleset({
			enforcement: "disabled",
			conditions: {
				refName: { includes: ["~DEFAULT_BRANCH"] },
				repositoryName: { includes: ["website"], excludes: [] },
			},
		});
		expect(rulesetsForRepo("org-ci", [disabled])).toEqual([]);
	});
});

describe("mergeRepoBranchProtection", () => {
	const repo = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
		name: "website",
		description: "d",
		...overrides,
	});

	it("returns only explicit per-repo overrides", () => {
		const merged = mergeRepoBranchProtection(
			repo({
				branchProtection: { main: { requiredReviewCount: 1 } },
			}),
			"main",
		);
		expect(merged).toEqual({ main: { requiredReviewCount: 1 } });
	});

	it("normalizes branch pattern aliases", () => {
		const merged = mergeRepoBranchProtection(
			repo({
				branchProtection: {
					"refs/heads/main": { requiredStatusChecks: ["build"] },
				},
			}),
			"main",
		);
		expect(merged).toEqual({ main: { requiredStatusChecks: ["build"] } });
	});
});
