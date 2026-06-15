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
	requiredReviewThreadResolution: v.optional(v.boolean()),
	allowedMergeMethods: v.optional(
		v.array(v.picklist(["merge", "squash", "rebase"])),
	),
});

const RulesetRequiredStatusChecksSchema = v.pipe(
	v.strictObject({
		enabled: v.boolean(),
		requiredChecks: v.optional(
			v.array(v.strictObject({ context: v.string() })),
		),
		acceptAnyOf: v.optional(v.array(v.string())),
		strictRequiredStatusChecksPolicy: v.optional(v.boolean()),
		doNotEnforceOnCreate: v.optional(v.boolean()),
	}),
	v.rawCheck(({ dataset, addIssue }) => {
		if (!dataset.typed || !dataset.value.enabled) return;
		const { requiredChecks, acceptAnyOf } = dataset.value;
		const hasChecks = (requiredChecks?.length ?? 0) > 0;
		const hasAnyOf = (acceptAnyOf?.length ?? 0) > 0;
		if (hasChecks === hasAnyOf) {
			addIssue({
				message: hasChecks
					? "requiredStatusChecks: set requiredChecks or acceptAnyOf, not both"
					: "requiredStatusChecks: enabled requires requiredChecks or acceptAnyOf",
			});
		}
	}),
);

const RulesetCopilotCodeReviewSchema = v.strictObject({
	reviewDraftPullRequests: v.boolean(),
	reviewOnPush: v.boolean(),
});

const RulesetRequiredCodeScanningSchema = v.strictObject({
	enabled: v.boolean(),
	requiredCodeScanningTools: v.optional(
		v.array(
			v.strictObject({
				tool: v.string(),
				alertsThreshold: v.string(),
				securityAlertsThreshold: v.string(),
			}),
		),
	),
});

const RulesetMergeQueueSchema = v.strictObject({
	enabled: v.boolean(),
	mergeMethod: v.optional(v.picklist(["MERGE", "SQUASH", "REBASE"])),
	groupingStrategy: v.optional(v.picklist(["ALLGREEN", "HEADGREEN"])),
});

const RulesetRequiredDeploymentsSchema = v.strictObject({
	enabled: v.boolean(),
	requiredDeploymentEnvironments: v.optional(v.array(v.string())),
});

export const RulesetRulesSchema = v.strictObject({
	creation: v.boolean(),
	update: v.boolean(),
	deletion: v.boolean(),
	nonFastForward: v.boolean(),
	requiredLinearHistory: v.boolean(),
	requiredSignatures: v.boolean(),
	copilotCodeReview: RulesetCopilotCodeReviewSchema,
	pullRequest: RulesetPullRequestSchema,
	requiredStatusChecks: RulesetRequiredStatusChecksSchema,
	requiredCodeScanning: RulesetRequiredCodeScanningSchema,
	mergeQueue: RulesetMergeQueueSchema,
	requiredDeployments: RulesetRequiredDeploymentsSchema,
});

export type RulesetRules = v.InferOutput<typeof RulesetRulesSchema>;

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
	codeownersContent: v.string(),
});

export type InfraConfig = v.InferOutput<typeof InfraConfigSchema>;
export type OrgConfig = v.InferOutput<typeof OrgConfigSchema>;
export type LabelGroups = v.InferOutput<typeof LabelGroupsSchema>;
export type RulesetConfig = v.InferOutput<typeof RulesetConfigSchema>;
