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
GIT_SHA=$(git rev-parse --short HEAD)
echo "🏷️  Tagging as $USERNAME/docsite:latest and $USERNAME/docsite:$GIT_SHA..."
docker tag docsite "$USERNAME/docsite:latest"
docker tag docsite "$USERNAME/docsite:$GIT_SHA"

# 3. Push to Docker Hub
echo "🚀 Pushing to Docker Hub..."
docker push "$USERNAME/docsite:latest"
docker push "$USERNAME/docsite:$GIT_SHA"

echo "✅ Successfully published to https://hub.docker.com/r/$USERNAME/docsite"
echo ""
echo "Now anyone can install it by running:"
echo "curl -sSL https://raw.githubusercontent.com/$USERNAME/Docsite/main/install.sh | bash"
