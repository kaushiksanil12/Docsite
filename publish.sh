#!/bin/bash

# Script to publish DevDocs to Docker Hub
# Usage: ./publish.sh <your-username>

set -e

USERNAME=$1

if [ -z "$USERNAME" ]; then
    echo "Usage: ./publish.sh <docker-hub-username>"
    exit 1
fi

echo "🐳 Preparing to publish DevDocs to Docker Hub..."

# 1. Build the latest image
docker build -t devdocs .

# 2. Tag for Docker Hub
echo "🏷️  Tagging as $USERNAME/devdocs:latest..."
docker tag devdocs "$USERNAME/devdocs:latest"

# 3. Push to Docker Hub
echo "🚀 Pushing to Docker Hub..."
docker push "$USERNAME/devdocs:latest"

echo "✅ Successfully published to https://hub.docker.com/r/$USERNAME/devdocs"
echo ""
echo "Now anyone can install it by running:"
echo "curl -sSL https://raw.githubusercontent.com/$USERNAME/Docsite/main/install.sh | bash"
