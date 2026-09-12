---
"create-qcms-app": patch
---

Prune the scaffolded API image's dev tooling. Its generated Dockerfile now deploys with `pnpm --filter qcms-api deploy --legacy --prod --no-optional /opt/qcms`, because `--prod` alone left the test and front-end toolchain in the image: pnpm records a satisfied optional peer dependency under that snapshot's `optionalDependencies`, and `--prod` prunes `devDependencies` only, so `better-auth`'s optional peers on `vitest`, `next`, `react` and `drizzle-kit` and `@roonga/qcms-db`'s on `testcontainers` all came along. Measured on the monorepo's own image, the SBOM falls from 680 npm packages to 287 and the compressed layers from 202 MB to 90 MB (issue #877). Nothing else about the image moved: same base digest, same non-root user, same port, same healthcheck.
