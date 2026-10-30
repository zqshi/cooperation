# WorkAgent repository rules

Scope: this directory and descendants. WorkAgent is an independent SME product.

- Modify only this repository. Parent workspace and other repositories are outside scope unless explicitly authorized for workspace documentation governance.
- Do not call/write Workshop, commit, push or deploy without an explicit new instruction.
- Read README.md, docs/architecture.md, docs/testing.md and docs/decisions.md before changing boundaries.
- Two frontend apps: console (5173) with independent /super-admin platform operations and /tenant enterprise governance/building shells; user-portal (5174) with business execution and /projects. Never import another app's source; share through packages only. Platform authorization requires an explicit platform_admin grant, never enterprise owner/admin status.
- Modular backend: core domain services, contracts, db and config are shared. Keep control, execution and channel ingress responsibilities distinct. Do not split every domain into a service.
- Every resource access must bind org and authenticated identity; project access additionally requires explicit membership. UI gates are usability, server authorization is mandatory.
- Add DB changes as new migrations; preserve historical migrations. Project tasks must not be aliases for agent_run.
- Use public dependencies only. Never copy private endpoints, credentials or unrelated brands from references.
- For runtime changes run pnpm install, pnpm typecheck, pnpm build, pnpm test (with isolated TEST_DATABASE_URL). Documentation-only changes need link checks, boundary checks and git diff --check; never claim unrun tests pass.
- Read docs/product.md for current product scope. Historical workspace archives are not specifications or runtime dependencies.
