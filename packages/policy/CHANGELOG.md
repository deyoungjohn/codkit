# @codkit/policy

## 0.1.1

### Patch Changes

- a1fc1c2: Builds move from tsc to tsup: every entry point now ships ESM (`.js`) and CommonJS (`.cjs`), each with its own types (`.d.ts` / `.d.cts`), so `require()` and older bundlers work. Package-level `main` / `module` / `types` are added for tools that ignore `exports`.
