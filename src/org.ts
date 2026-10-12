import pulumi from "@pulumi/pulumi";
import {
	createRulesets,
	createTeamMemberships,
	createTeams,
	defaultBranchHasDependabot,
	OrgRepository,
} from "@/resources";
import {
	assertOrgRulesetsSupported,
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
	if (enableRulesets) assertOrgRulesetsSupported(repos, rulesets);

	const teamResources = enableTeams ? createTeams(teams) : {};
	if (enableTeams) createTeamMemberships(teams, teamResources);
	if (enableRulesets) createRulesets(rulesets);

	const resolvedRepos = await Promise.all(
		repos.map(async (repo) => {
			const teamAccess = enableTeams
				? resolveTeamAccess(repo.name, teams.repoAccess, teamResources)
				: [];
			const resolved = buildRepoConfig(repo, {
				defaults,
				teamAccess,
				labels,
				organization,
				codeownersContent,
				rulesets,
				provisionRepoRulesets: !enableRulesets,
			});
			// A pull request is opened only while the default branch differs,
			// so one that has been merged is not opened again.
			const merged =
				resolved.dependabotByPullRequest &&
				resolved.dependabotContent !== "" &&
				(await defaultBranchHasDependabot(
					resolved.name,
					resolved.defaultBranch,
					resolved.dependabotContent,
				));
			return merged ? { ...resolved, dependabotContent: "" } : resolved;
		}),
	);

	for (const resolved of resolvedRepos) {
		new OrgRepository(resolved.pulumiName, resolved, teamResources); // NOSONAR
	}
}
