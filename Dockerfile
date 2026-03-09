# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy go mod and sum files
COPY go.mod go.sum ./
RUN go mod download

# Copy the source code
COPY . .

# Build the application (stripped of debug symbols for smaller size)
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o main .

# Production stage
FROM alpine:latest

# Install git for sync
RUN apk add --no-cache git

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/main .

# Copy static files (public directory)
COPY public/ ./public/

# Create data directories
RUN mkdir -p /app/docs /app/uploads /app/trash/docs /app/trash/uploads

# Expose port (Internal Go port)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Run as non-root user
RUN addgroup -g 1001 -S devdocs && adduser -S devdocs -u 1001 -G devdocs
RUN chown -R devdocs:devdocs /app
USER devdocs

# Trust all directories for git to prevent dubious ownership errors
RUN git config --global --add safe.directory '*'
RUN git config --global user.email "devdocs@auto.sync"
RUN git config --global user.name "DevDocs AutoSync"
RUN git config --global pull.rebase false

CMD ["./main"]
