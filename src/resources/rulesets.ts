import github from "@pulumi/github";
import pulumi from "@pulumi/pulumi";
import { normalizeRulesetRefName } from "@/setup/utils";
import type { RulesetConfig, RulesetRules } from "@/types";

// Org rulesets (enableRulesets: true) apply uniformly when the org is on Team+.
// Per-repo rulesets (enableRulesets: false) mirror the same YAML on each managed
// repo — available on GitHub Free. Use repos.yaml branchProtection only for
// legacy per-pattern overrides (prefer ruleset repositoryName excludes/includes).

function organizationRulesetStatusChecks(
	ruleset: RulesetConfig,
): github.types.input.OrganizationRulesetRulesRequiredStatusChecks | undefined {
	const checks = ruleset.rules.requiredStatusChecks;
	if (!checks?.enabled || !checks.requiredChecks?.length) return undefined;

	return {
		requiredChecks: checks.requiredChecks,
		strictRequiredStatusChecksPolicy:
			checks.strictRequiredStatusChecksPolicy ?? false,
		doNotEnforceOnCreate: checks.doNotEnforceOnCreate ?? false,
	};
}

function repositoryRulesetStatusChecks(
	ruleset: RulesetConfig,
): github.types.input.RepositoryRulesetRulesRequiredStatusChecks | undefined {
	const checks = ruleset.rules.requiredStatusChecks;
	if (!checks?.enabled) return undefined;

	if (checks.requiredChecks?.length) {
		return {
			requiredChecks: checks.requiredChecks,
			strictRequiredStatusChecksPolicy:
				checks.strictRequiredStatusChecksPolicy ?? false,
			doNotEnforceOnCreate: checks.doNotEnforceOnCreate ?? false,
		};
	}

	const pinned = checks.acceptAnyOf?.[0];
	if (!pinned) return undefined;

	return {
		requiredChecks: [{ context: pinned }],
		strictRequiredStatusChecksPolicy:
			checks.strictRequiredStatusChecksPolicy ?? false,
		doNotEnforceOnCreate: checks.doNotEnforceOnCreate ?? false,
	};
}

function toOrganizationRulesetRules(
	rules: RulesetRules,
	ruleset: RulesetConfig,
): github.types.input.OrganizationRulesetRules {
	const pullRequest = rules.pullRequest
		? {
				...rules.pullRequest,
				allowedMergeMethods: rules.pullRequest.allowedMergeMethods,
				requiredReviewThreadResolution:
					rules.pullRequest.requiredReviewThreadResolution,
			}
		: undefined;

	const pulumiRules: Record<string, unknown> = {
		creation: rules.creation,
		update: rules.update,
		deletion: rules.deletion,
		nonFastForward: rules.nonFastForward,
		requiredLinearHistory: rules.requiredLinearHistory,
		requiredSignatures: rules.requiredSignatures,
		copilotCodeReview: rules.copilotCodeReview,
		pullRequest,
	};

	const statusChecks = organizationRulesetStatusChecks(ruleset);
	if (statusChecks) {
		pulumiRules.requiredStatusChecks = statusChecks;
	}

	if (rules.requiredCodeScanning?.enabled) {
		pulumiRules.requiredCodeScanning = {
			requiredCodeScanningTools:
				rules.requiredCodeScanning.requiredCodeScanningTools ?? [],
		};
	}

	return pulumiRules;
}

function toRepositoryRulesetRules(
	rules: RulesetRules,
	ruleset: RulesetConfig,
): github.types.input.RepositoryRulesetRules {
	const pulumiRules: github.types.input.RepositoryRulesetRules = {
		...toOrganizationRulesetRules(rules, ruleset),
	};

	const statusChecks = repositoryRulesetStatusChecks(ruleset);
	if (statusChecks) {
		pulumiRules.requiredStatusChecks = statusChecks;
	} else {
		delete pulumiRules.requiredStatusChecks;
	}

	if (rules.mergeQueue?.enabled) {
		pulumiRules.mergeQueue = {
			mergeMethod: rules.mergeQueue.mergeMethod,
			groupingStrategy: rules.mergeQueue.groupingStrategy,
		};
	}

	if (rules.requiredDeployments?.enabled) {
		pulumiRules.requiredDeployments = {
			requiredDeploymentEnvironments:
				rules.requiredDeployments.requiredDeploymentEnvironments ?? [],
		};
	}

	return pulumiRules;
}

export function createRulesets(
	rulesets: RulesetConfig[],
): github.OrganizationRuleset[] {
	return rulesets
		.filter((r) => r.enforcement !== "disabled")
		.map((r) => {
			const { id, name, target, enforcement, conditions, rules } = r;

			return new github.OrganizationRuleset(id, {
				name: name ?? id,
				target,
				enforcement,
				conditions: {
					refName: {
						includes: conditions.refName.includes,
						excludes: conditions.refName.excludes ?? [],
					},
					repositoryName: {
						includes: conditions.repositoryName?.includes ?? ["~ALL"],
						excludes: conditions.repositoryName?.excludes ?? [],
					},
				},
				rules: toOrganizationRulesetRules(rules, r),
			});
		});
}

export function createRepositoryRulesets(
	resourcePrefix: string,
	repo: github.Repository,
	rulesets: RulesetConfig[],
	_defaultBranch: string,
	opts?: pulumi.ResourceOptions,
): github.RepositoryRuleset[] {
	return rulesets.map((r) => {
		const refIncludes = r.conditions.refName.includes.map(
			normalizeRulesetRefName,
		);
		const refExcludes = (r.conditions.refName.excludes ?? []).map(
			normalizeRulesetRefName,
		);

		return new github.RepositoryRuleset(
			`${resourcePrefix}-rs-${r.id}`,
			{
				name: r.name ?? r.id,
				repository: repo.name,
				target: r.target,
				enforcement: r.enforcement,
				conditions: {
					refName: {
						includes: refIncludes,
						excludes: refExcludes,
					},
				},
				rules: toRepositoryRulesetRules(r.rules, r),
			},
			pulumi.mergeOptions(
				{ dependsOn: [repo], deleteBeforeReplace: true },
				opts ?? {},
			),
		);
	});
}
