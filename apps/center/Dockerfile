# build context: repo root (docker build -f apps/center/Dockerfile .)
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile  && pnpm --filter center --filter web build  && pnpm --filter center deploy --prod /out

# better-sqlite3 is the only external; /out/node_modules carries its musl prebuild
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
ARG VERSION=dev
ENV NODE_ENV=production VERSION=$VERSION
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /src/apps/center/dist ./dist
COPY --from=build /src/apps/web/dist ./web
USER 10001
EXPOSE 8080
ENTRYPOINT ["node","dist/main.js"]
