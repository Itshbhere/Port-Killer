# ⚡ Port Killer

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16.3-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=for-the-badge" alt="Platforms" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" />
</p>

<p align="center">
  <strong>Direct Machine Socket Inspector & Process Terminator</strong><br>
  A unified full-stack developer dashboard to inspect local ports, detect blocked development servers, and terminate rogue processes with one click.
</p>

---

## 📖 Table of Contents

- [The Problem](#-the-problem)
- [Features](#-features)
- [Architecture](#-architecture)
- [Getting Started](#-getting-started)
- [Usage Guide](#-usage-guide)
- [API Reference](#-api-reference)
- [Platform Support](#-platform-support)
- [Security & Permissions](#-security--permissions)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🚨 The Problem

Every developer has encountered this frustration:

```bash
Error: listen EADDRINUSE: address already in use :::3000
```

Normally, you are forced to break your workflow, remember command-line incantations like `lsof -i :3000`, copy the PID, run `kill -9 <PID>`, and verify the port was released.

**Port Killer** eliminates this friction with a unified, browser-accessible control room running locally on your computer.

---

## ✨ Features

- ⚡ **Dev Ports Watchlist (Default Mode)**
  - Targeted fast inspection of standard development ports (`3000`, `3001`, `5173`, `8000`, `8080`, `4200`, `5000`, `5432`, `27017`, `6379`).
  - Executes in **~10ms** without scanning dozens of unrelated OS background daemons.
  - Live status cards displaying **Available (Green)** vs. **In Use (Red)** with process name and PID.

- 🎯 **Instant Single Port Lookup & Terminator**
  - Type any port number (`1` - `65535`) into the search bar for an immediate socket probe.
  - Displays detailed process metadata: executable path, PID, user, protocol, and bind address.
  - Prominent one-click **Kill Process & Free Port** button.

- ➕ **Customizable Dev Port Watchlist**
  - Add your project-specific ports (e.g. `4000` for NestJS, `9000` for Storybook, `8888` for microservices) with custom labels.
  - Automatically persisted in your browser's `localStorage` across restarts.

- 🌐 **All Machine Ports Diagnostic View**
  - Full-spectrum socket inspection listing all listening TCP/UDP sockets on the host OS.
  - Quick filter tabs: **All**, **User Apps**, or **System Daemons**.
  - Search by port number, PID, user, or process name (`node`, `python`, `docker`, `postgres`, etc.).

- 🛡️ **Safe Process Termination**
  - Clear confirmation modal displaying full command line and PID before issuing `SIGKILL`.
  - System daemon warnings preventing accidental termination of critical OS services.
  - Automatic post-kill socket verification ensuring the port was successfully liberated.

- 🎨 **Modern Cyber-Terminal Aesthetic**
  - Dark glassmorphic design, glowing status indicators, responsive layout, and real-time toast alerts.
  - Auto-refresh toggle with live pulse indicators (configurable scan intervals).

---

## 🏗 Architecture

**Port Killer** runs as a unified full-stack application with Next.js App Router:

```
                            +----------------------------------------+
                            |       Port Killer Web Dashboard        |
                            +----------------------------------------+
                                                 |
                   +-----------------------------+-----------------------------+
                   |                                                           |
     [Frontend: React 19 Client UI]                              [Backend: Next.js API Routes]
     - Single Port Hero Probe                                    - GET  /api/ports (Mode: dev | all)
     - Dev Ports Watchlist Grid                                  - GET  /api/ports/[port]
     - Custom Port Manager (localStorage)                        - POST /api/kill (PID + Port)
     - Full Socket Table & Filters                               - POST /api/kill-all (Batch)
     - Real-time Toast Notification System                                     |
                                                                               v
                                                                 [Host System Execution]
                                                                 - macOS/Linux: lsof, ps, kill -9
                                                                 - Windows: netstat, taskkill
```

Because Next.js route handlers execute in the Node.js runtime on your host machine, they have direct native access to execute system utilities while serving the client interface on `localhost`.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18.17.0 or higher; Node 20+ recommended)
- `npm`, `pnpm`, `yarn`, or `bun`

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Itshbhere/Port-Killer.git
   cd Port-Killer
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the local server:**
   ```bash
   npm run dev
   ```

4. **Open the dashboard:**
   Navigate to [http://localhost:3000](http://localhost:3000) in your web browser.

---

## 🖥 Usage Guide

### 1. Monitoring Development Ports
By default, the dashboard displays your **Development Ports Watchlist**.
- **Green pill (`Available`)**: The port is completely clear and ready to start a server.
- **Red pill (`In Use`)**: A process is listening on the port. Process name, PID, and a red **Kill Port** button are displayed.

### 2. Adding Custom Ports
1. Click **"+ Add Custom Port"** in the Dev Ports section.
2. Enter the port number (e.g. `4000`) and a label (e.g. `NestJS API`).
3. Click **Save Port**. It will be tracked and saved in `localStorage`.

### 3. Killing an Occupied Port
1. Click **Kill Port** on any occupied card, or search for a port in the search bar.
2. Review the process name, PID, and executable path in the confirmation modal.
3. Click **Confirm Kill (SIGKILL)**.
4. The process is terminated, the port is liberated, and a success toast confirms the action.

### 4. Full Machine Socket Scan
Click the **All Machine Ports** tab in the Monitoring View header to inspect all open sockets on the machine, search by process name, or copy PIDs.

---

## 🔌 API Reference

Port Killer provides built-in REST endpoints that can also be used by your own scripts or curl commands:

### `GET /api/ports`
Returns active listening ports.

**Query Parameters:**
- `mode`: `"dev"` (default if `ports` provided) or `"all"`.
- `ports`: Comma-separated list of ports to scan (e.g. `?mode=dev&ports=3000,5173,8080`).

**Response Example:**
```json
{
  "success": true,
  "mode": "dev",
  "count": 1,
  "ports": [
    {
      "port": 3000,
      "pid": 41181,
      "process": "node",
      "command": "next-server (v16.3.4)",
      "user": "burhan",
      "protocol": "TCP (IPv6)",
      "address": "*:3000",
      "isSystemProcess": false
    }
  ]
}
```

---

### `GET /api/ports/:port`
Inspects a single port.

**Example:**
```bash
curl http://localhost:3000/api/ports/3000
```

**Response Example:**
```json
{
  "success": true,
  "port": 3000,
  "inUse": true,
  "info": {
    "port": 3000,
    "pid": 41181,
    "process": "node",
    "command": "next-server (v16.3.4)",
    "user": "burhan",
    "protocol": "TCP (IPv6)",
    "address": "*:3000",
    "isSystemProcess": false
  }
}
```

---

### `POST /api/kill`
Terminates a process by PID and port.

**Body:**
```json
{
  "pid": 41181,
  "port": 3000,
  "force": true
}
```

**Response Example:**
```json
{
  "success": true,
  "pid": 41181,
  "port": 3000,
  "message": "Process (PID 41181) terminated successfully. Port 3000 is now free!"
}
```

---

### `POST /api/kill-all`
Batch terminates multiple processes.

**Body:**
```json
{
  "items": [
    { "pid": 41181, "port": 3000 },
    { "pid": 41200, "port": 5173 }
  ]
}
```

---

## 💻 Platform Support

| Operating System | Port Detection Method | Process Termination Method |
| :--- | :--- | :--- |
| **macOS** | `lsof -iTCP -sTCP:LISTEN -P -n` | `kill -9 <PID>` |
| **Linux** | `lsof -iTCP -sTCP:LISTEN -P -n` | `kill -9 <PID>` |
| **Windows** | `netstat -ano -p tcp` | `taskkill /F /PID <PID>` |

---

## 🔒 Security & Permissions

- **User Processes**: Any development server started under your user account (`node`, `python`, `vite`, `go`, `cargo`, `docker`, etc.) can be terminated immediately without special permissions.
- **Root / System Daemons**: If a port is bound by a process owned by `root` or another user, the OS will return `Operation not permitted`. To manage privileged ports, start Port Killer with elevated permissions:
  ```bash
  sudo npm run dev
  ```

---

## 🛠 Tech Stack

- **Framework**: [Next.js 16 (App Router)](https://nextjs.org/)
- **UI Library**: [React 19](https://react.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<p align="center">
  Made with ❤️ for developers tired of <code>EADDRINUSE</code> errors.
</p>
