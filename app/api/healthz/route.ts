export function GET() {
  return Response.json({
    status: "ok",
    service: "hometheater-frontend",
    socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL || "",
  }, { headers: { "Cache-Control": "no-store" } });
}
