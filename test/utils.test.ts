import { describe, expect, it } from "bun:test";
import {
	assertReviewerTeamsCreatable,
	branchPatternCovers,
	normalizeActors,
	normalizeBranchPattern,
	normalizeRulesetRefName,
} from "@/setup";
import type { RepoConfig } from "@/types";

describe("branchPatternCovers", () => {
	const covers = (pattern: string, branch = "main") =>
		branchPatternCovers(pattern, branch, "main");

	it("matches the names GitHub's special tokens stand for", () => {
		expect(covers("~ALL")).toBe(true);
		expect(covers("~DEFAULT_BRANCH")).toBe(true);
		expect(covers("~DEFAULT_BRANCH", "release")).toBe(false);
		expect(covers("refs/heads/main")).toBe(true);
	});

	it("keeps * and ? within one path segment", () => {
		expect(covers("ma*")).toBe(true);
		expect(covers("*")).toBe(true);
		expect(covers("mai?")).toBe(true);
		expect(covers("*", "release/v1")).toBe(false);
		expect(covers("release/*", "release/v1")).toBe(true);
		expect(covers("release/*")).toBe(false);
	});

	it("lets ** span segments, including none", () => {
		expect(covers("**/*")).toBe(true);
		expect(covers("**")).toBe(true);
		expect(covers("**/main")).toBe(true);
		expect(covers("**/*", "release/v1")).toBe(true);
		expect(covers("release/**", "release/v1/hotfix")).toBe(true);
		expect(covers("release/**")).toBe(false);
	});

	it("reads character classes", () => {
		expect(covers("m[ai]in")).toBe(true);
		expect(covers("m[!a]in")).toBe(false);
		expect(covers("[a-m]ain")).toBe(true);
		expect(covers("m[xyz]in")).toBe(false);
	});

	it("takes other punctuation literally", () => {
		expect(covers("ma.n")).toBe(false);
		expect(covers("v1.0", "v1.0")).toBe(true);
		expect(covers("v1.0", "v1x0")).toBe(false);
		expect(covers("a+b", "a+b")).toBe(true);
		expect(covers(String.raw`ma\*n`, "ma*n")).toBe(true);
		expect(covers(String.raw`ma\*n`)).toBe(false);
		expect(covers("ma[in", "ma[in")).toBe(true);
	});
});

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

	it("prefixes bare patterns as tags in a tag ruleset", () => {
		expect(normalizeRulesetRefName("v*", "tag")).toBe("refs/tags/v*");
		expect(normalizeRulesetRefName("refs/tags/v1", "tag")).toBe("refs/tags/v1");
		expect(normalizeRulesetRefName("~ALL", "tag")).toBe("~ALL");
		expect(normalizeRulesetRefName("main", "push")).toBe("refs/heads/main");
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
