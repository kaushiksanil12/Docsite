#!/bin/bash

# Simple Installer for Docsite
# This script sets up Docker with persistent volumes and a command alias.

set -e

# Colors for pretty output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Docsite Installation...${NC}"

# 1. Check for Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}❌ Docker is not installed. Please install Docker first: https://docs.docker.com/get-docker/${NC}"
    exit 1
fi

# 2. Determine Image Source
IMAGE_NAME="docsite"
REMOTE_IMAGE="kaushik678/docsite:latest"

if [ -f "Dockerfile" ]; then
    echo -e "${BLUE}📦 Found source code. Building local image...${NC}"
    docker build -t docsite .
else
    echo -e "${BLUE}☁️  No source code found. Pulling remote image from Docker Hub...${NC}"
    docker pull "$REMOTE_IMAGE"
    IMAGE_NAME="$REMOTE_IMAGE"
fi

# 3. Stop and Remove old container if exists
# Check by name
if [ "$(docker ps -aq -f name=docsite)" ]; then
    echo -e "${YELLOW}🔄 Removing existing 'docsite' container...${NC}"
    docker rm -f docsite
fi

# Check if anything is already listening on port 3100
CONFLICTING_CONTAINER=$(docker ps -q -f "publish=3100")
if [ -n "$CONFLICTING_CONTAINER" ]; then
    echo -e "${YELLOW}⚠️  Container $CONFLICTING_CONTAINER is already using port 3100. Stopping it...${NC}"
    docker stop "$CONFLICTING_CONTAINER"
fi

# 4. Run the Container with Named Volumes
echo -e "${BLUE}🚢 Starting Docsite container...${NC}"
docker run -d \
  --name docsite \
  -p 3100:3000 \
  --restart unless-stopped \
  -v docsite-config:/app/config \
  -v docsite-docs:/app/docs \
  -v docsite-uploads:/app/docs/uploads \
  "$IMAGE_NAME"

# 5. Set up Alias
# This alias is smart: it tries to start the container if it exists, otherwise it creates it.
ALIAS_CMD="alias docsite='docker inspect -f {{.State.Running}} docsite 2>/dev/null | grep -q true && echo \"🌐 Docsite is already running at http://localhost:3100\" || (docker start docsite 2>/dev/null || docker run -d -p 3100:3000 --name docsite --restart unless-stopped -v docsite-config:/app/config -v docsite-docs:/app/docs -v docsite-uploads:/app/docs/uploads $IMAGE_NAME) && echo \"🚀 Docsite started at http://localhost:3100\"'"

# Detect Shell Profile
PROFILE=""
if [ -f "$HOME/.bashrc" ]; then
    PROFILE="$HOME/.bashrc"
elif [ -f "$HOME/.zshrc" ]; then
    PROFILE="$HOME/.zshrc"
fi

if [ -n "$PROFILE" ]; then
    if ! grep -q "alias docsite=" "$PROFILE"; then
        echo -e "${BLUE}📝 Adding 'docsite' alias to $PROFILE...${NC}"
        echo "" >> "$PROFILE"
        echo "# Docsite Alias" >> "$PROFILE"
        echo "$ALIAS_CMD" >> "$PROFILE"
        echo -e "${YELLOW}💡 Run 'source $PROFILE' or open a new terminal to use the 'docsite' command.${NC}"
    fi
fi

echo -e "${GREEN}✅ Installation Complete!${NC}"
echo -e "${GREEN}🌐 Open http://localhost:3000 in your browser.${NC}"
echo -e "${BLUE}ℹ️  Configure your Git URL and PAT in the UI once, and it will be saved forever.${NC}"
