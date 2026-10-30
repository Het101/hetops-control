# build context: repo root (docker build -f apps/center/Dockerfile .)
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
RUN pnpm --filter center --filter web build

# esbuild bundles everything except better-sqlite3 (native). Take just that package, its
# runtime deps and the musl prebuild binary pnpm fetched (verified by TLS only, not a checksum).
RUN pnpm --filter center deploy --prod /out \
 && P=$(readlink -f /out/node_modules/better-sqlite3) \
 && B=$(readlink -f "$P/../bindings") \
 && mkdir -p /rt/node_modules/better-sqlite3/build/Release \
 && cp -r "$P/package.json" "$P/lib" /rt/node_modules/better-sqlite3/ \
 && cp "$P/build/Release/better_sqlite3.node" /rt/node_modules/better-sqlite3/build/Release/ \
 && cp -rL "$B" "$B/../file-uri-to-path" /rt/node_modules/

FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
# no package manager at runtime: nothing here installs or runs a shell tool
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ARG VERSION=dev
ENV NODE_ENV=production VERSION=$VERSION
WORKDIR /app
COPY --from=build /rt/node_modules ./node_modules
COPY --from=build /src/apps/center/dist ./dist
COPY --from=build /src/apps/web/dist ./web
USER 10001
EXPOSE 8080
ENTRYPOINT ["node","dist/main.js"]
