FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY server.js ./
COPY public/ ./public/
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Bake in default data — used to seed /app/data on first run if it's empty.
# An existing mounted /app/data is NEVER touched; see entrypoint.sh.
COPY data-defaults/ ./data-defaults/

# Runtime data directory — mount a volume here to persist across restarts
RUN mkdir -p /app/data

EXPOSE 3006

ENTRYPOINT ["./entrypoint.sh"]
