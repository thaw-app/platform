import {
	codeowners,
	labels,
	members,
	org,
	repos,
	rulesets,
	teams,
} from "@config/index";
import * as v from "valibot";
import {
	CodeownersFileSchema,
	type InfraConfig,
	LabelGroupsSchema,
	MembersFileSchema,
	OrgConfigSchema,
	ReposFileSchema,
	RulesetsFileSchema,
	TeamsFileSchema,
} from "@/types";
import { mergeTeamMemberships } from "./members";
import type { ValidationIssue } from "./types";
import { validateCrossRefs, validateMemberRefs } from "./validate";

type Schema<T> = v.BaseSchema<unknown, T, v.BaseIssue<unknown>>;

function parse<T>(schema: Schema<T>, data: unknown, file: string): T {
	const { success, issues, output } = v.safeParse(schema, data);
	if (!success) {
		const msg = issues
			.map((i) => {
				const path = i.path?.map((p) => String(p.key)).join(".") ?? "root";
				return `${path}: ${i.message}`;
			})
			.join("; ");
		throw new Error(`Invalid ${file}: ${msg}`);
	}
	return output;
}

function reportIssues(issues: ValidationIssue[]) {
	const errors = issues.filter((i) => i.severity === "error");
	const warnings = issues.filter((i) => i.severity === "warning");
	for (const w of warnings) {
		console.warn(`config warning — ${w.path}: ${w.message}`);
	}
	if (errors.length > 0) {
		const body = errors.map((i) => `- ${i.path}: ${i.message}`).join("\n");
		throw new Error(`Config validation failed:\n${body}`);
	}
}

export function loadConfig(): InfraConfig {
	const labelGroups = parse(LabelGroupsSchema, labels, "labels.yaml");
	const parsedOrg = parse(OrgConfigSchema, org, "org.yaml");
	const { repos: parsedRepos } = parse(ReposFileSchema, repos, "repos.yaml");
	const { rulesets: parsedRulesets } = parse(
		RulesetsFileSchema,
		rulesets,
		"rulesets.yaml",
	);
	const parsedTeamsFile = parse(TeamsFileSchema, teams, "teams.yaml");
	const parsedMembers = parse(MembersFileSchema, members, "members.yaml");
	const { content: codeownersContent } = parse(
		CodeownersFileSchema,
		codeowners,
		"codeowners.yaml",
	);

	const memberIssues = validateMemberRefs(parsedTeamsFile, parsedMembers);
	reportIssues(memberIssues);

	const parsedTeams = mergeTeamMemberships(parsedTeamsFile, parsedMembers);

	const config: InfraConfig = {
		org: parsedOrg,
		repos: parsedRepos,
		teams: parsedTeams,
		rulesets: parsedRulesets,
		labels: Object.assign({}, ...Object.values(labelGroups)),
		codeownersContent,
	};

	const issues = validateCrossRefs(config, labelGroups);
	reportIssues(issues);

	return config;
}

export function initConfig(): InfraConfig {
	try {
		return loadConfig();
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
