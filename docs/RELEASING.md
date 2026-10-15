# Releasing

Releases are automated with [Changesets](https://github.com/changesets/changesets) and npm **Trusted Publishing**: GitHub Actions publishes over OIDC, so there's no npm token anywhere, and every version gets a provenance attestation.

## Day to day

1. In the PR that makes a user-facing change, add a changeset:
   ```bash
   pnpm changeset
   ```
   Pick the packages and the bump, write one line for the changelog, and commit the generated `.changeset/*.md` file.
2. Merge to `main`. Once CI is green, the `release` job opens or updates a **Version Packages** PR, which bumps versions, writes the `CHANGELOG.md` files and updates internal dependency ranges.
3. Merge the Version Packages PR. The `release` job runs `scripts/release.mjs`, which publishes every package version that isn't on npm yet (in dependency order), then tags them and creates GitHub releases.

You choose the version through the bump type, and you can edit the Version Packages PR before merging it.

## One-time setup (done once per package)

Trusted Publishing must be enabled for each package. You need npm ≥ 11.15, which runs via `npx`, plus your npm login with 2FA:

```bash
for p in policy pay contracts receipts mcp feed; do
  npx -y npm@11.21.0 trust github @codkit/$p --repo deyoungjohn/codkit --file ci.yml --allow-publish --yes
  sleep 2
done
```

Equivalent on npmjs.com: each package's **Settings → Trusted publishing → GitHub Actions**, with repository `deyoungjohn/codkit` and workflow `ci.yml`.

After that, you can turn off token publishing in each package's settings (**Require two-factor authentication and disallow tokens**). Trusted Publishing keeps working.

A **new** package has to be published once by hand (`npm publish --access public` from its folder, after `pnpm build`) before trust can be set up for it.

## Check without publishing

```bash
pnpm release -- --dry-run     # packs each unpublished version and runs `npm publish --dry-run`
```
