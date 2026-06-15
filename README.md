# Thaw Platform

[![CI/CD](https://github.com/thaw-app/thaw-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/thaw-app/thaw-platform/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=thaw-app_thaw-platform&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=thaw-app_thaw-platform)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=thaw-app_thaw-platform&metric=coverage)](https://sonarcloud.io/summary/new_code?id=thaw-app_thaw-platform)

Platform configuration for the [`thaw-app`](https://github.com/thaw-app) GitHub organization — repositories, teams, branch rulesets, labels, and CODEOWNERS — declared in YAML under [`config/`](config/) and provisioned with
[Pulumi](https://www.pulumi.com/) + the [`@pulumi/github`](https://www.pulumi.com/registry/packages/github/)
provider. Runs on [Bun](https://bun.sh/).

This repository is the **control plane** for that org: it lives at [`thaw-app/thaw-platform`](https://github.com/thaw-app/thaw-platform), is not listed in [`config/repos.yaml`](config/repos.yaml), and is not provisioned by its own Pulumi program.

## How it works

```text
config/*.yaml ──parse/validate──▶ resolve defaults ──▶ Pulumi resources
   (valibot)         (src/setup)        (src/setup)       (src/resources)
```

1. **Load & validate** — [`src/setup/loader.ts`](src/setup/loader.ts) parses each YAML
   file against a [valibot](https://valibot.dev/) schema in [`src/types/`](src/types/),
   then runs cross-reference checks ([`src/setup/validate.ts`](src/setup/validate.ts)):
   unknown team/repo references, branch patterns claimed by multiple rulesets, and
   labels defined in multiple groups.
2. **Resolve** — [`src/setup/resolve.ts`](src/setup/resolve.ts) fills each repo in from
   org-wide `defaults` and translates config into Pulumi inputs.
3. **Provision** — [`src/org.ts`](src/org.ts) creates teams, org rulesets, and one
   `OrgRepository` component ([`src/resources/repo.ts`](src/resources/repo.ts)) per repo,
   which owns that repo's team access, branch protection, environments, labels, and
   CODEOWNERS file.

Schemas use `strictObject`, so an unknown or misspelled YAML key fails the run instead
of being silently ignored.

> **Branch enforcement:** org **rulesets** ([`config/rulesets.yaml`](config/rulesets.yaml))
> are the source of truth for default-branch policy org-wide. Per-repo `branchProtection`
> is for explicit exceptions only. Org rulesets are gated by the `enableRulesets`
> stack config — set it to `true` once the org is on GitHub Team or Enterprise.

## Config files

| File | Schema | Purpose |
| --- | --- | --- |
| [`config/org.yaml`](config/org.yaml) | `OrgConfigSchema` | Org-wide defaults (visibility, merge strategy, squash commit shaping, feature toggles). |
| [`config/repos.yaml`](config/repos.yaml) | `ReposFileSchema` | Repositories and per-repo overrides (branch protection only for explicit exceptions). |
| [`config/rulesets.yaml`](config/rulesets.yaml) | `RulesetsFileSchema` | Org-level branch/tag/push rulesets. |
| [`config/teams.yaml`](config/teams.yaml) | `TeamsFileSchema` | Teams and per-repo team access. |
| [`config/members.yaml`](config/members.yaml) | `MembersFileSchema` | Org members and their team memberships. |
| [`config/labels.yaml`](config/labels.yaml) | `LabelGroupsSchema` | Issue/PR labels, grouped; applied to every repo. |
| [`config/codeowners.yaml`](config/codeowners.yaml) | `CodeownersFileSchema` | Global CODEOWNERS template synced to `.github/CODEOWNERS` in every managed repo. |

GitHub has no org-level CODEOWNERS file. This repo keeps one canonical template in `config/codeowners.yaml` and Pulumi writes it into each repository on `pulumi up`.

### Editor autocomplete

Each YAML file carries a `# yaml-language-server: $schema=...` header pointing at a
generated JSON Schema in [`config/schema/`](config/schema/). With the
[YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)
(recommended in [`.vscode/extensions.json`](.vscode/extensions.json)) you get
autocomplete and inline validation as you type. Regenerate the schemas after changing a
valibot schema:

```sh
bun run schema
```

## Getting started

**Prerequisites:** [Bun](https://bun.sh/) 1.3+, [Pulumi CLI](https://www.pulumi.com/docs/install/), access to the [`diazdesandi`](https://app.pulumi.com/diazdesandi) Pulumi org, and a GitHub token with `admin:org` (and repo scope for managed repositories).

```sh
bun install
pulumi org set-default diazdesandi
pulumi stack select dev
pulumi config set github:token --secret   # first-time only; already set on the shared stack
pulumi preview                            # dry-run against thaw-app
```

CI authenticates to Pulumi Cloud via OIDC ([`.github/workflows/pulumi.yml`](.github/workflows/pulumi.yml)); local runs need `pulumi login`.

## Common tasks

**Add a repository** — append an entry to `config/repos.yaml` (only `name` and
`description` are required; everything else inherits from `org.yaml` defaults). Grant
team access in `config/teams.yaml` under `repoAccess`.

**Add a team** — add it under `teams:` in `config/teams.yaml`, then reference its `slug`
in `repoAccess` and/or `config/members.yaml`.

**Add a member** — append an entry to `config/members.yaml` with their `username` and
team `slug`/`role` pairs.

**Add a ruleset** — append to `config/rulesets.yaml`. A branch pattern may be owned by
only one ruleset (validation enforces this).

**Add a label** — add it under any group in `config/labels.yaml`. Label names must be
unique across groups.

## Scripts

```sh
bun run typecheck   # tsc --noEmit
bun run check       # biome lint + format check
bun run format      # biome check --write
bun test            # unit tests (setup, resources, schema)
bun run schema      # regenerate config/schema/*.json
pulumi preview      # dry-run (stack dev)
pulumi up           # apply (stack dev)
```

## Stack config

Per-stack settings use the `thaw-config:` namespace (project name from [`Pulumi.yaml`](Pulumi.yaml)):

- `github:owner` / `github:token` — provider credentials (token stored as a secret).
- `thaw-config:enableTeams` (default `true`) — create teams and memberships.
- `thaw-config:enableRulesets` (default `true`) — create org-level rulesets.

### Stack

| Stack | Pulumi account | Purpose | Deployed by | `github:owner` | `enableRulesets` | `enableTeams` | Config file |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dev` | `diazdesandi` (personal) | Governs the live [`thaw-app`](https://github.com/thaw-app) org | [CI/CD](.github/workflows/ci.yml) `deploy` job on push to `main` | `thaw-app` | `false`¹ | `true` | [`Pulumi.dev.yaml`](Pulumi.dev.yaml) |

Pulumi project: **`thaw-config`** (from [`Pulumi.yaml`](Pulumi.yaml)). Stack reference: **`diazdesandi/dev`**. `github:owner` is the **GitHub** org (`thaw-app`), not your Pulumi login. CI and drift detection target **`diazdesandi/dev`** (see [`.github/workflows/pulumi.yml`](.github/workflows/pulumi.yml)).

```sh
pulumi config --stack dev   # inspect thaw-config:* and github:* keys
```

¹ **`enableRulesets: false`** until `thaw-app` is on GitHub Team or Enterprise (org rulesets return **404** on Free). Set it back to `true` after upgrading so [`config/rulesets.yaml`](config/rulesets.yaml) applies. Managed-repo CI jobs may use any of **`ci`**, **`build`**, or **`test`** as the status check name (see `acceptAnyOf` in rulesets).

> **Note:** Organization rulesets need a **GitHub Team or Enterprise** plan. On Free, the API returns **404** and Pulumi cannot create them — upgrade `thaw-app` or keep `enableRulesets: false` and use per-repo branch protection / the GitHub UI until then.

### Drift detection

[`.github/workflows/drift.yml`](.github/workflows/drift.yml) runs weekly (Mondays 06:17 UTC) and on `workflow_dispatch`. It runs `pulumi preview --expect-no-changes` against `dev` — read-only, no state mutation.

**When it fails**, the workflow opens a GitHub issue (deduped by title). Remediate one of two ways:

1. **Keep the change** — update [`config/`](config/), open a PR, merge; CI/CD runs `pulumi up` on `main`.
2. **Reject the change** — revert the manual edit in the GitHub UI, then re-run **Drift detection** via `workflow_dispatch`.

When the check passes again, the `cleanup` job closes any open drift issues automatically.

Some drift is tolerated by design (per-repo ruleset exceptions managed in the GitHub UI — see comment in [`src/resources/rulesets.ts`](src/resources/rulesets.ts)). If weekly noise appears, document or codify those exceptions in config.
