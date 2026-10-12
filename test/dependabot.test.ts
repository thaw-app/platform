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
	"multi-ecosystem-groups": Record<
		string,
		{
			schedule: { interval: string; day?: string };
			labels?: string[];
			assignees?: string[];
			"open-pull-requests-limit"?: number;
		}
	>;
	updates: {
		"package-ecosystem": string;
		patterns: string[];
		"multi-ecosystem-group": string;
		directory?: string;
		directories?: string[];
		schedule?: unknown;
		groups?: unknown;
		"open-pull-requests-limit"?: number;
	}[];
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
		const group = parsed["multi-ecosystem-groups"].dependencies;
		expect(group?.labels).toEqual(labels);
		expect(group?.assignees).toEqual(["someone"]);
	});

	it("puts every ecosystem in one group, so a week is one pull request", () => {
		const parsed = Bun.YAML.parse(
			renderDependabot(["bun", "github-actions"], {
				...defaults,
				labels: [...defaults.labels],
				assignees: [...defaults.assignees],
			}),
		) as Rendered;

		expect(Object.keys(parsed["multi-ecosystem-groups"])).toEqual([
			"dependencies",
		]);
		expect(parsed["multi-ecosystem-groups"].dependencies?.schedule).toEqual({
			interval: "weekly",
			day: "monday",
		});
		expect(
			parsed["multi-ecosystem-groups"].dependencies?.[
				"open-pull-requests-limit"
			],
		).toBe(10);
		for (const update of parsed.updates) {
			expect(update["multi-ecosystem-group"]).toBe("dependencies");
			// Every dependency takes part, a major bump included.
			expect(update.patterns).toEqual(["*"]);
			expect(update.schedule).toBeUndefined();
			// Dependabot rejects the file when an update in a group sets it.
			expect(update["open-pull-requests-limit"]).toBeUndefined();
			expect(update.groups).toBeUndefined();
		}
	});

	it("checks the directories an ecosystem names, and the root otherwise", () => {
		const parsed = Bun.YAML.parse(
			renderDependabot(
				[
					"bun",
					{ ecosystem: "github-actions", directories: ["/", "/actions/*"] },
				],
				{ ...defaults, labels: [], assignees: [] },
			),
		) as Rendered;

		expect(parsed.updates[0]?.directory).toBe("/");
		expect(parsed.updates[0]?.directories).toBeUndefined();
		expect(parsed.updates[1]?.directory).toBeUndefined();
		expect(parsed.updates[1]?.directories).toEqual(["/", "/actions/*"]);
	});
});
