# build context: repo root (docker build -f apps/agent/Dockerfile .)
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @hetops-control/agent build

# esbuild bundles every dependency: the runtime image is node + one file
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
ARG VERSION=dev
ENV NODE_ENV=production VERSION=$VERSION
WORKDIR /app
COPY --from=build /src/apps/agent/dist ./dist
USER 10001
EXPOSE 7443
ENTRYPOINT ["node","dist/main.js"]
