import { NextRequest, NextResponse } from "next/server";
import { checkPortStatus } from "@/lib/portScanner";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ port: string }> }
) {
  try {
    const { port: portParam } = await context.params;
    const port = parseInt(portParam, 10);

    if (isNaN(port) || port < 1 || port > 65535) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid port number. Must be an integer between 1 and 65535.",
        },
        { status: 400 }
      );
    }

    const result = await checkPortStatus(port);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to check port";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}
