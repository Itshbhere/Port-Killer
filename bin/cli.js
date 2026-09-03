#!/usr/bin/env node

const http = require("http");
const { exec, execSync } = require("child_process");
const { promisify } = require("util");
const os = require("os");

const execAsync = promisify(exec);

const PORT = process.env.PORT_KILLER_PORT || 4999;
const HOST = "127.0.0.1";
// Default dashboard URL when published or running locally
const DEFAULT_WEB_URL = process.env.PORT_KILLER_WEB_URL || "https://itshbhere.github.io/Port-Killer";

const SYSTEM_PROCESS_NAMES = new Set([
  "kernel_task",
  "launchd",
  "systemd",
  "init",
  "svchost.exe",
  "System",
  "csrss.exe",
  "wininit.exe",
  "services.exe",
  "lsass.exe",
  "smss.exe",
  "ControlCenter",
  "rapportd",
  "WindowServer",
  "loginwindow",
  "syslogd",
  "opendirectoryd",
  "configd",
]);

async function getProcessDetails(pid) {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
      const lines = stdout.trim().split("\n");
      if (lines.length > 0 && lines[0].includes(",")) {
        const parts = lines[0].split(",").map((p) => p.replace(/^"|"$/g, "").trim());
        return { name: parts[0] || `PID-${pid}`, fullCommand: parts[0] || "" };
      }
      return { name: `PID-${pid}`, fullCommand: "" };
    } else {
      const { stdout } = await execAsync(`ps -p ${pid} -o ucomm=,command=`);
      const trimmed = stdout.trim();
      if (!trimmed) return { name: `PID-${pid}`, fullCommand: "" };

      const parts = trimmed.split(/\s+/);
      const shortName = parts[0] || `PID-${pid}`;
      const fullCommand = trimmed.substring(shortName.length).trim() || shortName;
      return { name: shortName, fullCommand };
    }
  } catch {
    return { name: `PID-${pid}`, fullCommand: "" };
  }
}

async function getAllListeningPorts() {
  if (process.platform === "win32") {
    return getListeningPortsWindows();
  }
  return getListeningPortsPosix();
}

async function getListeningPortsPosix() {
  try {
    const { stdout } = await execAsync("lsof -iTCP -sTCP:LISTEN -P -n", {
      maxBuffer: 10 * 1024 * 1024,
    });
    const lines = stdout.trim().split("\n");
    if (lines.length <= 1) return [];

    const portMap = new Map();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;

      const rawCommand = parts[0];
      const pidStr = parts[1];
      const user = parts[2];
      const type = parts[4];
      const namePart = parts[8];

      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) continue;

      const match = namePart.match(/:(\d+)$/);
      if (!match) continue;

      const port = parseInt(match[1], 10);
      if (isNaN(port)) continue;

      const key = `${port}-${pid}`;
      if (!portMap.has(key)) {
        const isSystem =
          SYSTEM_PROCESS_NAMES.has(rawCommand) ||
          rawCommand.toLowerCase().startsWith("system") ||
          (user === "root" && pid < 100);

        portMap.set(key, {
          port,
          pid,
          process: rawCommand,
          command: rawCommand,
          user,
          protocol: `TCP (${type})`,
          address: namePart.split(":")[0] || "*",
          isSystemProcess: Boolean(isSystem),
        });
      }
    }

    const portList = Array.from(portMap.values());
    const enriched = await Promise.all(
      portList.map(async (item) => {
        const details = await getProcessDetails(item.pid);
        return {
          ...item,
          process: details.name || item.process,
          command: details.fullCommand || item.command,
        };
      })
    );
    return enriched.sort((a, b) => a.port - b.port);
  } catch {
    return [];
  }
}

