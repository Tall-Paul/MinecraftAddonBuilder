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
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm install
COPY packages/server/ packages/server/
COPY tsconfig.base.json ./
RUN npm run build -w packages/server

# Stage 3: Production image
FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm install --omit=dev && apk del python3 make g++

# Copy built server
COPY --from=server-build /app/packages/server/dist packages/server/dist/
COPY --from=server-build /app/packages/server/src/db/schema.sql packages/server/dist/db/

# Copy built client
COPY --from=client-build /app/packages/client/dist packages/client/dist/

# Copy env example
COPY .env.example ./

# Create data directory
RUN mkdir -p /app/data/cache

ENV NODE_ENV=production
ENV PORT=3000
ENV CACHE_DIR=/app/data/cache
ENV DB_PATH=/app/data/addons.db

EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
