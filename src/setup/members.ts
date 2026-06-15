import type {
	MembersFile,
	TeamConfig,
	TeamMemberConfig,
	TeamsConfig,
	TeamsFile,
} from "@/types";

/** Fold members.yaml into the team-centric shape the resource layer expects. */
export function mergeTeamMemberships(
	teamsFile: TeamsFile,
	membersFile: MembersFile,
): TeamsConfig {
	const membersByTeam = new Map<string, TeamMemberConfig[]>(
		teamsFile.teams.map((team) => [team.slug, []]),
	);

	for (const { username, teams } of membersFile.members) {
		for (const { slug, role } of teams) {
			const bucket = membersByTeam.get(slug);
			if (!bucket) continue; // cross-ref validation reports unknown slugs
			bucket.push({ username, role });
		}
	}

	const teams: TeamConfig[] = teamsFile.teams.map((team) => {
		const members = membersByTeam.get(team.slug);
		return members?.length ? { ...team, members } : team;
	});

	return { teams, repoAccess: teamsFile.repoAccess };
}
