import pulumi from "@pulumi/pulumi";
import {
	createRulesets,
	createTeamMemberships,
	createTeams,
	OrgRepository,
} from "@/resources";
import {
	assertReviewerTeamsCreatable,
	buildRepoConfig,
	initConfig,
	resolveTeamAccess,
} from "@/setup";

export default async function setupOrg() {
	const { org, repos, teams, rulesets, labels, codeownersContent } =
		initConfig();
	const { defaults, organization } = org;

	const pulumiConfig = new pulumi.Config();
	const enableTeams = pulumiConfig.getBoolean("enableTeams") ?? true;
	const enableRulesets = pulumiConfig.getBoolean("enableRulesets") ?? true;

	assertReviewerTeamsCreatable(repos, enableTeams);

	const teamResources = enableTeams ? createTeams(teams) : {};
	if (enableTeams) createTeamMemberships(teams, teamResources);
	if (enableRulesets) createRulesets(rulesets);

	for (const repo of repos) {
		const teamAccess = enableTeams
			? resolveTeamAccess(repo.name, teams.repoAccess, teamResources)
			: [];
		const resolved = buildRepoConfig(repo, {
			defaults,
			teamAccess,
			labels,
			organization,
			codeownersContent,
		});
		new OrgRepository(resolved.name, resolved, teamResources); // NOSONAR
	}
}
