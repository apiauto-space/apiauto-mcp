# For registries that build and introspect servers in a sandbox, such as Glama. The usual way to run
# this server is npx. It needs no key to start and to list its tools; a key goes in at run time only.
FROM node:22.21.1-slim@sha256:25b3eb23a00590b7499f2a2ce939322727fcce1b15fdd69754fcd09536a3ae2c
WORKDIR /app
COPY package.json npm-shrinkwrap.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm ci --ignore-scripts --no-audit --no-fund \
  && npm run build \
  && npm prune --omit=dev --ignore-scripts \
  && rm -rf src tsconfig.json tsconfig.build.json
USER node
ENTRYPOINT ["node", "dist/index.js"]
