FROM node:24-slim

WORKDIR /app

# Copy package metadata
COPY package*.json ./

# Production install
RUN npm ci --omit=dev --ignore-scripts || true

# Copy application sources
COPY . .

# Ensure storage directory exists
RUN mkdir -p storage

# Default port
EXPOSE 4315

ENV PORT=4315
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV ALLOWED_HOSTS=*

CMD ["node", "server.mjs"]
