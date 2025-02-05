<p align="center">
  <img src="./images/tasknet-color@2x.png" alt="TaskNet Logo" width="300"/>
</p>

<h1 align="center">browser-node</h1>

[![npm version](https://badge.fury.io/js/@ajent-foundation%2Ftypescript-sdk.svg)](https://badge.fury.io/js/@ajent-foundation%2Ftypescript-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9.5-blue.svg)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker)](https://www.docker.com/)

This service provides a containerized browser environment with API endpoints for browser control and monitoring. It's part of the tasknet software, built with Node.js, Express.js, and TypeScript.

## Features

- **Browser Launch API**: REST endpoint to start and manage browser instances
- **Web Debugger Interface**: Debug browser sessions through DevTools protocol
- **VNC Support**: Remote browser viewing and control through VNC
- **Containerized**: Runs in an isolated Docker container for security and portability

## Development Guide

### Prerequisites

- Docker

### Building the Docker Image

Choose the appropriate build command based on your system architecture:

1. **For Intel/AMD processors (x86_64/amd64)**:
```bash
npm run build:image
```
Builds the default Docker image using Chrome browser.

2. **For ARM64 processors (Apple M1/M2)**:
```bash
npm run build:image:arm64
```
Builds using Brave browser, optimized for ARM64 architecture.

### Running the Container

After building, run the container with VNC support:
```bash
npm run runContainer
```

> **Note**: Local development without Docker is not recommended as some services require specific browser dependencies and configurations that are pre-configured in the container.

## API Endpoints

### Browser Control
- `POST /launch`: Start a new browser instance
  - Configure VNC access, screen resolution, and proxy settings
  - Returns browser connection details and WebSocket path

- `POST /free`: Gracefully terminate the browser instance

### Session Management
- `GET /session/data`: Get current session data (cookies, localStorage, etc.)
- `POST /session/set`: Set session data
  - Upload cookies, localStorage, and sessionStorage
- `GET /session/download`: Download current session data as tar.gz
- `POST /session/upload`: Upload and restore a previous session

### System Control
- `POST /system/keyboard`: Send keyboard input
  - Supports key combinations, modifiers (ctrl, alt, shift)
  - Text typing and special keys
- `POST /system/mouse`: Control mouse actions
  - Move cursor to coordinates
  - Click (left, right, middle)
- `GET /system/screenshot`: Capture current screen
  - Returns base64 encoded JPEG image
- `GET /system/isBrowserActive`: Check if browser window is focused
- `POST /system/closeDialog`: Close active system dialogs
- `POST /system/selectFileFromDialog`: Select file in system dialog

### File Operations
- `GET /files/list`: List available files
  - Query parameter `type`: "download" or "upload"
- `GET /files/download/:fileName`: Download a specific file
- `POST /files/upload`: Upload a file to the container

## Documentation

For detailed API documentation and advanced usage, please visit our [official documentation](https://dev-docs.tasknet.co/).

## License

This project is licensed under the MIT License - see the LICENSE file for details.