async function getListeningPortsWindows() {
  try {
    const { stdout } = await execAsync("netstat -ano -p tcp");
    const lines = stdout.trim().split("\n");
    const portMap = new Map();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("TCP") || !trimmed.includes("LISTENING")) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) continue;

      const localAddress = parts[1];
      const pid = parseInt(parts[4], 10);
      if (isNaN(pid)) continue;

      const match = localAddress.match(/:(\d+)$/);
      if (!match) continue;
      const port = parseInt(match[1], 10);
      if (isNaN(port)) continue;

      const key = `${port}-${pid}`;
      if (!portMap.has(key)) {
        portMap.set(key, {
          port,
          pid,
          process: `PID ${pid}`,
          protocol: "TCP",
          address: localAddress.split(":")[0],
          isSystemProcess: pid <= 4,
        });
      }
    }

    const portList = Array.from(portMap.values());
    const enriched = await Promise.all(
      portList.map(async (item) => {
        const details = await getProcessDetails(item.pid);
        return {
          ...item,
          process: details.name || item.process,
          command: details.fullCommand || item.command,
        };
      })
    );
    return enriched.sort((a, b) => a.port - b.port);
  } catch {
    return [];
  }
}

async function getMultiplePortsStatus(targetPorts) {
  const validPorts = Array.from(
    new Set(targetPorts.filter((p) => !isNaN(p) && p >= 1 && p <= 65535))
  );
  if (validPorts.length === 0) return [];

  const resultMap = new Map();
  validPorts.forEach((p) => resultMap.set(p, { port: p, inUse: false }));

  try {
    if (process.platform === "win32") {
      const all = await getListeningPortsWindows();
      for (const item of all) {
        if (resultMap.has(item.port)) {
          resultMap.set(item.port, { port: item.port, inUse: true, info: item });
        }
      }
    } else {
      const portsArg = validPorts.join(",");
      let stdout = "";
      try {
        const res = await execAsync(`lsof -iTCP:${portsArg} -sTCP:LISTEN -P -n`, {
          maxBuffer: 5 * 1024 * 1024,
        });
        stdout = res.stdout;
      } catch {
        stdout = "";
      }

      if (stdout) {
        const lines = stdout.trim().split("\n");
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const parts = line.split(/\s+/);
          if (parts.length < 9) continue;

          const rawCommand = parts[0];
          const pid = parseInt(parts[1], 10);
          const user = parts[2];
          const type = parts[4];
          const namePart = parts[8];
          const match = namePart.match(/:(\d+)$/);
          if (!match) continue;

          const port = parseInt(match[1], 10);
          if (isNaN(port) || !resultMap.has(port)) continue;

          const details = await getProcessDetails(pid);
          const isSystem =
            SYSTEM_PROCESS_NAMES.has(rawCommand) ||
            details.name.toLowerCase().startsWith("system") ||
            (user === "root" && pid < 100);

          resultMap.set(port, {
            port,
            inUse: true,
            info: {
              port,
              pid,
              process: details.name || rawCommand,
              command: details.fullCommand || rawCommand,
              user,
              protocol: `TCP (${type})`,
              address: namePart.split(":")[0] || "*",
              isSystemProcess: Boolean(isSystem),
            },
          });
        }
      }
    }
  } catch (err) {
    console.error("Error inspecting ports:", err);
  }

  return Array.from(resultMap.values());
}

async function checkPortStatus(port) {
  const result = await getMultiplePortsStatus([port]);
  if (result.length > 0 && result[0].inUse) {
    return {
      port,
      inUse: true,
      info: result[0].info,
      processes: [result[0].info],
    };
  }
  return { port, inUse: false };
}

async function killProcessByPid(pid, port) {
  if (!pid || isNaN(pid) || pid <= 1) {
    return { success: false, pid, port, message: "Invalid or protected PID." };
  }

  try {
    if (process.platform === "win32") {
      await execAsync(`taskkill /F /PID ${pid}`);
    } else {
      await execAsync(`kill -9 ${pid}`);
    }

    await new Promise((r) => setTimeout(r, 250));

    if (port) {
      const check = await checkPortStatus(port);
      if (!check.inUse) {
        return {
          success: true,
          pid,
          port,
          message: `Process PID ${pid} terminated. Port ${port} is now free!`,
        };
      }
    }

    return { success: true, pid, port, message: `Process PID ${pid} terminated.` };
  } catch (err) {
    const msg = err.stderr || err.message || "Failed to terminate process.";
    if (msg.toLowerCase().includes("no such process")) {
      return { success: true, pid, port, message: "Process already exited. Port is free." };
    }
    return { success: false, pid, port, message: msg };
  }
}

