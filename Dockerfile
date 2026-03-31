# Stage 1: Build frontend
FROM node:22-slim AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build server
FROM node:22-slim AS server-build
WORKDIR /build
COPY server/package.json server/package-lock.json* ./
RUN npm ci
COPY server/ ./
RUN npm run build

# Stage 3: Production image
FROM node:22-slim

WORKDIR /app

# Copy server
COPY --from=server-build /build/dist ./server/dist
COPY --from=server-build /build/package.json ./server/
COPY server/src/migrations ./server/src/migrations

# Install production dependencies
WORKDIR /app/server
RUN npm ci --production

WORKDIR /app

# Copy built frontend
COPY --from=frontend-build /build/dist ./frontend/dist

# Skills and agent context
COPY skills/ ./skills/
COPY AGENTS.md ./

# Goldilocks CLI placeholder
COPY bin/ ./bin/
RUN chmod +x ./bin/goldilocks && ln -s /app/bin/goldilocks /usr/local/bin/goldilocks

# Create data directories
RUN mkdir -p /data/workspaces /models

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV WORKSPACE_ROOT=/data/workspaces
ENV PORT=3000

EXPOSE 3000

# Run from app root so paths work
CMD ["node", "server/dist/index.js"]
