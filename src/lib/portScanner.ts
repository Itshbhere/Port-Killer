import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

const execAsync = promisify(exec);

export interface PortInfo {
  port: number;
  pid: number;
  process: string;
  command?: string;
  user?: string;
  protocol: string;
  address?: string;
  isSystemProcess?: boolean;
}

export interface PortCheckResult {
  port: number;
  inUse: boolean;
  info?: PortInfo;
  processes?: PortInfo[];
}

export interface KillResult {
  success: boolean;
  pid: number;
  port?: number;
  message: string;
}

// Known system-critical daemons/processes to warn or mark
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

/**
 * Retrieves detailed command name or executable path for a given PID.
 */
async function getProcessDetails(pid: number): Promise<{ name: string; fullCommand: string }> {
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
      // macOS and Linux: ucomm is short process name (e.g. node, python3), command is full command line
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

/**
 * Scans all active listening ports on the host machine.
 */
export async function getAllListeningPorts(): Promise<PortInfo[]> {
  const isWindows = process.platform === "win32";

  if (isWindows) {
    return getListeningPortsWindows();
  } else {
    return getListeningPortsPosix();
  }
}

/**
 * macOS and Linux parser using lsof
 */
async function getListeningPortsPosix(): Promise<PortInfo[]> {
  try {
    // -iTCP -sTCP:LISTEN -P -n
    const { stdout } = await execAsync("lsof -iTCP -sTCP:LISTEN -P -n", {
      maxBuffer: 10 * 1024 * 1024,
    });

    const lines = stdout.trim().split("\n");
    if (lines.length <= 1) return [];

    const portMap = new Map<string, PortInfo>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Columns: COMMAND, PID, USER, FD, TYPE, DEVICE, SIZE/OFF, NODE, NAME
      // Notice NAME can be *:3000 (LISTEN) or 127.0.0.1:3000 (LISTEN) or [::]:3000 (LISTEN)
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;

      const rawCommand = parts[0];
      const pidStr = parts[1];
      const user = parts[2];
      const type = parts[4]; // IPv4 or IPv6
      const namePart = parts[8]; // e.g. *:3000 or 127.0.0.1:8080

      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) continue;

      // Extract port number from namePart
      const match = namePart.match(/:(\d+)$/);
      if (!match) continue;

      const port = parseInt(match[1], 10);
      if (isNaN(port)) continue;

      const address = namePart.split(":")[0] || "*";
      const key = `${port}-${pid}`;

      if (!portMap.has(key)) {
        const isSystem =
          SYSTEM_PROCESS_NAMES.has(rawCommand) ||
          rawCommand.toLowerCase().startsWith("system") ||
          user === "root" && pid < 100;

        portMap.set(key, {
          port,
          pid,
          process: rawCommand,
          command: rawCommand,
          user,
          protocol: `TCP (${type})`,
          address,
          isSystemProcess: Boolean(isSystem),
        });
      }
    }

    const portList = Array.from(portMap.values());

    // Enrich processes with friendly names
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

    // Sort by port number ascending
    return enriched.sort((a, b) => a.port - b.port);
  } catch (err: unknown) {
    // If lsof exits with code 1, it might mean no processes matched
    const error = err as { code?: number; stdout?: string };
    if (error && error.code === 1 && !error.stdout) {
      return [];
    }
    console.error("Error running lsof:", err);
    return [];
  }
}

/**
 * Windows parser using netstat
 */
async function getListeningPortsWindows(): Promise<PortInfo[]> {
  try {
    const { stdout } = await execAsync("netstat -ano -p tcp");
    const lines = stdout.trim().split("\n");
    const portMap = new Map<string, PortInfo>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("TCP") || !trimmed.includes("LISTENING")) continue;

      const parts = trimmed.split(/\s+/);
      // Proto, Local Address, Foreign Address, State, PID
      if (parts.length < 5) continue;

      const localAddress = parts[1];
      const pidStr = parts[4];
      const pid = parseInt(pidStr, 10);
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
  } catch (err) {
    console.error("Error running netstat:", err);
    return [];
  }
}

export interface DevPortSummary {
  port: number;
  inUse: boolean;
  info?: PortInfo;
}

/**
 * Fast targeted lookup for a specific list of development ports.
 */
export async function getMultiplePortsStatus(targetPorts: number[]): Promise<DevPortSummary[]> {
  const validPorts = Array.from(
    new Set(targetPorts.filter((p) => !isNaN(p) && p >= 1 && p <= 65535))
  );
  if (validPorts.length === 0) return [];

  const isWindows = process.platform === "win32";
  const resultMap = new Map<number, DevPortSummary>();
  validPorts.forEach((port) => {
    resultMap.set(port, { port, inUse: false });
  });

  try {
    if (isWindows) {
      const all = await getListeningPortsWindows();
      for (const item of all) {
        if (resultMap.has(item.port)) {
          resultMap.set(item.port, {
            port: item.port,
            inUse: true,
            info: item,
          });
        }
      }
    } else {
      // macOS and Linux: query all requested ports in one single fast command
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

          const portInfo: PortInfo = {
            port,
            pid,
            process: details.name || rawCommand,
            command: details.fullCommand || rawCommand,
            user,
            protocol: `TCP (${type})`,
            address: namePart.split(":")[0] || "*",
            isSystemProcess: Boolean(isSystem),
          };

          resultMap.set(port, {
            port,
            inUse: true,
            info: portInfo,
          });
        }
      }
    }
  } catch (err) {
    console.error("Error checking dev ports:", err);
  }

  return Array.from(resultMap.values());
}

