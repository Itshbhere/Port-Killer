"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Search,
  Zap,
  RefreshCw,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Terminal,
  Trash2,
  AlertTriangle,
  Flame,
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
  Radio,
  Plus,
  X,
  SlidersHorizontal,
  Code2,
  Globe,
  Laptop,
  Wifi,
  WifiOff,
} from "lucide-react";

interface PortInfo {
  port: number;
  pid: number;
  process: string;
  command?: string;
  user?: string;
  protocol: string;
  address?: string;
  isSystemProcess?: boolean;
}

interface DevPortItem {
  port: number;
  label: string;
  isCustom?: boolean;
}

interface DevPortStatus {
  port: number;
  inUse: boolean;
  info?: PortInfo;
}

interface SystemInfo {
  platform: string;
  hostname: string;
  uptime: number;
  release: string;
  arch: string;
  totalMemory: number;
  freeMemory: number;
}

interface Toast {
  id: string;
  type: "success" | "error" | "info";
  title: string;
  message: string;
}

const DEFAULT_DEV_PORTS: DevPortItem[] = [
  { port: 3000, label: "React / Next.js" },
  { port: 3001, label: "Secondary Dev" },
  { port: 5173, label: "Vite / Svelte / Vue" },
  { port: 8000, label: "FastAPI / Django" },
  { port: 8080, label: "Spring / Node Proxy" },
  { port: 4200, label: "Angular" },
  { port: 5000, label: "Flask / Python" },
  { port: 5432, label: "PostgreSQL" },
  { port: 27017, label: "MongoDB" },
  { port: 6379, label: "Redis" },
];

const DEFAULT_AGENT_URL = "http://127.0.0.1:4999";

