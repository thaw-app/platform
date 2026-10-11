import type { DependabotDefaults, DependabotEcosystem } from "@/types";

// JSON's string form is also a YAML double-quoted scalar, so a quote or a
// backslash in a value cannot break the file.
const list = (key: string, items: string[]) =>
	items.length
		? [`    ${key}:`, ...items.map((i) => `      - ${JSON.stringify(i)}`)]
		: [];

// One update block per ecosystem. Minor and patch bumps arrive as one pull
// request a week; a major bump gets its own, so one breaking upgrade cannot
// hold back the rest.
export function renderDependabot(
	ecosystems: DependabotEcosystem[],
	defaults: DependabotDefaults,
): string {
	if (ecosystems.length === 0) return "";

	const blocks = ecosystems.map((ecosystem) =>
		[
			`  - package-ecosystem: "${ecosystem}"`,
			'    directory: "/"',
			"    schedule:",
			`      interval: "${defaults.interval}"`,
			...(defaults.day ? [`      day: "${defaults.day}"`] : []),
			`    open-pull-requests-limit: ${defaults.openPullRequestsLimit}`,
			...list("labels", defaults.labels),
			...list("assignees", defaults.assignees),
			"    groups:",
			`      ${ecosystem}:`,
			"        patterns:",
			'          - "*"',
			"        update-types:",
			'          - "minor"',
			'          - "patch"',
		].join("\n"),
	);

	return [
		"# Synced from thaw-app/platform. Edit config/repos.yaml there.",
		"version: 2",
		"updates:",
		blocks.join("\n\n"),
		"",
	].join("\n");
}
