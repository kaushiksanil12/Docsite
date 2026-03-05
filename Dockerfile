FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY server.js ./
COPY public/ ./public/

# Copy docs and uploads (for persistence)
COPY docs/ ./docs/
COPY uploads/ ./uploads/

# Create default directories
RUN mkdir -p /app/docs /app/uploads /app/trash/docs /app/trash/uploads

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run as non-root user
RUN addgroup -g 1001 -S devdocs && adduser -S devdocs -u 1001 -G devdocs
RUN chown -R devdocs:devdocs /app
USER devdocs

CMD ["node", "server.js"]
