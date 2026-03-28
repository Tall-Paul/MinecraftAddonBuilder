# Stage 1: Build client
FROM node:20-alpine AS client-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN npm install
COPY packages/client/ packages/client/
COPY tsconfig.base.json ./
RUN npm run build -w packages/client

# Stage 2: Build server
FROM node:20-alpine AS server-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm install
COPY packages/server/ packages/server/
COPY tsconfig.base.json ./
RUN npm run build -w packages/server

# Stage 3: Download unmined-cli
FROM alpine:3.20 AS unmined-download
RUN apk add --no-cache curl
RUN curl -L -o /tmp/unmined-cli.gz "https://unmined.net/download/unmined-cli-linux-musl-x64-dev/" \
    && mkdir -p /opt/unmined-cli \
    && gunzip /tmp/unmined-cli.gz \
    && mv /tmp/unmined-cli /opt/unmined-cli/unmined-cli \
    && chmod +x /opt/unmined-cli/unmined-cli

# Stage 4: Production image
FROM node:20-alpine
WORKDIR /app

# Install libs needed by unmined-cli (.NET self-contained may need icu/libstdc++)
RUN apk add --no-cache libstdc++ icu-libs

# Install production dependencies only
COPY package.json package-lock.json* ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm install --omit=dev

# Copy built server
COPY --from=server-build /app/packages/server/dist packages/server/dist/
COPY --from=server-build /app/packages/server/src/db/schema.sql packages/server/dist/db/

# Copy built client
COPY --from=client-build /app/packages/client/dist packages/client/dist/

# Copy unmined-cli
COPY --from=unmined-download /opt/unmined-cli /opt/unmined-cli

# Copy env example
COPY .env.example ./

# Create data directory
RUN mkdir -p /app/data/cache

ENV NODE_ENV=production
ENV PORT=3000
ENV CACHE_DIR=/app/data/cache
ENV DB_PATH=/app/data/addons.db
ENV UNMINED_CLI=/opt/unmined-cli/unmined-cli

EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
