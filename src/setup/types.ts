import type { LabelSet, OrgConfig, TeamAccess } from "@/types";

export interface ValidationIssue {
	path: string;
	message: string;
	severity: "error" | "warning";
}

export interface RepoBuildContext {
	defaults: OrgConfig["defaults"];
	teamAccess: TeamAccess[];
	labels: LabelSet;
	organization: string;
	codeownersContent: string;
}
