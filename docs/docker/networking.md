# Docker Networking

Understanding Docker networking is essential for connecting containers together.

## Network Types

| Type | Description | Use Case |
|------|-------------|----------|
| **bridge** | Default network for containers | Single-host container communication |
| **host** | Uses host's network directly | Performance-critical apps |
| **overlay** | Multi-host networking | Docker Swarm services |
| **none** | No networking | Isolated containers |

## Bridge Network (Default)

By default, containers connect to the `bridge` network.

```bash
# List networks
docker network ls

# Inspect default bridge
docker network inspect bridge
```

### Custom Bridge Networks

Custom networks provide **automatic DNS resolution** between containers:

```bash
# Create a custom network
docker network create mynet

# Run containers on the custom network
docker run -d --name api --network mynet myapi
docker run -d --name db --network mynet postgres

# Now 'api' can reach 'db' by container name!
# Example: postgres://db:5432/mydb
```

## Port Mapping

Expose container ports to the host:

```bash
# Map host port 8080 to container port 80
docker run -d -p 8080:80 nginx

# Map to specific interface
docker run -d -p 127.0.0.1:8080:80 nginx

# Map a range of ports
docker run -d -p 8080-8090:80-90 myapp
```

## Container DNS

On custom networks, Docker provides built-in DNS:

```bash
# Containers can reach each other by name
docker exec api ping db
```

## Docker Compose Networking

In Docker Compose, a default network is created automatically:

```yaml
version: '3.8'
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    # Can reach backend via http://backend:8080

  backend:
    build: ./backend
    ports:
      - "8080:8080"
    # Can reach db via postgres://db:5432

  db:
    image: postgres:15
    # Only accessible from within the network
```

## Useful Commands

```bash
# Connect a running container to a network
docker network connect mynet mycontainer

# Disconnect from a network
docker network disconnect mynet mycontainer

# Remove a network
docker network rm mynet

# Remove all unused networks
docker network prune
```

## Debugging Network Issues

```bash
# Check container IP address
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' mycontainer

# Check DNS resolution from inside a container
docker exec mycontainer nslookup othercontainer

# Check connectivity
docker exec mycontainer curl -s http://othercontainer:8080/health
```

---

> **Tip:** Always use custom bridge networks in production. The default bridge doesn't support DNS resolution between containers.
