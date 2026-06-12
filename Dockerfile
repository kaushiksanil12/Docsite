# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app/backend

# Copy go mod file
COPY backend/go.mod ./

# Copy the source code
COPY backend/ .

# Generate go.sum and download dependencies
RUN go mod tidy

# Build the application (stripped of debug symbols for smaller size)
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/main .

# Production stage
FROM alpine:3.19

# Install git for sync
RUN apk add --no-cache git

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/main .

# Copy static files (public directory)
COPY public/ ./public/

# Create data directories
RUN mkdir -p /app/docs/uploads /app/config /app/trash/docs /app/trash/uploads

# Expose port (Internal Go port)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Run as non-root user
RUN addgroup -g 1001 -S docsite && adduser -S docsite -u 1001 -G docsite
RUN chown -R docsite:docsite /app
USER docsite

# Trust specific directories for git to prevent dubious ownership errors
RUN git config --global --add safe.directory /app/docs
RUN git config --global user.email "docsite@auto.sync"
RUN git config --global user.name "Docsite AutoSync"
RUN git config --global pull.rebase false

CMD ["./main"]