/**
 * Checks a specific port on the host machine.
 */
export async function checkPortStatus(port: number): Promise<PortCheckResult> {
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error("Invalid port number. Port must be between 1 and 65535.");
  }

  const isWindows = process.platform === "win32";

  try {
    if (isWindows) {
      const all = await getListeningPortsWindows();
      const matches = all.filter((p) => p.port === port);
      if (matches.length > 0) {
        return {
          port,
          inUse: true,
          info: matches[0],
          processes: matches,
        };
      }
      return { port, inUse: false };
    } else {
      // macOS and Linux: check specific listening port first, then fall back
      let stdout = "";
      try {
        const res = await execAsync(`lsof -iTCP:${port} -sTCP:LISTEN -P -n`, {
          maxBuffer: 5 * 1024 * 1024,
        });
        stdout = res.stdout;
      } catch {
        // If not found in LISTEN TCP, fall back to any socket on port
        try {
          const res = await execAsync(`lsof -i :${port} -P -n`, {
            maxBuffer: 5 * 1024 * 1024,
          });
          stdout = res.stdout;
        } catch {
          return { port, inUse: false };
        }
      }

      const lines = stdout.trim().split("\n");
      if (lines.length <= 1) {
        return { port, inUse: false };
      }

      const processes: PortInfo[] = [];
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

        if (isNaN(pid)) continue;

        const details = await getProcessDetails(pid);
        const isSystem =
          SYSTEM_PROCESS_NAMES.has(rawCommand) ||
          details.name.toLowerCase().startsWith("system") ||
          (user === "root" && pid < 100);

        processes.push({
          port,
          pid,
          process: details.name || rawCommand,
          command: details.fullCommand || rawCommand,
          user,
          protocol: `TCP (${type})`,
          address: namePart,
          isSystemProcess: Boolean(isSystem),
        });
      }

      // Deduplicate by PID
      const uniqueProcesses = Array.from(
        new Map(processes.map((p) => [p.pid, p])).values()
      );

      if (uniqueProcesses.length > 0) {
        return {
          port,
          inUse: true,
          info: uniqueProcesses[0],
          processes: uniqueProcesses,
        };
      }

      return { port, inUse: false };
    }
  } catch (err: unknown) {
    // If lsof exits with 1, no process is listening on the port
    const error = err as { code?: number };
    if (error && error.code === 1) {
      return { port, inUse: false };
    }
    return { port, inUse: false };
  }
}

/**
 * Kills a process by PID. Can optionally double check if the port was freed.
 */
export async function killProcessByPid(
  pid: number,
  port?: number,
  force: boolean = true
): Promise<KillResult> {
  if (!pid || isNaN(pid) || pid <= 0) {
    return {
      success: false,
      pid,
      port,
      message: "Invalid PID provided.",
    };
  }

  // Prevent killing PID 1 or 0 (init / kernel)
  if (pid <= 1) {
    return {
      success: false,
      pid,
      port,
      message: "Refusing to kill root system process (PID <= 1).",
    };
  }

  const isWindows = process.platform === "win32";

  try {
    if (isWindows) {
      await execAsync(`taskkill /F /PID ${pid}`);
    } else {
      const signal = force ? "-9" : "-15";
      await execAsync(`kill ${signal} ${pid}`);
    }

    // Wait 200ms to allow OS socket cleanup
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Verify
    if (port) {
      const check = await checkPortStatus(port);
      if (!check.inUse) {
        return {
          success: true,
          pid,
          port,
          message: `Process (PID ${pid}) terminated successfully. Port ${port} is now free!`,
        };
      } else {
        // Check if the specific PID is gone even if port is held by another process
        const stillMatchesPid = check.processes?.some((p) => p.pid === pid);
        if (!stillMatchesPid) {
          return {
            success: true,
            pid,
            port,
            message: `Process (PID ${pid}) was killed. (Port ${port} still held by another process).`,
          };
        }
      }
    }

    return {
      success: true,
      pid,
      port,
      message: `Process (PID ${pid}) terminated successfully.`,
    };
  } catch (err: unknown) {
    const error = err as { message?: string; stderr?: string };
    const errMsg = error.stderr || error.message || "Failed to terminate process.";

    // Check if error is "No such process" (which actually means it's already dead)
    if (errMsg.toLowerCase().includes("no such process")) {
      return {
        success: true,
        pid,
        port,
        message: `Process (PID ${pid}) had already exited. Port is now free.`,
      };
    }

    // Permission denied
    if (errMsg.toLowerCase().includes("operation not permitted") || errMsg.toLowerCase().includes("permission denied")) {
      return {
        success: false,
        pid,
        port,
        message: `Permission denied: PID ${pid} is owned by another user or system root. You may need to run Port Killer with elevated permissions (sudo).`,
      };
    }

    return {
      success: false,
      pid,
      port,
      message: `Failed to kill process: ${errMsg}`,
    };
  }
}

/**
 * System metadata
 */
export function getSystemInfo() {
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
