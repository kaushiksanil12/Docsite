#!/bin/bash

# Simple Installer for DevDocs
# This script sets up Docker with persistent volumes and a command alias.

set -e

# Colors for pretty output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting DevDocs Installation...${NC}"

# 1. Check for Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}❌ Docker is not installed. Please install Docker first: https://docs.docker.com/get-docker/${NC}"
    exit 1
fi

# 2. Determine Image Source
IMAGE_NAME="devdocs"
REMOTE_IMAGE="kaushik678/docsite:latest"

if [ -f "Dockerfile" ]; then
    echo -e "${BLUE}📦 Found source code. Building local image...${NC}"
    docker build -t devdocs .
else
    echo -e "${BLUE}☁️  No source code found. Pulling remote image from Docker Hub...${NC}"
    docker pull "$REMOTE_IMAGE"
    IMAGE_NAME="$REMOTE_IMAGE"
fi

# 3. Stop and Remove old container if exists
if [ "$(docker ps -aq -f name=devdocs)" ]; then
    echo -e "${YELLOW}🔄 Removing old container...${NC}"
    docker rm -f devdocs
fi

# 4. Run the Container with Named Volumes
echo -e "${BLUE}🚢 Starting DevDocs container...${NC}"
docker run -d \
  --name devdocs \
  -p 3100:3000 \
  --restart unless-stopped \
  -v devdocs-config:/app/config \
  -v devdocs-docs:/app/docs \
  -v devdocs-uploads:/app/uploads \
  "$IMAGE_NAME"

# 5. Set up Alias
# This alias is smart: it tries to start the container if it exists, otherwise it creates it.
ALIAS_CMD="alias devdocs='docker start devdocs 2>/dev/null || docker run -d -p 3100:3000 --name devdocs --restart unless-stopped -v devdocs-config:/app/config -v devdocs-docs:/app/docs -v devdocs-uploads:/app/uploads $IMAGE_NAME'"

# Detect Shell Profile
PROFILE=""
if [ -f "$HOME/.bashrc" ]; then
    PROFILE="$HOME/.bashrc"
elif [ -f "$HOME/.zshrc" ]; then
    PROFILE="$HOME/.zshrc"
fi

if [ -n "$PROFILE" ]; then
    if ! grep -q "alias devdocs=" "$PROFILE"; then
        echo -e "${BLUE}📝 Adding 'devdocs' alias to $PROFILE...${NC}"
        echo "" >> "$PROFILE"
        echo "# DevDocs Alias" >> "$PROFILE"
        echo "$ALIAS_CMD" >> "$PROFILE"
        echo -e "${YELLOW}💡 Run 'source $PROFILE' or open a new terminal to use the 'devdocs' command.${NC}"
    fi
fi

echo -e "${GREEN}✅ Installation Complete!${NC}"
echo -e "${GREEN}🌐 Open http://localhost:3000 in your browser.${NC}"
echo -e "${BLUE}ℹ️  Configure your Git URL and PAT in the UI once, and it will be saved forever.${NC}"
