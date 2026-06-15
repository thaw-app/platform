import { describe, expect, it } from "bun:test";
import * as v from "valibot";
import {
	LabelDefinitionSchema,
	MembersFileSchema,
	OrgConfigSchema,
	RepoConfigSchema,
	ReposFileSchema,
	RulesetsFileSchema,
	TeamsFileSchema,
} from "@/types";

describe("RepoConfigSchema", () => {
	it("accepts a minimal repo", () => {
		const r = v.safeParse(RepoConfigSchema, { name: "r", description: "d" });
		expect(r.success).toBe(true);
	});

	it("rejects unknown keys (e.g. the removed `template`)", () => {
		const r = v.safeParse(RepoConfigSchema, {
			name: "r",
			description: "d",
			template: "none",
		});
		expect(r.success).toBe(false);
	});
});

describe("LabelDefinitionSchema", () => {
	it("accepts a 6-digit hex color without #", () => {
		expect(
			v.safeParse(LabelDefinitionSchema, { color: "00aaff" }).success,
		).toBe(true);
	});

	it("rejects malformed colors", () => {
		expect(
			v.safeParse(LabelDefinitionSchema, { color: "#00aaff" }).success,
		).toBe(false);
		expect(v.safeParse(LabelDefinitionSchema, { color: "zzzz" }).success).toBe(
			false,
		);
	});
});

describe("OrgConfigSchema", () => {
	it("applies squash-merge defaults when omitted", () => {
		const r = v.safeParse(OrgConfigSchema, {
			owner: "acme",
			organization: "acme-org",
			defaults: {
				visibility: "public",
				defaultBranch: "main",
				deleteBranchOnMerge: true,
				mergeStrategies: ["squash"],
				features: {
					issues: true,
					wiki: false,
					projects: false,
					discussions: false,
				},
			},
		});
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.output.defaults.squashMergeCommitTitle).toBe("PR_TITLE");
			expect(r.output.defaults.squashMergeCommitMessage).toBe(
				"COMMIT_MESSAGES",
			);
		}
	});
});

describe("duplicate detection", () => {
	it("rejects duplicate repo names", () => {
		const r = v.safeParse(ReposFileSchema, {
			repos: [
				{ name: "a", description: "x" },
				{ name: "a", description: "y" },
			],
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(
				r.issues.some((i) => /duplicate repo name "a"/.test(i.message)),
			).toBe(true);
		}
	});

	it("rejects duplicate ruleset ids", () => {
		const ruleset = (id: string) => ({
			id,
			target: "branch",
			conditions: { refName: { includes: ["~DEFAULT_BRANCH"] } },
			rules: {},
		});
		const r = v.safeParse(RulesetsFileSchema, {
			rulesets: [ruleset("dup"), ruleset("dup")],
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(
				r.issues.some((i) => /duplicate ruleset id "dup"/.test(i.message)),
			).toBe(true);
		}
	});

	it("rejects duplicate team slugs", () => {
		const team = (slug: string) => ({ slug, name: slug });
		const r = v.safeParse(TeamsFileSchema, {
			teams: [team("eng"), team("eng")],
			repoAccess: {},
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(
				r.issues.some((i) => /duplicate team slug "eng"/.test(i.message)),
			).toBe(true);
		}
	});

	it("rejects duplicate usernames in members.yaml", () => {
		const r = v.safeParse(MembersFileSchema, {
			members: [
				{ username: "alice", teams: [{ slug: "eng", role: "member" }] },
				{ username: "alice", teams: [{ slug: "eng", role: "maintainer" }] },
			],
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(
				r.issues.some((i) => /duplicate username "alice"/.test(i.message)),
			).toBe(true);
		}
	});

	it("rejects duplicate environment names within a repo", () => {
		const r = v.safeParse(RepoConfigSchema, {
			name: "r",
			description: "d",
			environments: [{ name: "prod" }, { name: "prod" }],
		});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(
				r.issues.some((i) =>
					/duplicate environment name "prod"/.test(i.message),
				),
			).toBe(true);
		}
	});
});
