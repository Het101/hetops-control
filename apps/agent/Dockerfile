# build context: repo root (docker build -f apps/agent/Dockerfile .)
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/agent/package.json apps/agent/
COPY apps/center/package.json apps/center/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @hetops-control/agent build

# esbuild bundles every dependency: the runtime image is node plus one file
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
# no package manager at runtime: nothing here installs or runs a shell tool
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ARG VERSION=dev
ENV NODE_ENV=production VERSION=$VERSION
WORKDIR /app
COPY --from=build /src/apps/agent/dist ./dist
USER 10001
EXPOSE 7443
ENTRYPOINT ["node","dist/main.js"]
