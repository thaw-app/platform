/**
 * Generates JSON Schemas from the valibot config schemas so editors (via the
 * YAML Language Server) get autocomplete + inline validation while editing
 * `config/*.yaml`. Run with `bun run schema`.
 *
 * Note: cross-reference checks expressed with `v.rawCheck` (duplicate repo
 * names, ruleset ids, etc.) can't be represented in JSON Schema and are skipped
 * (`errorMode: "ignore"`). `src/setup/validate.ts` remains the backstop for those.
 */
import { toJsonSchema } from "@valibot/to-json-schema";
import type { BaseIssue, BaseSchema } from "valibot";
import {
	LabelGroupsSchema,
	MembersFileSchema,
	OrgConfigSchema,
	ReposFileSchema,
	RulesetsFileSchema,
	TeamsFileSchema,
} from "@/types";

// biome-ignore lint/suspicious/noExplicitAny: schemas have heterogeneous output types
type AnySchema = BaseSchema<unknown, any, BaseIssue<unknown>>;

const OUT_DIR = `${import.meta.dir}/../config/schema`;

// Each entry maps a `config/*.yaml` file to the schema that validates it.
const targets: Record<string, AnySchema> = {
	org: OrgConfigSchema,
	repos: ReposFileSchema,
	rulesets: RulesetsFileSchema,
	teams: TeamsFileSchema,
	members: MembersFileSchema,
	labels: LabelGroupsSchema,
};

const generateSchema = async () => {
	for (const [name, schema] of Object.entries(targets)) {
		const jsonSchema = toJsonSchema(schema, { errorMode: "ignore" });
		const file = `${OUT_DIR}/${name}.schema.json`;
		await Bun.write(file, `${JSON.stringify(jsonSchema, null, 2)}\n`);
		console.log(`wrote ${file}`);
	}
};

await generateSchema();
