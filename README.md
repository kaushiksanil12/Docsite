# Docsite

Docsite is a lightweight, portable documentation server built with Go. It allows you to manage your notes with ease, featuring automatic synchronization with a Git repository of your choice and a beautifully polished modern interface.

## ✨ Features

- **Premium UI**: Ultra-polished, SaaS-like aesthetic with glassmorphism and smooth micro-interactions.
- **Dual Editing Modes**: Seamless inline WYSIWYG editing and traditional Markdown editing powered by Toast UI.
- **Git Sync**: Automatically stages, commits, and pushes your changes to a remote GitHub repository.
- **Portable**: Fully containerized with Docker and Docker Compose.
- **Organized**: Built-in file explorer, search functionality, and trash system.
- **Visuals**: Drag-and-drop image uploads directly into your documentation.

## 🚀 Quick Install

The easiest way to run Docsite is using Docker Compose. Ensure you have Docker installed on your machine.

To run the production version:

```bash
docker-compose up -d
```

Access your documentation at [http://localhost:3100](http://localhost:3100).

### 🛠️ Development Mode

If you are a developer and want to edit the UI/backend with hot-reloading (port `3120`):

```bash
docker-compose -f docker-compose.dev.yml up --build
```

Access the dev environment at [http://localhost:3120](http://localhost:3120).

## ⚙️ Configuration

Once running, you can configure your **Git Repo URL** and **Personal Access Token (PAT)** directly in the web UI under the "Sync" panel. Your settings, along with all your markdown notes and uploaded images, are persisted in Docker volumes. This makes it incredibly easy to back up your data or move it between machines.

## 🚢 Publishing

To build and publish a new Docker image to Docker Hub, use the provided script:

```bash
./publish.sh <your-dockerhub-username>
```
