# DevDocs

DevDocs is a lightweight, portable documentation server built with Go. It allows you to manage your markdown notes with ease, featuring automatic synchronization with a Git repository of your choice.

## 🚀 Quick Install

The easiest way to install DevDocs on any Linux/macOS machine is with this one-liner:

```bash
curl -sSL https://raw.githubusercontent.com/kaushiksanil12/Docsite/main/install.sh | bash
```

## ✨ Features

- **Markdown Power**: Real-time rendering of GitHub Flavored Markdown.
- **Git Sync**: Automatically stages, commits, and pushes your changes to a remote repository.
- **Portable**: Runs in a lightweight Docker container.
- **Organized**: Built-in file explorer, search functionality, and trash system.
- **Visuals**: Supports image uploads directly into your documentation.

## 🛠️ Usage

After installation, simply run the `devdocs` command:

```bash
devdocs
```

Access your documentation at [http://localhost:3100](http://localhost:3100).

## ⚙️ Configuration

Once running, you can configure your **Git Repo URL** and **Personal Access Token (PAT)** directly in the web UI. Your settings are persisted in a Docker volume, making it easy to move between machines.

---
Built with ❤️ by Kaushik.
