# @up/config

Shared tooling configuration. Contains no runtime code.

- `typescript/base.json`: strict compiler options for all packages
- `typescript/library.json`: framework-free packages (`core`, `db`, `integrations`)
- `typescript/nextjs.json`: Next.js apps
- `eslint/base`: typescript-eslint (strict, type-checked) plus **architecture boundaries**
- `eslint/react`: base plus React hooks and jsx-a11y (strict), for `@up/ui`
- `eslint/next`: base plus `eslint-config-next` (core-web-vitals, a11y basics)
