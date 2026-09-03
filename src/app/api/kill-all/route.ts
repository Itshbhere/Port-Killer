import { NextRequest, NextResponse } from "next/server";
import { killProcessByPid } from "@/lib/portScanner";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const items: Array<{ pid: number; port?: number }> = body.items || [];

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, message: "No processes specified for termination." },
        { status: 400 }
      );
    }

    const results = await Promise.all(
      items.map((item) => killProcessByPid(item.pid, item.port, true))
    );

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return NextResponse.json({
      success: failed === 0,
      total: items.length,
      successful,
      failed,
      results,
    });
  } catch (error: unknown) {
    console.error("API /api/kill-all error:", error);
    const msg = error instanceof Error ? error.message : "Failed to execute batch kill.";
    return NextResponse.json(
      { success: false, message: msg },
      { status: 500 }
    );
  }
}