function getSystemInfo() {
  return {
    platform: process.platform,
    hostname: os.hostname(),
    uptime: Math.floor(os.uptime()),
    release: os.release(),
    arch: os.arch(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
  };
}

function openBrowser(url) {
  const plat = process.platform;
  try {
    if (plat === "darwin") {
      exec(`open "${url}"`);
    } else if (plat === "win32") {
      exec(`start "" "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  } catch {
    // Ignore browser open error
  }
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // JSON helper
  const sendJson = (data, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  // Body parser helper
  const parseBody = () =>
    new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          resolve(JSON.parse(body || "{}"));
        } catch {
          resolve({});
        }
      });
    });

  try {
    // 1. Health check
    if (pathname === "/health" || pathname === "/api/health") {
      return sendJson({
        status: "ok",
        agent: "port-killer-local-agent",
        version: "1.0.0",
        system: getSystemInfo(),
      });
    }

    // 2. Ports list / Dev ports query
    if (pathname === "/api/ports" || pathname === "/ports") {
      const mode = parsedUrl.searchParams.get("mode") || "dev";
      const portsParam = parsedUrl.searchParams.get("ports");
      const system = getSystemInfo();

      if (mode === "dev" || portsParam) {
        const DEFAULT_DEV = [3000, 3001, 5173, 8000, 8080, 4200, 5000, 5432, 27017, 6379];
        const portNumbers = portsParam
          ? portsParam.split(",").map((p) => parseInt(p.trim(), 10)).filter((p) => !isNaN(p))
          : DEFAULT_DEV;

        const devStatus = await getMultiplePortsStatus(portNumbers);
        const activePorts = devStatus.filter((s) => s.inUse && s.info).map((s) => s.info);

        return sendJson({
          success: true,
          mode: "dev",
          system,
          count: activePorts.length,
          ports: activePorts,
          devStatus,
        });
      }

      // Full mode
      const ports = await getAllListeningPorts();
      return sendJson({
        success: true,
        mode: "all",
        system,
        count: ports.length,
        ports,
      });
    }

    // 3. Single port check
    const singlePortMatch = pathname.match(/^\/(?:api\/)?ports\/(\d+)$/);
    if (singlePortMatch) {
      const portNum = parseInt(singlePortMatch[1], 10);
      const result = await checkPortStatus(portNum);
      return sendJson({ success: true, ...result });
    }

    // 4. Kill process
    if ((pathname === "/api/kill" || pathname === "/kill") && req.method === "POST") {
      const body = await parseBody();
      const pid = parseInt(body.pid, 10);
      const port = body.port ? parseInt(body.port, 10) : undefined;
      const result = await killProcessByPid(pid, port);
      return sendJson(result, result.success ? 200 : 400);
    }

    // 5. Batch kill
    if ((pathname === "/api/kill-all" || pathname === "/kill-all") && req.method === "POST") {
      const body = await parseBody();
      const items = body.items || [];
      const results = await Promise.all(
        items.map((i) => killProcessByPid(parseInt(i.pid, 10), i.port ? parseInt(i.port, 10) : undefined))
      );
      const successful = results.filter((r) => r.success).length;
      return sendJson({
        success: true,
        total: items.length,
        successful,
        results,
      });
    }

    // 404
    sendJson({ error: "Not Found", path: pathname }, 404);
  } catch (err) {
    sendJson({ error: err.message || "Internal Server Error" }, 500);
  }
});

server.listen(PORT, HOST, () => {
  const localAgentUrl = `http://${HOST}:${PORT}`;
  console.log("\n=======================================================");
  console.log("⚡  PORT KILLER — LOCAL MACHINE COMPANION AGENT");
  console.log("=======================================================");
  console.log(`✅  Local Bridge running on: \x1b[32m${localAgentUrl}\x1b[0m`);
  console.log(`💻  Host OS: ${process.platform} (${os.arch()}) | Hostname: ${os.hostname()}`);
  console.log(`🔒  CORS: Enabled (Ready to receive requests from Web UI)`);
  console.log("-------------------------------------------------------");

  const targetWebUrl = `${DEFAULT_WEB_URL}?agent=${encodeURIComponent(localAgentUrl)}`;
  console.log(`🚀  Connecting with Web Dashboard at:\n    \x1b[36m${targetWebUrl}\x1b[0m\n`);

  // Automatically open the user's browser
  openBrowser(targetWebUrl);
  console.log("Press Ctrl+C anytime to disconnect the local agent.\n");
});
