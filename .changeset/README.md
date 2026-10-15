# Changesets

Describe each user-facing change with a changeset, in the same PR as the change:

```bash
pnpm changeset          # pick the packages, the bump (patch / minor / major) and write a summary
```

On merge to `main`, the release workflow opens or updates a **Version Packages** PR: it bumps versions and writes the changelogs. Merging that PR publishes the new versions to npm from GitHub Actions, with Trusted Publishing (OIDC: no npm token) and provenance, then tags them and creates GitHub releases.
