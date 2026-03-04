# Docker Basics

Docker is a platform for developing, shipping, and running applications in **containers**.

## What is a Container?

A container is a lightweight, standalone, executable package that includes everything needed to run a piece of software:

- Code
- Runtime
- System tools
- Libraries
- Settings

## Key Commands

### Images

```bash
# List all images
docker images

# Pull an image
docker pull nginx:latest

# Build an image from Dockerfile
docker build -t myapp:1.0 .

# Remove an image
docker rmi myapp:1.0
```

### Containers

```bash
# Run a container
docker run -d --name web -p 8080:80 nginx

# List running containers
docker ps

# List all containers (including stopped)
docker ps -a

# Stop a container
docker stop web

# Remove a container
docker rm web

# View container logs
docker logs -f web
```

### Exec into a Container

```bash
# Open a shell inside a running container
docker exec -it web /bin/sh

# Run a one-off command
docker exec web cat /etc/nginx/nginx.conf
```

## Dockerfile Example

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

## Volumes

Persist data using volumes:

```bash
# Create a named volume
docker volume create mydata

# Run with a volume
docker run -d -v mydata:/app/data myapp

# Bind mount (host directory)
docker run -d -v ./local-dir:/app/data myapp
```

## Docker Compose

Define multi-container applications:

```yaml
version: '3.8'
services:
  web:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - db
  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# View logs
docker compose logs -f
```

---

> **Next:** Learn about [Docker Networking](networking.md)
