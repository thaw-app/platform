import { describe, expect, it } from "bun:test";
import { renderDependabot } from "@/setup";

const defaults = {
	interval: "weekly",
	day: "monday",
	openPullRequestsLimit: 10,
	labels: ["dependencies"],
	assignees: ["someone"],
} as const;

type Rendered = {
	version: number;
	updates: { labels?: string[]; assignees?: string[] }[];
};

describe("renderDependabot", () => {
	it("writes nothing for a repo with no ecosystems", () => {
		expect(
			renderDependabot([], { ...defaults, labels: [], assignees: [] }),
		).toBe("");
	});

	it("keeps labels that hold quotes, backslashes or YAML syntax", () => {
		const labels = [
			'dependency "updates"',
			"back\\slash",
			"a: b # c",
			"'single'",
		];
		const rendered = renderDependabot(["bun", "github-actions"], {
			...defaults,
			labels,
			assignees: ["someone"],
		});
		const parsed = Bun.YAML.parse(rendered) as Rendered;

		expect(parsed.version).toBe(2);
		expect(parsed.updates).toHaveLength(2);
		for (const update of parsed.updates) {
			expect(update.labels).toEqual(labels);
			expect(update.assignees).toEqual(["someone"]);
		}
	});
});
