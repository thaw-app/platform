import type github from "@pulumi/github";
import type pulumi from "@pulumi/pulumi";
import * as v from "valibot";

export const TeamPermissionSchema = v.picklist([
	"pull",
	"triage",
	"push",
	"maintain",
	"admin",
]);

export const TeamMemberRoleSchema = v.picklist(["member", "maintainer"]);

export const TeamMemberConfigSchema = v.strictObject({
	username: v.string(),
	role: TeamMemberRoleSchema,
});

/** Team metadata as declared in teams.yaml (no inline members). */
export const TeamDefinitionSchema = v.strictObject({
	slug: v.string(),
	name: v.string(),
	description: v.optional(v.string()),
	privacy: v.optional(v.picklist(["secret", "closed"])),
});

/** Runtime team shape after members.yaml is merged in. */
export const TeamConfigSchema = v.strictObject({
	slug: v.string(),
	name: v.string(),
	description: v.optional(v.string()),
	privacy: v.optional(v.picklist(["secret", "closed"])),
	members: v.optional(v.array(TeamMemberConfigSchema)),
});

const RepoAccessEntrySchema = v.strictObject({
	team: v.string(),
	permission: TeamPermissionSchema,
});

const teamsFileBase = v.strictObject({
	teams: v.array(TeamDefinitionSchema),
	repoAccess: v.record(v.string(), v.array(RepoAccessEntrySchema)),
});

const teamsConfigBase = v.strictObject({
	teams: v.array(TeamConfigSchema),
	repoAccess: v.record(v.string(), v.array(RepoAccessEntrySchema)),
});

function duplicateTeamSlugCheck<T extends { teams: { slug: string }[] }>() {
	return v.rawCheck<T>(({ dataset, addIssue }) => {
		if (!dataset.typed) return;
		const seen = new Set<string>();
		for (const team of dataset.value.teams) {
			if (seen.has(team.slug)) {
				addIssue({
					message: `duplicate team slug "${team.slug}"`,
					path: [
						{
							type: "object",
							origin: "value",
							input: dataset.value,
							key: "teams",
							value: dataset.value.teams,
						},
					],
				});
			}
			seen.add(team.slug);
		}
	});
}

export const TeamsFileSchema = v.pipe(teamsFileBase, duplicateTeamSlugCheck());

export const TeamsConfigSchema = v.pipe(
	teamsConfigBase,
	duplicateTeamSlugCheck(),
);

export type TeamPermission = v.InferOutput<typeof TeamPermissionSchema>;
export type TeamMemberRole = v.InferOutput<typeof TeamMemberRoleSchema>;
export type TeamMemberConfig = v.InferOutput<typeof TeamMemberConfigSchema>;
export type TeamDefinition = v.InferOutput<typeof TeamDefinitionSchema>;
export type TeamConfig = v.InferOutput<typeof TeamConfigSchema>;
export type TeamsFile = v.InferOutput<typeof TeamsFileSchema>;
export type TeamsConfig = v.InferOutput<typeof TeamsConfigSchema>;
export type TeamResourceMap = Record<string, github.Team>;

export interface TeamAccess {
	slug: string;
	teamId: pulumi.Input<string>;
	permission: TeamPermission;
}
