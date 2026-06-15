import * as v from "valibot";
import { findDuplicates } from "./config";
import { TeamMemberRoleSchema } from "./team";

const MemberTeamEntrySchema = v.strictObject({
	slug: v.string(),
	role: TeamMemberRoleSchema,
});

export const MemberEntrySchema = v.strictObject({
	username: v.string(),
	teams: v.array(MemberTeamEntrySchema),
});

export const MembersFileSchema = v.pipe(
	v.strictObject({
		members: v.array(MemberEntrySchema),
	}),
	v.rawCheck(({ dataset, addIssue }) => {
		if (!dataset.typed) return;
		for (const dup of findDuplicates(
			dataset.value.members.map((m) => m.username),
		)) {
			addIssue({
				message: `duplicate username "${dup}"`,
				path: [
					{
						type: "object",
						origin: "value",
						input: dataset.value,
						key: "members",
						value: dataset.value.members,
					},
				],
			});
		}
		for (const member of dataset.value.members) {
			for (const dup of findDuplicates(member.teams.map((t) => t.slug))) {
				addIssue({
					message: `duplicate team "${dup}" for username "${member.username}"`,
					path: [
						{
							type: "object",
							origin: "value",
							input: dataset.value,
							key: "members",
							value: dataset.value.members,
						},
					],
				});
			}
		}
	}),
);

export type MemberEntry = v.InferOutput<typeof MemberEntrySchema>;
export type MembersFile = v.InferOutput<typeof MembersFileSchema>;
