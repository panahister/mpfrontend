# Release guide

MP Frontend releases its sixteen packages to the public npm registry under the `@mpfrontend` scope, as one cohort
under one version, by the release workflow `.github/workflows/release.yml`. This guide describes how a release is
prepared, rehearsed and published, what the owner does on npmjs.com and GitHub, and how a release is checked and
corrected. [README "Versioning"](../README.md#versioning) states the version and compatibility policy.

`0.1.0` is the first release: one stable cohort version that ranks above every `0.1.0-dev.N` archive packed before it.
It was published on 2026-10-12; its record is [releases/0.1.0.md](releases/0.1.0.md).

## What the workflow does

The owner starts the workflow by hand with a version. Nothing else starts it: no push, no tag, no schedule.

1. **Guards, before anything is built.** `node tools/distribution/release.mjs self-test` proves that each guard
   refuses a seeded bad input. `release.mjs guard` then refuses a branch other than main when publishing, a version
   that is not the cohort version every package declares, a pin of a framework package that differs from it (the
   application template, the Nx plugin's workspace cohort, the AI procedures), a package without its registry
   metadata, and a version that the registry already holds for any package of the cohort, or a registry that does
   not answer.
2. **The complete gate.** A frozen install; `pnpm check --skip-nx-cache` (with the API check of every package); the
   API compared with the last published version (`api-report.mjs registry`); the packed archives; the fresh
   independent consumer; the negative controls; the shared-session store; the install from throw-away local
   registries (scope binding and exact pins); the public repository boundary.
3. **The record.** `release.mjs record` writes, for the commit it built, `release.json`, `SHA256SUMS.txt` and the
   draft record `<version>.md` (every archive with its version, SHA-256 and integrity, and the changes from
   `CHANGELOG.md`), and uploads them with the sixteen archives as the run's artifact.
4. **The publication**, only with the `publish` input: a second job in the GitHub environment `npm`, which waits
   for the owner's approval. On a GitHub-hosted runner, with `id-token: write`, it checks that the archives are the
   ones verified (`shasum -c`), that its npm is 11.5.1 or later and its Node 22.14.0 or later (the minimums on npm's
   trusted publishing page), refuses a branch other than main again, and publishes each archive with
   `npm publish --access public --provenance`, a package after the framework packages it depends on. No npm token
   reaches the step: npm proves the identity of the job with its OpenID Connect token, and a test refuses a workflow
   that holds a token. A stable
   version takes the dist-tag `latest`; a prerelease takes `next`, never `latest`. An archive that the registry
   already holds with the same bytes is skipped (a run that stopped half way); other bytes under the version are
   refused.

Without the `publish` input the run is a rehearsal: it does everything but the publication.

## Preparing a release (a pull request on main)

1. Set the version in the root `package.json` and in every `packages/*/package.json`, and every pin of a framework
   package to it. `node tools/distribution/release.mjs guard --version <version> --ref refs/heads/main` lists each
   value that differs (it also asks the registry whether the version is free).
2. Give the changes of the release their own section in `CHANGELOG.md`, headed `## <version>`. The record of the run
   reads that section, and the `Unreleased` section when the version has none.
3. API: `pnpm check` compares each package's built declarations with its `api-report.json`. When the API changed
   and the version moved as the policy says, the check passes; record the new API at the new version with
   `pnpm api:update` in the same pull request, so that it is the baseline of the next release.
4. Run the gate locally if you want the evidence before the workflow:
   `pnpm check --skip-nx-cache`, `pnpm pack:local`, `pnpm exec nx run distribution:consumer-check`,
   `pnpm exec nx run distribution:negative-controls`, `pnpm exec nx run security-bff:test-redis`,
   `pnpm exec nx run distribution:registry-install` and `pnpm public:verify`.
5. After the merge, run the workflow on main without `publish` (the rehearsal) and read its artifact.

## The owner's steps for the first publication

These steps are the owner's; no agent and no workflow takes them. Steps 1 to 6 were taken for `0.1.0` on 2026-10-12;
a release after the first begins at step 7 and, once trusted publishing is configured for every package, needs no
token. They were checked against npm's documentation
(Trusted publishing, Generating provenance statements, Creating and viewing access tokens, Configuring two-factor
authentication, Deprecating packages) and GitHub's documentation (Managing environments for deployment) on
2026-10-12; the points those pages did not settle are listed at the end.

1. **Two-factor authentication on the npm account.** npmjs.com, profile picture, **Account**, "Two-Factor
   Authentication", **Enable 2FA**, with a security key or a passkey; keep the recovery codes away from the
   second-factor device. Do this first: creating a token that bypasses two-factor authentication asks for it. From the command line the mode that covers writes is `npm profile enable-2fa auth-and-writes`.
2. **The organization `mpfrontend`.** It exists (created by the owner on 2026-10-12). Every package of the cohort
   is published under it.
3. **The GitHub environment `npm`.** Repository **Settings**, **Environments**, **New environment**, name `npm`.
   Under **Required reviewers**, the owner. Leave **Prevent self-review** off while the owner both starts the run
   and approves it. Under **Deployment branches**, **Selected branches and tags**, a rule for the branch `main`.
4. **The first-publication token.** npmjs.com, profile picture, **Access Tokens**, **Generate New Token**: a granular
   token with **Packages and scopes** set to **Read and write (publish and stage)**, not "stage only", the shortest
   expiration that covers the run (at least one day), and **Bypass two-factor authentication** checked, since the
   workflow cannot answer a two-factor challenge. Without that box npm answers the first publication with
   `403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required`; that is what
   the first attempt at `0.1.0` met, and nothing had been published.
   Copy it once and store it only as the environment secret `NPM_TOKEN` of the environment `npm` (**Environment
   secrets**, **Add Secret**). It never goes into the repository, a workflow file or another secret.
5. **The rehearsal and the run.** Run the workflow on main with the version and without `publish`; then with
   `publish`, and approve the job `publish` when it waits in the environment `npm`.
6. **Remove the token.** Delete the granular token on npmjs.com and the secret `NPM_TOKEN` on GitHub as soon as the
   publication succeeded.
7. **Trusted publishing, per package.** The workflow passes no token, so a release after `0.1.0` needs this for
   every package: all sixteen exist since 2026-10-12. For each of the sixteen packages: npmjs.com, the package's **Settings**,
   "Trusted Publisher", **GitHub Actions**, with organization or user the GitHub account that owns this repository,
   repository `mpfrontend`, workflow filename `release.yml` and environment name `npm`, and allow `npm publish`. npm checks the configuration only at
   the next publication, and a new configuration that has not published within two days expires, so configure it
   shortly before the next release runs. From then on the workflow publishes with a short-lived OpenID Connect token
   and npm makes the provenance attestation itself; no token exists.
8. **Close token publishing.** After a release has published by trusted publishing, set each package's **Settings**,
   **Publishing access**, to "Require two-factor authentication and disallow tokens"; trusted publishing keeps
   working.
9. **Tag and Release.** Create the tag `v<version>` on the commit that the run built (the `commit` of its
   `release.json`) and a GitHub Release with the run's `SHA256SUMS.txt` and its sixteen archives, which the offline
   path below downloads. Commit the run's `<version>.md` as
   `docs/releases/<version>.md`.
10. **Check the publication** from a clean machine:
    `node tools/distribution/registry-install.mjs --registry https://registry.npmjs.org --record <release.json>`.
    It installs the cohort into a freshly generated workspace and app with the generated scope binding, compares
    each installed archive's version and integrity with the record, and runs `npm audit signatures`, which must
    report a verified registry signature and provenance attestation for every `@mpfrontend` package; it prints
    `"signaturesAndProvenance":"verified"`. The registry lists a new package some minutes after the publication, and an
    install in that window answers 404: wait and run it again.

## A publication that stops part-way

If the job `publish` fails after some packages were published, re-run the failed job of the same run (**Re-run failed
jobs** on the run's page), within the 30 days that the run's artifact is kept. It publishes what is missing and skips,
by the bytes, what the registry already holds. A new dispatch of the same version does not do this: the guard refuses
a version the registry already holds, before the skip logic runs. A failure before the first package (a wrong token,
a wrong path) leaves nothing published, and the same re-run applies after the cause is repaired; a repair of the
workflow file itself needs a new run, since a re-run uses the commit of the run. The first attempts at `0.1.0` met
both: a path that npm read as a GitHub repository, and a token without the box that bypasses two-factor
authentication; the re-run of the second run, after the token was replaced, published all sixteen.

## Correcting a release

A published version is never published again and never unpublished. A corrected build takes the next version.
Mark a bad version with `npm deprecate @mpfrontend/<package>@<version> "<message>"` (with the one-time code when the
account has two-factor authentication); an install of it then prints the message.

## The offline path

Without registry access, a consumer installs the archives of a release: download them from the GitHub Release (the
sixteen archives and `SHA256SUMS.txt`), check them with `shasum -a 256 -c SHA256SUMS.txt`, force them through pnpm `overrides` (`file:` paths) and lock the
same SHA-256 values as the release record. `pnpm pack:local` packs the same bytes from the same tree.

## Notes for consumers

- A generated workspace's `.npmrc` binds `@mpfrontend` to `https://registry.npmjs.org/` and saves exact versions.
  Keep it: with the binding, a project or user `registry` setting that points elsewhere cannot serve the scope.
- npm adds a version `0.0.0-stage` ("Temporary package placeholder for staged publishing") to each new package when
  it creates it; the dist-tag `latest` stays on the published version, so an install without a version gets that.
- pnpm 11 resolves a version only after it is a day old by default; in its default loose mode it adds a newer pick
  to `minimumReleaseAgeExclude` and says so. A consumer that installs a release on its first day sees that message.

## Points the documentation did not settle

- Whether a trusted publisher can be configured for a package that has never been published: the npm page starts
  from the package's settings, which exist only after a first publication, so this guide publishes first with a
  token.
- Whether a granular token can be limited to the `@mpfrontend` scope before any package of it exists: the page lets
  a token select packages and scopes but does not say whether an empty scope can be chosen. The token of the first
  publication was not recorded with its scope, so this stays unsettled; this guide asks for the shortest expiration.
- How npm treats an empty `NODE_AUTH_TOKEN` when trusted publishing is configured: the pages read do not say. The
  workflow no longer passes the variable at all, and a test refuses a workflow that does.