export default function PortKillerDashboard() {
  // Connection state
  const [agentUrl, setAgentUrl] = useState<string>(DEFAULT_AGENT_URL);
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "connecting" | "disconnected">("connecting");
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [hasCopiedCommand, setHasCopiedCommand] = useState<boolean>(false);

  // Scan mode: "dev" (default) or "all"
  const [scanMode, setScanMode] = useState<"dev" | "all">("dev");

  // Tracked development ports
  const [devPorts, setDevPorts] = useState<DevPortItem[]>(DEFAULT_DEV_PORTS);
  const [devStatusList, setDevStatusList] = useState<DevPortStatus[]>([]);

  // Add custom dev port form
  const [showAddPort, setShowAddPort] = useState(false);
  const [newPortNumber, setNewPortNumber] = useState("");
  const [newPortLabel, setNewPortLabel] = useState("");

  // All ports & system info
  const [allPorts, setAllPorts] = useState<PortInfo[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastScanned, setLastScanned] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [refreshInterval, setRefreshInterval] = useState<number>(3500);

  // Single port inspector state
  const [searchPort, setSearchPort] = useState<string>("");
  const [isCheckingPort, setIsCheckingPort] = useState<boolean>(false);
  const [inspectedPort, setInspectedPort] = useState<{
    port: number;
    inUse: boolean;
    info?: PortInfo;
    processes?: PortInfo[];
  } | null>(null);

  // Table filtering & selection for "all" mode
  const [tableFilter, setTableFilter] = useState<string>("");
  const [filterType, setFilterType] = useState<"all" | "user" | "system">("all");

  // Kill action state & modal
  const [killingPid, setKillingPid] = useState<number | null>(null);
  const [killModalTarget, setKillModalTarget] = useState<PortInfo | null>(null);

  // Toast notifications & copy state
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [copiedPid, setCopiedPid] = useState<number | null>(null);

  // Auto-ping timer ref for connection modal
  const pingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Helper to add toast
  const addToast = useCallback((type: "success" | "error" | "info", title: string, message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // Helper to resolve API endpoint (local agent bridge or relative Next.js backend)
  const getApiUrl = useCallback(
    (path: string) => {
      // If connected to a custom remote/loopback agent
      if (agentUrl && connectionStatus === "connected") {
        return `${agentUrl}${path}`;
      }
      // If running on local Next.js server
      return path;
    },
    [agentUrl, connectionStatus]
  );

  // Probe connection to local Next.js API or companion agent
  const probeConnection = useCallback(
    async (targetUrl: string, isInitial = false) => {
      const isLocalHost =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

      // 1. If running on localhost/127.0.0.1 without a forced ?agent param, use built-in Next.js API
      if (isLocalHost && (!targetUrl || targetUrl === DEFAULT_AGENT_URL)) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 1500);
          const res = await fetch("/api/ports?mode=dev&ports=3000", {
            signal: controller.signal,
            cache: "no-store",
          });
          clearTimeout(timeout);
          if (res.ok) {
            setAgentUrl(""); // Clear agentUrl to use direct relative /api routes
            setConnectionStatus("connected");
            setIsConnectModalOpen(false);
            return true;
          }
        } catch {
          // Local Next.js API failed, fall through to agent probe
        }
      }

      // 2. Otherwise probe the companion agent (127.0.0.1:4999 or specified targetUrl)
      if (targetUrl) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 1200);
          const res = await fetch(`${targetUrl}/health`, {
            signal: controller.signal,
            cache: "no-store",
          });
          clearTimeout(timeout);
          if (res.ok) {
            const data = await res.json();
            setAgentUrl(targetUrl);
            setConnectionStatus("connected");
            if (data.system) setSystemInfo(data.system);
            setIsConnectModalOpen(false);
            return true;
          }
        } catch {
          // Companion agent not running
        }
      }

      setConnectionStatus("disconnected");
      if (isInitial) {
        setIsConnectModalOpen(true);
      }
      return false;
    },
    []
  );

  // Check URL params for ?agent=... on mount
  useEffect(() => {
    let chosenAgent = "";
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const paramAgent = params.get("agent");
      if (paramAgent) {
        chosenAgent = paramAgent;
        setAgentUrl(paramAgent);
      } else {
        const isLocal =
          window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
        if (!isLocal) {
          chosenAgent = DEFAULT_AGENT_URL;
          setAgentUrl(DEFAULT_AGENT_URL);
        } else {
          setAgentUrl("");
        }
      }

      // Load custom dev ports from localStorage
      try {
        const saved = localStorage.getItem("port_killer_dev_ports");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setDevPorts(parsed);
          }
        }
      } catch {
        // Ignore
      }
    }

    probeConnection(chosenAgent, true);
  }, [probeConnection]);

  // Periodic ping loop when modal is open to auto-detect when agent starts
  useEffect(() => {
    if (isConnectModalOpen && connectionStatus !== "connected") {
      pingTimerRef.current = setInterval(async () => {
        const ok = await probeConnection(agentUrl || DEFAULT_AGENT_URL, false);
        if (ok) {
          addToast("success", "Machine Connected!", "Local agent detected. Loading your ports...");
        }
      }, 1500);
    } else if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
    }
    return () => {
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    };
  }, [isConnectModalOpen, connectionStatus, agentUrl, probeConnection, addToast]);

  // Save dev ports to localStorage
  const saveDevPorts = (updated: DevPortItem[]) => {
    setDevPorts(updated);
    try {
      localStorage.setItem("port_killer_dev_ports", JSON.stringify(updated));
    } catch {
      // Ignore error
    }
  };

  // Add new dev port
  const handleAddDevPort = (e: React.FormEvent) => {
    e.preventDefault();
    const port = parseInt(newPortNumber.trim(), 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      addToast("error", "Invalid Port", "Port must be between 1 and 65535.");
      return;
    }
    if (devPorts.some((p) => p.port === port)) {
      addToast("info", "Already Monitored", `Port ${port} is already in your dev ports list.`);
      return;
    }

    const updated = [
      ...devPorts,
      {
        port,
        label: newPortLabel.trim() || `Dev Port ${port}`,
        isCustom: true,
      },
    ];
    saveDevPorts(updated);
    setNewPortNumber("");
    setNewPortLabel("");
    setShowAddPort(false);
    addToast("success", "Port Added", `Port ${port} added to monitored dev ports.`);
  };

  // Remove dev port
  const handleRemoveDevPort = (portToRemove: number) => {
    const updated = devPorts.filter((p) => p.port !== portToRemove);
    saveDevPorts(updated);
    addToast("info", "Port Removed", `Port ${portToRemove} removed from dev list.`);
  };

  // Fetch ports based on current scan mode
  const fetchPorts = useCallback(
    async (isSilent = false) => {
      if (connectionStatus === "disconnected") return;
      if (!isSilent) setIsLoading(true);

      try {
        if (scanMode === "dev") {
          const portsQuery = devPorts.map((p) => p.port).join(",");
          const endpoint = getApiUrl(`/api/ports?mode=dev&ports=${portsQuery}`);
          const res = await fetch(endpoint, { cache: "no-store" });
          const data = await res.json();
          if (data.success) {
            setDevStatusList(data.devStatus || []);
            setAllPorts(data.ports || []);
            if (data.system) setSystemInfo(data.system);
            setLastScanned(new Date());
            setConnectionStatus("connected");
          }
        } else {
          // Full scan mode
          const endpoint = getApiUrl("/api/ports?mode=all");
          const res = await fetch(endpoint, { cache: "no-store" });
          const data = await res.json();
          if (data.success) {
            setAllPorts(data.ports || []);
            if (data.system) setSystemInfo(data.system);
            setLastScanned(new Date());
            setConnectionStatus("connected");
          }
        }
      } catch (err: unknown) {
        if (!isSilent) {
          const msg = err instanceof Error ? err.message : "Network error";
          addToast("error", "Connection Error", msg);
        }
      } finally {
        if (!isSilent) setIsLoading(false);
      }
    },
    [scanMode, devPorts, connectionStatus, getApiUrl, addToast]
  );

  // Initial load and refetch on mode or port list change
  useEffect(() => {
    if (connectionStatus === "connected") {
      fetchPorts();
    }
  }, [fetchPorts, connectionStatus]);

  // Auto refresh timer
  useEffect(() => {
    if (!autoRefresh || connectionStatus !== "connected") return;
    const interval = setInterval(() => {
      fetchPorts(true);
    }, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchPorts, connectionStatus]);

  // Check specific port
  const handleCheckPort = async (portNum?: number) => {
    const target = portNum ?? parseInt(searchPort.trim(), 10);
    if (!target || isNaN(target) || target < 1 || target > 65535) {
      addToast("error", "Invalid Port", "Please enter a valid port number between 1 and 65535.");
      return;
    }

    setIsCheckingPort(true);
    try {
      const endpoint = getApiUrl(`/api/ports/${target}`);
      const res = await fetch(endpoint, { cache: "no-store" });
      const data = await res.json();

      if (data.success) {
        setInspectedPort({
          port: target,
          inUse: data.inUse,
          info: data.info,
          processes: data.processes,
        });
        if (data.inUse) {
          addToast(
            "info",
            `Port ${target} is Occupied`,
            `Process "${data.info?.process}" (PID ${data.info?.pid}) is listening on port ${target}.`
          );
        } else {
          addToast("success", `Port ${target} is Free!`, `No process is currently bound to port ${target}.`);
        }
      } else {
        addToast("error", "Check Failed", data.error || "Failed to inspect port.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error checking port";
      addToast("error", "Error", msg);
    } finally {
      setIsCheckingPort(false);
    }
  };

  // Terminate a single process
  const executeKill = async (target: PortInfo) => {
    setKillingPid(target.pid);
    try {
      const endpoint = getApiUrl("/api/kill");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid: target.pid, port: target.port, force: true }),
      });
      const data = await res.json();

      if (data.success) {
        addToast("success", "Port Released!", data.message || `Killed PID ${target.pid} on port ${target.port}.`);
        if (inspectedPort && inspectedPort.port === target.port) {
          handleCheckPort(target.port);
        }
        fetchPorts(true);
      } else {
        addToast("error", "Termination Failed", data.message || "Failed to terminate process.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error executing kill";
      addToast("error", "Error", msg);
    } finally {
      setKillingPid(null);
      setKillModalTarget(null);
    }
  };

  // Copy PID helper
  const copyToClipboard = (text: string, pid: number) => {
    navigator.clipboard.writeText(text);
    setCopiedPid(pid);
    setTimeout(() => setCopiedPid(null), 1800);
  };

  // Copy npx command helper
  const copyNpxCommand = () => {
    navigator.clipboard.writeText("npx port-killer");
    setHasCopiedCommand(true);
    addToast("info", "Command Copied!", "Paste and run 'npx port-killer' in your terminal.");
    setTimeout(() => setHasCopiedCommand(false), 2500);
  };

  // Status mapping for dev ports
  const devStatusMap = useMemo(() => {
    const map = new Map<number, DevPortStatus>();
    for (const item of devStatusList) {
      map.set(item.port, item);
    }
    return map;
  }, [devStatusList]);

  // Filtered ports for table in "all" mode
  const filteredPorts = useMemo(() => {
    return allPorts.filter((p) => {
      if (filterType === "user" && p.isSystemProcess) return false;
      if (filterType === "system" && !p.isSystemProcess) return false;

      if (!tableFilter.trim()) return true;
      const term = tableFilter.toLowerCase().trim();
      return (
        p.port.toString().includes(term) ||
        p.process.toLowerCase().includes(term) ||
        p.pid.toString().includes(term) ||
        (p.command && p.command.toLowerCase().includes(term)) ||
        (p.user && p.user.toLowerCase().includes(term))
      );
    });
  }, [allPorts, filterType, tableFilter]);

  const occupiedDevPortsCount = useMemo(() => {
    return devStatusList.filter((s) => s.inUse).length;
  }, [devStatusList]);

  return (
    <div className="min-h-screen text-slate-100 flex flex-col">
      {/* Toast Alerts */}
      <div className="fixed top-5 right-5 z-50 flex flex-col gap-3 pointer-events-none max-w-sm w-full">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto p-4 rounded-xl border shadow-2xl backdrop-blur-md transition-all duration-300 animate-in slide-in-from-top-3 flex items-start gap-3 ${
              t.type === "success"
                ? "bg-emerald-950/85 border-emerald-500/40 text-emerald-200"
                : t.type === "error"
                ? "bg-rose-950/85 border-rose-500/40 text-rose-200"
                : "bg-blue-950/85 border-blue-500/40 text-blue-200"
            }`}
          >
            {t.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />}
            {t.type === "error" && <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />}
            {t.type === "info" && <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-semibold">{t.title}</h4>
              <p className="text-xs opacity-90 break-words mt-0.5">{t.message}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Top Header */}
      <header className="border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-red-700 flex items-center justify-center shadow-lg shadow-rose-950/50 ring-1 ring-rose-400/30">
              <Flame className="w-5 h-5 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-rose-400 via-orange-300 to-amber-200">
                  PORT // KILLER
                </span>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-300">
                  Universal Agent
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono hidden sm:block">
                Web Dashboard for Local Machine Sockets
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Machine Connection Pill Button */}
            <button
              onClick={() => setIsConnectModalOpen(true)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all cursor-pointer ${
                connectionStatus === "connected"
                  ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/30"
                  : "bg-rose-950/50 border-rose-500/40 text-rose-300 hover:bg-rose-900/40 animate-pulse"
              }`}
              title="Click to manage local machine connection"
            >
              {connectionStatus === "connected" ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="hidden md:inline">
                    {systemInfo?.hostname || "Local Machine"} ({systemInfo?.platform || "Connected"})
                  </span>
                  <span className="md:hidden">Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                  <span>Connect Machine</span>
                </>
              )}
            </button>

            {/* Auto refresh button */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              disabled={connectionStatus !== "connected"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors border ${
                autoRefresh && connectionStatus === "connected"
                  ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/30 cursor-pointer"
                  : "bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed"
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${autoRefresh ? "text-emerald-400 animate-pulse" : "text-slate-500"}`} />
              <span className="hidden sm:inline">Live:</span>
              <span className="font-semibold">{autoRefresh ? "ON (3.5s)" : "OFF"}</span>
            </button>

            {/* Manual refresh button */}
            <button
              onClick={() => fetchPorts(false)}
              disabled={isLoading || connectionStatus !== "connected"}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-xs font-mono text-slate-200 border border-slate-700 transition-all disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-rose-400" : ""}`} />
              <span className="hidden sm:inline">Scan</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
        {/* DISCONNECTED HERO BANNER */}
        {connectionStatus !== "connected" && (
          <div className="rounded-2xl border-2 border-dashed border-rose-500/40 bg-rose-950/20 p-6 sm:p-8 text-center space-y-4 shadow-xl">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
              <Laptop className="w-6 h-6 animate-bounce" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">Connect Your Local Machine</h2>
              <p className="text-sm text-slate-400 max-w-lg mx-auto mt-1">
                To inspect your computer&apos;s ports and terminate rogue processes, run the one-line local agent in your terminal:
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 max-w-md mx-auto pt-2">
              <div className="w-full bg-slate-950 px-4 py-3 rounded-xl border border-slate-800 font-mono text-sm text-rose-400 flex items-center justify-between">
                <span>npx port-killer</span>
                <button
                  onClick={copyNpxCommand}
                  className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Copy command"
                >
                  {hasCopiedCommand ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={copyNpxCommand}
                className="w-full sm:w-auto px-5 py-3 bg-rose-600 hover:bg-rose-500 text-white font-mono text-xs font-bold rounded-xl shadow-lg shadow-rose-950/50 shrink-0 cursor-pointer"
              >
                Copy Command
              </button>
            </div>

            <div className="flex items-center justify-center gap-2 text-xs text-slate-400 font-mono pt-1">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-400" />
              <span>Waiting for local connection at 127.0.0.1:4999...</span>
            </div>
          </div>
        )}

        {/* HERO SECTION: Single Port Inspector */}
        <section className="relative rounded-2xl glass-panel p-6 sm:p-8 border border-rose-500/20 shadow-2xl overflow-hidden">
          <div className="absolute top-0 right-0 -mt-16 -mr-16 w-80 h-80 bg-rose-600/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-80 h-80 bg-orange-600/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 max-w-3xl mx-auto text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono">
              <Zap className="w-3.5 h-3.5 text-rose-400" />
              <span>Instant Port Killer</span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Is your port blocked? Kill it in one click.
            </h1>
            <p className="text-slate-400 text-sm sm:text-base max-w-xl mx-auto">
              Type any port number below or check your development watchlist. If any rogue server is holding it,
              terminate it instantly.
            </p>

            {/* Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCheckPort();
              }}
              className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3 max-w-lg mx-auto"
            >
              <div className="relative w-full">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={searchPort}
                  onChange={(e) => setSearchPort(e.target.value)}
                  placeholder="Enter port (e.g. 3000, 5173, 8080)..."
                  className="w-full pl-11 pr-4 py-3.5 bg-slate-900/90 border border-slate-700/80 rounded-xl text-slate-100 placeholder-slate-500 font-mono text-base focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-transparent transition-all shadow-inner"
                />
              </div>

              <button
                type="submit"
                disabled={isCheckingPort || !searchPort.trim()}
                className="w-full sm:w-auto px-6 py-3.5 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-semibold text-sm rounded-xl shadow-lg shadow-rose-950/60 border border-rose-400/30 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 cursor-pointer"
              >
                {isCheckingPort ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Checking...</span>
                  </>
                ) : (
                  <>
                    <span>Inspect Port</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* INSPECTED PORT CARD */}
          {inspectedPort && (
            <div className="mt-8 max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-200">
              {inspectedPort.inUse && inspectedPort.info ? (
                <div className="p-6 rounded-2xl bg-gradient-to-b from-rose-950/50 to-slate-900/90 border-2 border-rose-500/50 shadow-2xl glow-danger space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rose-500/20 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3.5 h-3.5 rounded-full bg-rose-500 animate-radar" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-2xl font-bold text-white">
                            Port {inspectedPort.port}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono text-xs font-semibold uppercase tracking-wider">
                            Occupied / In Use
                          </span>
                        </div>
                        <p className="text-xs text-rose-300/80 font-mono mt-0.5">
                          Bound Address: {inspectedPort.info.address} • Protocol: {inspectedPort.info.protocol}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleCheckPort(inspectedPort.port)}
                      disabled={isCheckingPort}
                      className="text-xs font-mono text-slate-400 hover:text-slate-200 flex items-center gap-1 bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${isCheckingPort ? "animate-spin" : ""}`} />
                      <span>Re-check</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                      <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wide">
                        Process Name
                      </span>
                      <p className="font-mono font-bold text-white text-base truncate mt-0.5">
                        {inspectedPort.info.process}
                      </p>
                    </div>

                    <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                      <div>
                        <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wide">
                          Process ID (PID)
                        </span>
                        <p className="font-mono font-bold text-rose-400 text-base mt-0.5">
                          {inspectedPort.info.pid}
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          copyToClipboard(inspectedPort.info!.pid.toString(), inspectedPort.info!.pid)
                        }
                        className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                        title="Copy PID"
                      >
                        {copiedPid === inspectedPort.info.pid ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                      <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wide">
                        User / Owner
                      </span>
                      <p className="font-mono font-medium text-slate-200 text-base truncate mt-0.5">
                        {inspectedPort.info.user || "Current User"}
                      </p>
                    </div>
                  </div>

                  {inspectedPort.info.command && (
                    <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/80 space-y-1">
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
                        <Terminal className="w-3.5 h-3.5 text-slate-500" />
                        <span>Command Line:</span>
                      </div>
                      <p className="font-mono text-xs text-slate-300 break-all bg-slate-900/90 p-2 rounded border border-slate-800">
                        {inspectedPort.info.command}
                      </p>
                    </div>
                  )}

                  <div className="pt-2">
                    <button
                      onClick={() => setKillModalTarget(inspectedPort.info!)}
                      disabled={killingPid === inspectedPort.info.pid}
                      className="w-full py-4 px-6 bg-gradient-to-r from-red-600 via-rose-600 to-red-700 hover:from-red-500 hover:via-rose-500 hover:to-red-600 active:scale-[0.99] text-white font-bold text-base rounded-xl shadow-xl shadow-red-950/80 border border-red-400/40 flex items-center justify-center gap-3 transition-all cursor-pointer"
                    >
                      <Flame className="w-5 h-5 text-white" />
                      <span>
                        {killingPid === inspectedPort.info.pid
                          ? "Terminating Process..."
                          : `KILL PROCESS (PID ${inspectedPort.info.pid}) & FREE PORT ${inspectedPort.port}`}
                      </span>
                      <Trash2 className="w-5 h-5 text-red-200" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-6 rounded-2xl bg-gradient-to-b from-emerald-950/40 to-slate-900/90 border-2 border-emerald-500/40 shadow-2xl glow-success space-y-3 text-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="font-mono text-2xl font-bold text-emerald-300">
                      Port {inspectedPort.port} is Available!
                    </h3>
                    <p className="text-sm text-slate-300 max-w-md mx-auto mt-1">
                      No process is currently listening on port {inspectedPort.port}. It is completely safe and ready
                      to start your development server.
                    </p>
                  </div>
                  <div className="pt-2">
                    <button
                      onClick={() => handleCheckPort(inspectedPort.port)}
                      disabled={isCheckingPort}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-300 rounded-lg border border-slate-700 transition-colors inline-flex items-center gap-2 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isCheckingPort ? "animate-spin" : ""}`} />
                      <span>Check Again</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* SCAN MODE SELECTOR */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <SlidersHorizontal className="w-5 h-5 text-rose-400" />
                <span>Monitoring View</span>
              </h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                {scanMode === "dev"
                  ? `Monitoring ${devPorts.length} development ports (${occupiedDevPortsCount} occupied)`
                  : `Full machine scan: ${allPorts.length} total listening sockets detected`}
              </p>
            </div>

            <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex items-center gap-1 self-start sm:self-auto">
              <button
                onClick={() => setScanMode("dev")}
                className={`px-4 py-2 rounded-lg text-xs font-mono font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                  scanMode === "dev"
                    ? "bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-lg shadow-rose-950/50"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Code2 className="w-4 h-4" />
                <span>Development Ports Only</span>
                {occupiedDevPortsCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-white text-[10px]">
                    {occupiedDevPortsCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setScanMode("all")}
                className={`px-4 py-2 rounded-lg text-xs font-mono font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                  scanMode === "all"
                    ? "bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-lg shadow-rose-950/50"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Globe className="w-4 h-4" />
                <span>All Machine Ports</span>
                <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 text-[10px]">
                  {allPorts.length}
                </span>
              </button>
            </div>
          </div>

          {/* VIEW 1: DEV PORTS ONLY */}
          {scanMode === "dev" ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400">
                  Targeted fast socket scan for your project stack:
                </span>

                <button
                  onClick={() => setShowAddPort(!showAddPort)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-rose-400" />
                  <span>Add Custom Port</span>
                </button>
              </div>

              {/* Add Custom Port Panel */}
              {showAddPort && (
                <form
                  onSubmit={handleAddDevPort}
                  className="p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col sm:flex-row items-center gap-3 animate-in fade-in"
                >
                  <div className="w-full sm:w-44">
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={newPortNumber}
                      onChange={(e) => setNewPortNumber(e.target.value)}
                      placeholder="Port (e.g. 4000)"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-white placeholder-slate-500 focus:ring-1 focus:ring-rose-500"
                      required
                    />
                  </div>

                  <div className="w-full sm:flex-1">
                    <input
                      type="text"
                      value={newPortLabel}
                      onChange={(e) => setNewPortLabel(e.target.value)}
                      placeholder="Label (e.g. NestJS Backend, GraphQL, Storybook)"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-white placeholder-slate-500 focus:ring-1 focus:ring-rose-500"
                    />
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      type="submit"
                      className="flex-1 sm:flex-none px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-mono font-bold rounded-lg cursor-pointer"
                    >
                      Save Port
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddPort(false)}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              )}

              {/* Dev Ports Grid Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {devPorts.map((devItem) => {
                  const status = devStatusMap.get(devItem.port);
                  const isOccupied = status ? status.inUse : false;
                  const info = status?.info;
                  const isKilling = killingPid === info?.pid;

                  return (
                    <div
                      key={devItem.port}
                      className={`rounded-xl border p-4 transition-all relative flex flex-col justify-between ${
                        isOccupied
                          ? "bg-rose-950/30 border-rose-500/50 shadow-lg shadow-rose-950/40"
                          : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/90"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-2xl font-extrabold text-white">
                              {devItem.port}
                            </span>
                            <span className="text-xs text-slate-400 font-mono truncate max-w-[130px]">
                              {devItem.label}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {isOccupied ? (
                              <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 font-mono text-[10px] font-bold uppercase flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                                In Use
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-semibold uppercase flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                Available
                              </span>
                            )}

                            {devPorts.length > 1 && (
                              <button
                                onClick={() => handleRemoveDevPort(devItem.port)}
                                className="p-1 rounded text-slate-600 hover:text-slate-400 hover:bg-slate-800 transition-colors ml-1 cursor-pointer"
                                title="Remove from dev ports list"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>

                        {isOccupied && info ? (
                          <div className="mt-3 p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs font-mono space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">Process:</span>
                              <span className="font-bold text-white truncate max-w-[150px]">
                                {info.process}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400">PID:</span>
                              <button
                                onClick={() => copyToClipboard(info.pid.toString(), info.pid)}
                                className="text-rose-400 hover:text-rose-300 flex items-center gap-1 cursor-pointer"
                                title="Copy PID"
                              >
                                <span>{info.pid}</span>
                                {copiedPid === info.pid ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3 opacity-60" />
                                )}
                              </button>
                            </div>
                            {info.command && (
                              <div className="pt-1 text-[11px] text-slate-500 truncate" title={info.command}>
                                {info.command}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-3 py-2 text-xs text-slate-500 font-mono">
                            Ready for binding. No active process.
                          </div>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center gap-2">
                        {isOccupied && info ? (
                          <button
                            onClick={() => setKillModalTarget(info)}
                            disabled={isKilling}
                            className="w-full py-2 px-3 bg-red-600 hover:bg-red-500 active:scale-95 text-white font-mono text-xs font-bold rounded-lg shadow-md shadow-red-950/50 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            {isKilling ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                <span>Killing...</span>
                              </>
                            ) : (
                              <>
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Kill Port {devItem.port}</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setSearchPort(devItem.port.toString());
                              handleCheckPort(devItem.port);
                            }}
                            className="w-full py-2 px-3 bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 font-mono text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Search className="w-3.5 h-3.5 text-slate-400" />
                            <span>Probe Socket</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* VIEW 2: ALL MACHINE PORTS TABLE */
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={tableFilter}
                    onChange={(e) => setTableFilter(e.target.value)}
                    placeholder="Filter by port, process name (node, python, docker), or PID..."
                    className="w-full pl-10 pr-4 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-sm font-mono placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-lg p-0.5 flex text-xs font-mono">
                  <button
                    onClick={() => setFilterType("all")}
                    className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                      filterType === "all" ? "bg-slate-800 text-white font-semibold" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    All ({allPorts.length})
                  </button>
                  <button
                    onClick={() => setFilterType("user")}
                    className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                      filterType === "user"
                        ? "bg-slate-800 text-white font-semibold"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    User Apps ({allPorts.filter((p) => !p.isSystemProcess).length})
                  </button>
                  <button
                    onClick={() => setFilterType("system")}
                    className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                      filterType === "system"
                        ? "bg-slate-800 text-white font-semibold"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    System ({allPorts.filter((p) => p.isSystemProcess).length})
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800/90 overflow-hidden bg-slate-950/60 backdrop-blur-sm shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800/80 bg-slate-900/70 text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                        <th className="py-3 px-4">Port</th>
                        <th className="py-3 px-4">Process Name</th>
                        <th className="py-3 px-4">PID</th>
                        <th className="py-3 px-4">User</th>
                        <th className="py-3 px-4">Protocol & Address</th>
                        <th className="py-3 px-4 hidden md:table-cell">Command Snippet</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50 text-xs font-mono">
                      {filteredPorts.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-slate-500">
                            {isLoading ? (
                              <div className="flex items-center justify-center gap-2">
                                <RefreshCw className="w-4 h-4 animate-spin text-rose-400" />
                                <span>Scanning host ports...</span>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <p className="text-slate-400 font-semibold">No active ports match your criteria</p>
                                <p className="text-[11px] text-slate-600">Try clearing your search filter or re-scan.</p>
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : (
                        filteredPorts.map((item) => {
                          const isKilling = killingPid === item.pid;

                          return (
                            <tr
                              key={`${item.port}-${item.pid}`}
                              className="group transition-colors hover:bg-slate-900/60"
                            >
                              <td className="py-3.5 px-4">
                                <button
                                  onClick={() => {
                                    setSearchPort(item.port.toString());
                                    handleCheckPort(item.port);
                                  }}
                                  className="font-bold text-sm text-white hover:text-rose-400 transition-colors flex items-center gap-1.5 cursor-pointer"
                                  title="Inspect this port above"
                                >
                                  <span>{item.port}</span>
                                  <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400" />
                                </button>
                              </td>

                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-200">{item.process}</span>
                                  {item.isSystemProcess && (
                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">
                                      SYSTEM
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="py-3.5 px-4">
                                <button
                                  onClick={() => copyToClipboard(item.pid.toString(), item.pid)}
                                  className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800 cursor-pointer"
                                  title="Click to copy PID"
                                >
                                  <span>{item.pid}</span>
                                  {copiedPid === item.pid ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3 opacity-50" />
                                  )}
                                </button>
                              </td>

                              <td className="py-3.5 px-4 text-slate-400">{item.user || "—"}</td>

                              <td className="py-3.5 px-4 text-slate-400">
                                <span>{item.address || "*"}</span>{" "}
                                <span className="text-[10px] text-slate-500">({item.protocol})</span>
                              </td>

                              <td
                                className="py-3.5 px-4 text-slate-500 max-w-xs truncate hidden md:table-cell"
                                title={item.command}
                              >
                                {item.command || item.process}
                              </td>

                              <td className="py-3.5 px-4 text-right">
                                <button
                                  onClick={() => setKillModalTarget(item)}
                                  disabled={isKilling}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/50 hover:bg-red-900/60 border border-red-500/40 text-red-300 hover:text-white text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                                  title={`Kill process ${item.process} (PID ${item.pid})`}
                                >
                                  {isKilling ? (
                                    <>
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                      <span>Killing...</span>
                                    </>
                                  ) : (
                                    <>
                                      <Trash2 className="w-3.5 h-3.5" />
                                      <span>Kill Port</span>
                                    </>
                                  )}
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-slate-800/80 bg-slate-950/80 mt-12 py-6 text-center text-xs font-mono text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            <span>Port Killer Web Dashboard • Connect via <code>npx port-killer</code></span>
          </div>
          <div className="flex items-center gap-3">
            <span>Platform: {systemInfo?.platform || "Local"}</span>
            <span>•</span>
            <span>Arch: {systemInfo?.arch || "Host"}</span>
          </div>
        </div>
      </footer>

      {/* CONNECT LOCAL MACHINE MODAL */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-2xl space-y-6 relative">
            <button
              onClick={() => setIsConnectModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-red-700 text-white flex items-center justify-center mx-auto shadow-lg shadow-rose-950/60">
                <Laptop className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-bold text-white">Connect Your Local Machine</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Due to browser security sandboxing, websites cannot scan your local sockets directly.
                Run the local companion agent in your terminal to inspect and kill your ports.
              </p>
            </div>

            {/* Instruction Box */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between text-slate-400">
                <span>Run in your terminal:</span>
                <span className="text-[10px] text-emerald-400">Zero install needed</span>
              </div>

              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 flex items-center justify-between text-rose-300 font-semibold text-sm">
                <span>npx port-killer</span>
                <button
                  onClick={copyNpxCommand}
                  className="text-slate-400 hover:text-white p-1.5 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Copy command"
                >
                  {hasCopiedCommand ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>

              <p className="text-[11px] text-slate-500">
                This starts a local loopback server on <code>127.0.0.1:4999</code> with CORS enabled for this dashboard.
              </p>
            </div>

            {/* Status Radar */}
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-3.5 h-3.5 rounded-full bg-rose-500 animate-radar" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-white">Listening for Local Agent...</h4>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">Target: {agentUrl}</p>
                </div>
              </div>

              <button
                onClick={() => probeConnection(agentUrl, false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-mono flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3 text-rose-400" />
                <span>Retry</span>
              </button>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setIsConnectModalOpen(false)}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs rounded-xl border border-slate-700 transition-colors cursor-pointer"
              >
                Continue Offline
              </button>
              <button
                onClick={copyNpxCommand}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-950/60 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{hasCopiedCommand ? "Copied!" : "Copy npx Command"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KILL CONFIRMATION MODAL */}
      {killModalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-red-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-950 border border-red-500/40 text-red-400 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Confirm Process Termination</h3>
                <p className="text-xs text-slate-400 font-mono">Freeing up Port {killModalTarget.port}</p>
              </div>
            </div>

            <div className="bg-slate-950/80 rounded-xl p-3.5 border border-slate-800 text-xs font-mono space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Target Port:</span>
                <span className="font-bold text-white">{killModalTarget.port}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Process Name:</span>
                <span className="font-bold text-rose-400">{killModalTarget.process}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Process ID (PID):</span>
                <span className="font-bold text-white">{killModalTarget.pid}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">User / Owner:</span>
                <span className="text-slate-300">{killModalTarget.user || "Current User"}</span>
              </div>
              {killModalTarget.command && (
                <div className="pt-1 border-t border-slate-800">
                  <span className="text-slate-500 block mb-1">Command:</span>
                  <span className="text-slate-300 break-all">{killModalTarget.command}</span>
                </div>
              )}
            </div>

            {killModalTarget.isSystemProcess && (
              <div className="p-3 bg-amber-950/40 border border-amber-500/30 rounded-xl flex items-start gap-2.5 text-xs text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  Warning: This process is flagged as a system process. Killing it may require elevated permissions.
                </span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setKillModalTarget(null)}
                className="flex-1 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs rounded-xl border border-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => executeKill(killModalTarget)}
                disabled={killingPid === killModalTarget.pid}
                className="flex-1 py-2.5 px-4 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-red-950/60 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Confirm Kill (SIGKILL)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
