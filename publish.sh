#!/bin/bash

# Script to publish Docsite to Docker Hub
# Usage: ./publish.sh <your-username>

set -e

USERNAME=$1

if [ -z "$USERNAME" ]; then
    echo "Usage: ./publish.sh <docker-hub-username>"
    exit 1
fi

echo "🐳 Preparing to publish Docsite to Docker Hub..."

# 1. Build the latest image
docker build --network host -t docsite .

# 2. Tag for Docker Hub
echo "🏷️  Tagging as $USERNAME/docsite:latest..."
docker tag docsite "$USERNAME/docsite:latest"

# 3. Push to Docker Hub
echo "🚀 Pushing to Docker Hub..."
docker push "$USERNAME/docsite:latest"

echo "✅ Successfully published to https://hub.docker.com/r/$USERNAME/docsite"
echo ""
echo "Now anyone can install it by running:"
echo "curl -sSL https://raw.githubusercontent.com/$USERNAME/Docsite/main/install.sh | bash"
