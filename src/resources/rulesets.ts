import github from "@pulumi/github";
import type { RulesetConfig, RulesetRules } from "@/types";

// Org-wide rulesets apply uniformly (~ALL repos) when enableRulesets is true.
// On Free tier, the same policy in rulesets.yaml is bootstrapped as per-repo
// branch protection (see src/setup/rulesets.ts). Use repos.yaml branchProtection
// only for repo-specific overrides.
//
// GitHub organization rulesets require a Team or Enterprise org plan (404 on Free).

function toPulumiRules(
	rules: RulesetRules,
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

	if (rules.requiredStatusChecks?.enabled) {
		const { requiredChecks, acceptAnyOf, ...rest } = rules.requiredStatusChecks;
		// GitHub treats every required check as mandatory (AND). acceptAnyOf is
		// org-config convention only — use per-repo branchProtection to pin a name.
		const checks = requiredChecks ?? [];
		if (checks.length > 0) {
			pulumiRules.requiredStatusChecks = {
				requiredChecks: checks,
				strictRequiredStatusChecksPolicy:
					rest.strictRequiredStatusChecksPolicy ?? false,
				doNotEnforceOnCreate: rest.doNotEnforceOnCreate ?? false,
			};
		} else if (acceptAnyOf?.length) {
			// enabled + acceptAnyOf: reviews/linear-history still apply; check names
			// are validated in src/setup/validate.ts, not enforced org-wide here.
		}
	}

	if (rules.requiredCodeScanning?.enabled) {
		pulumiRules.requiredCodeScanning = {
			requiredCodeScanningTools:
				rules.requiredCodeScanning.requiredCodeScanningTools ?? [],
		};
	}

	// mergeQueue and requiredDeployments are supported on RepositoryRuleset only
	// in @pulumi/github — org rulesets must enable merge queue via the GitHub UI.

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
				rules: toPulumiRules(rules),
			});
		});
}
