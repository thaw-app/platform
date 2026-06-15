import { describe, expect, it } from "bun:test";
import { mergeTeamMemberships } from "@/setup/members";
import { validateMemberRefs } from "@/setup/validate";
import type { MembersFile, TeamsFile } from "@/types";

const teamsFile = (): TeamsFile => ({
	teams: [
		{ slug: "maintainers", name: "Maintainers" },
		{ slug: "contributors", name: "Contributors" },
	],
	repoAccess: {},
});

describe("mergeTeamMemberships", () => {
	it("folds member-centric YAML into team members arrays", () => {
		const members: MembersFile = {
			members: [
				{
					username: "alice",
					teams: [
						{ slug: "maintainers", role: "maintainer" },
						{ slug: "contributors", role: "member" },
					],
				},
				{ username: "bob", teams: [{ slug: "contributors", role: "member" }] },
			],
		};

		const merged = mergeTeamMemberships(teamsFile(), members);
		expect(merged.teams[0]?.members).toEqual([
			{ username: "alice", role: "maintainer" },
		]);
		expect(merged.teams[1]?.members).toEqual([
			{ username: "alice", role: "member" },
			{ username: "bob", role: "member" },
		]);
	});

	it("omits members key when a team has no members", () => {
		const merged = mergeTeamMemberships(teamsFile(), { members: [] });
		expect(merged.teams[0]).not.toHaveProperty("members");
	});
});

describe("validateMemberRefs", () => {
	it("flags unknown team slugs in members.yaml", () => {
		const issues = validateMemberRefs(teamsFile(), {
			members: [
				{ username: "alice", teams: [{ slug: "unknown", role: "member" }] },
			],
		});
		expect(issues).toHaveLength(1);
		expect(issues[0]?.path).toBe("members.0.teams.0.slug");
	});
});
