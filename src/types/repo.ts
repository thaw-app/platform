import type { BranchProtectionArgs } from "@pulumi/github/branchProtection";
import * as v from "valibot";
import type { RulesetConfig } from "./config";
import { EnvironmentConfigSchema } from "./environment";
import { LabelSetSchema } from "./label";
import type { TeamAccess } from "./team";

export const RepoVisibilitySchema = v.picklist([
	"public",
	"private",
	"internal",
]);
export const MergeStrategySchema = v.picklist(["merge", "squash", "rebase"]);

// GitHub's allowed values for squash-merge commit shaping.
export const SquashMergeCommitTitleSchema = v.picklist([
	"PR_TITLE",
	"COMMIT_OR_PR_TITLE",
]);
export const SquashMergeCommitMessageSchema = v.picklist([
	"PR_BODY",
	"COMMIT_MESSAGES",
	"BLANK",
]);

// Security features GitHub offers per repository. Org defaults give all four;
// a repo overrides the ones it needs to.
export const SecuritySchema = v.strictObject({
	dependabotAlerts: v.boolean(),
	dependabotSecurityUpdates: v.boolean(),
	secretScanning: v.boolean(),
	pushProtection: v.boolean(),
});

export type SecurityConfig = v.InferOutput<typeof SecuritySchema>;

// Branch protection mirrors BranchProtectionArgs from Pulumi, so it needs no custom schema.
// We only validate the fields users can set in YAML; Pulumi owns the rest.
const BranchProtectionSchema = v.strictObject({
	requiredReviewCount: v.optional(v.number()),
	dismissStaleReviews: v.optional(v.boolean()),
	requireCodeOwnerReviews: v.optional(v.boolean()),
	restrictDismissalsToTeams: v.optional(v.array(v.string())),
	requiredStatusChecks: v.optional(v.array(v.string())),
	strictStatusChecks: v.optional(v.boolean()),
	requireSignedCommits: v.optional(v.boolean()),
	requiredLinearHistory: v.optional(v.boolean()),
	requireConversationResolution: v.optional(v.boolean()),
	requireLastPushApproval: v.optional(v.boolean()),
	allowsForcePushes: v.optional(v.boolean()),
	allowsDeletions: v.optional(v.boolean()),
	enforceAdmins: v.optional(v.boolean()),
});

export type BranchProtectionConfig = v.InferOutput<
	typeof BranchProtectionSchema
>;

// What createBranchProtection receives: Pulumi's args minus the repo/pattern identifiers
export type BranchProtectionEntry = Omit<
	BranchProtectionArgs,
	"repositoryId" | "pattern"
>;

export const RepoConfigSchema = v.pipe(
	v.strictObject({
		name: v.string(),
		description: v.string(),
		visibility: v.optional(RepoVisibilitySchema),
		topics: v.optional(v.array(v.string())),
		homepage: v.optional(v.string()),
		mergeStrategies: v.optional(v.array(MergeStrategySchema)),
		deleteBranchOnMerge: v.optional(v.boolean()),
		autoInit: v.optional(v.boolean()),
		adopt: v.optional(v.boolean()),
		pulumiName: v.optional(v.string()),
		archived: v.optional(v.boolean()),
		bare: v.optional(v.boolean()),
		hasIssues: v.optional(v.boolean()),
		hasWiki: v.optional(v.boolean()),
		hasProjects: v.optional(v.boolean()),
		hasDiscussions: v.optional(v.boolean()),
		security: v.optional(v.partial(SecuritySchema)),
		labels: v.optional(LabelSetSchema),
		// CODEOWNERS content for this repo, in place of the org template. A
		// bare repo gets no CODEOWNERS unless it sets this.
		codeowners: v.optional(v.string()),
		// The checks this repo's CI reports. A ruleset on the repo that requires
		// status checks requires these, since job names differ per repo.
		requiredStatusChecks: v.optional(v.array(v.string())),
		branchProtection: v.optional(v.record(v.string(), BranchProtectionSchema)),
		environments: v.optional(v.array(EnvironmentConfigSchema)),
	}),
	v.rawCheck(({ dataset, addIssue }) => {
		if (!dataset.typed) return;
		const seen = new Set<string>();
		for (const env of dataset.value.environments ?? []) {
			if (seen.has(env.name)) {
				addIssue({
					message: `duplicate environment name "${env.name}"`,
					path: [
						{
							type: "object",
							origin: "value",
							input: dataset.value,
							key: "environments",
							value: dataset.value.environments,
						},
					],
				});
			}
			seen.add(env.name);
		}
	}),
);

export type RepoConfig = v.InferOutput<typeof RepoConfigSchema>;

export interface ResolvedRepoConfig
	extends Omit<
		RepoConfig,
		| "visibility"
		| "mergeStrategies"
		| "deleteBranchOnMerge"
		| "hasIssues"
		| "hasWiki"
		| "hasProjects"
		| "hasDiscussions"
		| "security"
	> {
	visibility: RepoVisibility;
	mergeStrategies: MergeStrategy[];
	deleteBranchOnMerge: boolean;
	hasIssues: boolean;
	hasWiki: boolean;
	hasProjects: boolean;
	hasDiscussions: boolean;
	security: SecurityConfig;
	teams: TeamAccess[];
	resolvedRepoRulesets: RulesetConfig[];
	resolvedBranchProtection: Record<string, BranchProtectionEntry>;
	squashMergeCommitTitle: SquashMergeCommitTitle;
	squashMergeCommitMessage: SquashMergeCommitMessage;
	defaultBranch: string;
	codeownersContent: string;
	pulumiName: string;
	organization: string;
}

export type RepoVisibility = v.InferOutput<typeof RepoVisibilitySchema>;
export type MergeStrategy = v.InferOutput<typeof MergeStrategySchema>;
export type SquashMergeCommitTitle = v.InferOutput<
	typeof SquashMergeCommitTitleSchema
>;
export type SquashMergeCommitMessage = v.InferOutput<
	typeof SquashMergeCommitMessageSchema
>;
