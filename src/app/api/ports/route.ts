import { NextRequest, NextResponse } from "next/server";
import {
  getAllListeningPorts,
  getMultiplePortsStatus,
  getSystemInfo,
  PortInfo,
} from "@/lib/portScanner";

export const dynamic = "force-dynamic";

const DEFAULT_DEV_PORTS = [3000, 3001, 5173, 8000, 8080, 4200, 5000, 5432, 27017, 6379];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") || "all";
    const portsParam = searchParams.get("ports");

    const system = getSystemInfo();

    // Targeted dev ports mode
    if (mode === "dev" || portsParam) {
      const portNumbers = portsParam
        ? portsParam
            .split(",")
            .map((p) => parseInt(p.trim(), 10))
            .filter((p) => !isNaN(p) && p >= 1 && p <= 65535)
        : DEFAULT_DEV_PORTS;

      const devStatus = await getMultiplePortsStatus(portNumbers);
      const activePorts = devStatus
        .filter((s) => s.inUse && s.info)
        .map((s) => s.info as PortInfo);

      return NextResponse.json({
        success: true,
        mode: "dev",
        timestamp: new Date().toISOString(),
        system,
        count: activePorts.length,
        ports: activePorts,
        devStatus,
      });
    }

    // Full system scan mode
    const ports = await getAllListeningPorts();

    return NextResponse.json({
      success: true,
      mode: "all",
      timestamp: new Date().toISOString(),
      system,
      count: ports.length,
      ports,
    });
  } catch (error: unknown) {
    console.error("API /api/ports error:", error);
    const msg = error instanceof Error ? error.message : "Failed to scan ports";
    return NextResponse.json(
      { success: false, error: msg, ports: [] },
      { status: 500 }
    );
  }
}
