FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY server.js ./
COPY public/ ./public/

# Data directory — mount a volume here to persist list and catalog
RUN mkdir -p /app/data

EXPOSE 3006

CMD ["node", "server.js"]
