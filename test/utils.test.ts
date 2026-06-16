import { describe, expect, it } from "bun:test";
import {
	assertReviewerTeamsCreatable,
	normalizeActors,
	normalizeBranchPattern,
	normalizeRulesetRefName,
} from "@/setup";
import type { RepoConfig } from "@/types";

describe("normalizeBranchPattern", () => {
	it("expands ~DEFAULT_BRANCH to the default branch", () => {
		expect(normalizeBranchPattern("~DEFAULT_BRANCH", "main")).toBe("main");
		expect(normalizeBranchPattern("~DEFAULT_BRANCH", "trunk")).toBe("trunk");
	});

	it("strips the refs/heads/ prefix", () => {
		expect(normalizeBranchPattern("refs/heads/release/*", "main")).toBe(
			"release/*",
		);
		expect(normalizeBranchPattern("refs/heads/main", "main")).toBe("main");
	});

	it("leaves bare patterns untouched", () => {
		expect(normalizeBranchPattern("main", "main")).toBe("main");
		expect(normalizeBranchPattern("feature/*", "main")).toBe("feature/*");
	});
});

describe("normalizeRulesetRefName", () => {
	it("passes through ruleset magic tokens and refs/heads patterns", () => {
		expect(normalizeRulesetRefName("~DEFAULT_BRANCH")).toBe("~DEFAULT_BRANCH");
		expect(normalizeRulesetRefName("~ALL")).toBe("~ALL");
		expect(normalizeRulesetRefName("refs/heads/release/*")).toBe(
			"refs/heads/release/*",
		);
	});

	it("prefixes bare branch patterns for the ruleset API", () => {
		expect(normalizeRulesetRefName("main")).toBe("refs/heads/main");
		expect(normalizeRulesetRefName("release/*")).toBe("refs/heads/release/*");
	});
});

describe("normalizeActors", () => {
	it("returns an empty array for empty input", () => {
		expect(normalizeActors([], "acme")).toEqual([]);
	});

	it("qualifies bare team slugs with the org", () => {
		expect(normalizeActors(["maintainers"], "acme")).toEqual([
			"acme/maintainers",
		]);
	});

	it("leaves already-qualified actors untouched", () => {
		expect(normalizeActors(["other-org/team"], "acme")).toEqual([
			"other-org/team",
		]);
	});

	it("throws for whitespace-only actors", () => {
		expect(() => normalizeActors(["  "], "acme")).toThrow(/invalid actor/);
	});
});

describe("assertReviewerTeamsCreatable", () => {
	const repo = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
		name: "a",
		description: "d",
		...overrides,
	});

	it("allows reviewer-team environments when teams are enabled", () => {
		expect(() =>
			assertReviewerTeamsCreatable(
				[
					repo({
						environments: [
							{ name: "prod", requiredReviewerTeamSlugs: ["maintainers"] },
						],
					}),
				],
				true,
			),
		).not.toThrow();
	});

	it("allows empty environments when teams are disabled", () => {
		expect(() => assertReviewerTeamsCreatable([repo()], false)).not.toThrow();
	});

	it("allows environments with empty reviewer slugs when teams are disabled", () => {
		expect(() =>
			assertReviewerTeamsCreatable(
				[
					repo({
						environments: [{ name: "prod", requiredReviewerTeamSlugs: [] }],
					}),
				],
				false,
			),
		).not.toThrow();
	});

	it("throws for all offending environments when teams are disabled", () => {
		expect(() =>
			assertReviewerTeamsCreatable(
				[
					repo({
						name: "a",
						environments: [
							{ name: "prod", requiredReviewerTeamSlugs: ["maintainers"] },
						],
					}),
					repo({
						name: "b",
						environments: [
							{ name: "staging", requiredReviewerTeamSlugs: ["reviewers"] },
						],
					}),
				],
				false,
			),
		).toThrow(
			/repos\.a\.environments\.prod[\s\S]*repos\.b\.environments\.staging/,
		);
	});
});
