# Synap backend — Cloud Run image.
# Multi-stage so the runtime layer carries no compiler and no dev dependencies.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Cloud Run injects PORT; the server reads it and defaults to 8080.
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "dist/src/index.js"]
