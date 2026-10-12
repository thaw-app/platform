import type { DependabotDefaults, DependabotEntry } from "@/types";

// The name of the one group every ecosystem joins. It appears in the pull
// request's title and branch.
const GROUP = "dependencies";

// JSON's string form is also a YAML double-quoted scalar, so a quote or a
// backslash in a value cannot break the file.
const list = (key: string, items: string[]) =>
	items.length
		? [`    ${key}:`, ...items.map((i) => `      - ${JSON.stringify(i)}`)]
		: [];

// Every ecosystem joins one multi-ecosystem group, so a week's version
// updates arrive as a single pull request, major bumps included. The
// schedule, labels and assignees belong to the group; an ecosystem only says
// which of its dependencies take part.
export function renderDependabot(
	entries: DependabotEntry[],
	defaults: DependabotDefaults,
): string {
	if (entries.length === 0) return "";

	const group = [
		`  ${GROUP}:`,
		"    schedule:",
		`      interval: "${defaults.interval}"`,
		...(defaults.day ? [`      day: "${defaults.day}"`] : []),
		...list("labels", defaults.labels),
		...list("assignees", defaults.assignees),
	].join("\n");

	const blocks = entries.map((entry) =>
		[
			`  - package-ecosystem: "${typeof entry === "string" ? entry : entry.ecosystem}"`,
			...(typeof entry === "string"
				? ['    directory: "/"']
				: list("directories", entry.directories)),
			`    open-pull-requests-limit: ${defaults.openPullRequestsLimit}`,
			"    patterns:",
			'      - "*"',
			`    multi-ecosystem-group: "${GROUP}"`,
		].join("\n"),
	);

	return [
		"# Synced from thaw-app/platform. Edit config/repos.yaml there.",
		"version: 2",
		"multi-ecosystem-groups:",
		group,
		"",
		"updates:",
		blocks.join("\n\n"),
		"",
	].join("\n");
}
