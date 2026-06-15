import { groupBy } from "es-toolkit";
import * as v from "valibot";
import { LabelSetSchema } from "./label";
import {
	MergeStrategySchema,
	RepoConfigSchema,
	RepoVisibilitySchema,
	SquashMergeCommitMessageSchema,
	SquashMergeCommitTitleSchema,
} from "./repo";
import { TeamsConfigSchema } from "./team";

export function findDuplicates(values: string[]): string[] {
	const groups = groupBy(values, (item) => item);
	return Object.entries(groups)
		.filter(([, items]) => items.length > 1)
		.map(([key]) => key);
}

const OrgFeaturesSchema = v.strictObject({
	issues: v.boolean(),
	wiki: v.boolean(),
	projects: v.boolean(),
	discussions: v.boolean(),
});

const OrgDefaultsSchema = v.strictObject({
	visibility: RepoVisibilitySchema,
	defaultBranch: v.string(),
	deleteBranchOnMerge: v.boolean(),
	mergeStrategies: v.array(MergeStrategySchema),
	squashMergeCommitTitle: v.optional(SquashMergeCommitTitleSchema, "PR_TITLE"),
	squashMergeCommitMessage: v.optional(
		SquashMergeCommitMessageSchema,
		"COMMIT_MESSAGES",
	),
	features: OrgFeaturesSchema,
});

export const OrgConfigSchema = v.strictObject({
	owner: v.string(),
	organization: v.string(),
	defaults: OrgDefaultsSchema,
});

export const LabelGroupsSchema = v.record(v.string(), LabelSetSchema);

const ReposArraySchema = v.array(RepoConfigSchema);

export const ReposFileSchema = v.pipe(
	v.strictObject({ repos: ReposArraySchema }),
	v.rawCheck(({ dataset, addIssue }) => {
		if (!dataset.typed) return;
		for (const dup of findDuplicates(dataset.value.repos.map((r) => r.name))) {
			addIssue({
				message: `duplicate repo name "${dup}"`,
				path: [
					{
						type: "object",
						origin: "value",
						input: dataset.value,
						key: "repos",
						value: dataset.value.repos,
					},
				],
			});
		}
	}),
);

const RulesetPullRequestSchema = v.strictObject({
	requiredApprovingReviewCount: v.optional(v.number()),
	dismissStaleReviewsOnPush: v.optional(v.boolean()),
	requireCodeOwnerReview: v.optional(v.boolean()),
	requireLastPushApproval: v.optional(v.boolean()),
});

const RulesetRequiredStatusChecksSchema = v.strictObject({
	requiredChecks: v.optional(v.array(v.strictObject({ context: v.string() }))),
	strictRequiredStatusChecksPolicy: v.optional(v.boolean()),
});

const RulesetRulesSchema = v.strictObject({
	requiredLinearHistory: v.optional(v.boolean()),
	deletion: v.optional(v.boolean()),
	nonFastForward: v.optional(v.boolean()),
	pullRequest: v.optional(RulesetPullRequestSchema),
	requiredStatusChecks: v.optional(RulesetRequiredStatusChecksSchema),
});

const RulesetConditionsSchema = v.strictObject({
	refName: v.strictObject({
		includes: v.array(v.string()),
		excludes: v.optional(v.array(v.string())),
	}),
	repositoryName: v.optional(
		v.strictObject({
			includes: v.optional(v.array(v.string()), ["~ALL"]),
			excludes: v.optional(v.array(v.string()), []),
		}),
	),
});

export const RulesetConfigSchema = v.strictObject({
	id: v.string(),
	name: v.optional(v.string()),
	target: v.picklist(["branch", "tag", "push"]),
	enforcement: v.optional(
		v.picklist(["active", "disabled", "evaluate"]),
		"active",
	),
	conditions: RulesetConditionsSchema,
	rules: RulesetRulesSchema,
});

const RulesetsArraySchema = v.array(RulesetConfigSchema);

export const RulesetsFileSchema = v.pipe(
	v.strictObject({ rulesets: RulesetsArraySchema }),
	v.rawCheck(({ dataset, addIssue }) => {
		if (!dataset.typed) return;
		for (const dup of findDuplicates(dataset.value.rulesets.map((r) => r.id))) {
			addIssue({
				message: `duplicate ruleset id "${dup}"`,
				path: [
					{
						type: "object",
						origin: "value",
						input: dataset.value,
						key: "rulesets",
						value: dataset.value.rulesets,
					},
				],
			});
		}
	}),
);

export const InfraConfigSchema = v.object({
	org: OrgConfigSchema,
	labels: LabelSetSchema,
	repos: ReposArraySchema,
	rulesets: RulesetsArraySchema,
	teams: TeamsConfigSchema,
});

export type InfraConfig = v.InferOutput<typeof InfraConfigSchema>;
export type OrgConfig = v.InferOutput<typeof OrgConfigSchema>;
export type LabelGroups = v.InferOutput<typeof LabelGroupsSchema>;
export type RulesetConfig = v.InferOutput<typeof RulesetConfigSchema>;
