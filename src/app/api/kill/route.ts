import { NextRequest, NextResponse } from "next/server";
import { killProcessByPid } from "@/lib/portScanner";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pid, port, force = true } = body;

    const parsedPid = parseInt(pid, 10);
    const parsedPort = port ? parseInt(port, 10) : undefined;

    if (!parsedPid || isNaN(parsedPid)) {
      return NextResponse.json(
        { success: false, message: "A valid PID is required to terminate a process." },
        { status: 400 }
      );
    }

    const result = await killProcessByPid(parsedPid, parsedPort, Boolean(force));

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error: unknown) {
    console.error("API /api/kill error:", error);
    const msg = error instanceof Error ? error.message : "Failed to execute kill request.";
    return NextResponse.json(
      { success: false, message: msg },
      { status: 500 }
    );
  }
}
