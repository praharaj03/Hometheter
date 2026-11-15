import net from "node:net";
import { io } from "socket.io-client";

export async function isPortAvailable(port) {
  const listening = await Promise.all(["127.0.0.1", "::1"].map((host) => new Promise((resolve) => {
    const probe = net.createConnection({ host, port });
    const finish = (occupied) => { probe.destroy(); resolve(occupied); };
    probe.once("connect", () => finish(true));
    probe.once("error", () => finish(false));
    probe.setTimeout(500, () => finish(true));
  })));
  return !listening.some(Boolean);
}

function isLegacyHomeTheater(url) {
  // Older local servers have only { status: "ok" } at /healthz. An invalid
  // join identifies their protocol without creating a room or altering one.
  return new Promise((resolve) => {
    const socket = io(url, { autoConnect: false, reconnection: false, timeout: 1500, transports: ["polling"] });
    const timer = setTimeout(() => finish(false), 2000);
    const finish = (matches) => { clearTimeout(timer); socket.disconnect(); resolve(matches); };
    socket.once("connect", () => socket.emit("join-room", {}));
    socket.once("room-error", (error) => finish(error?.message === "Invalid room code or session. Return home and try again."));
    socket.once("connect_error", () => finish(false));
    socket.connect();
  });
}

export async function inspectBackend(url, frontendOrigin) {
  try {
    const response = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1500) });
    const health = response.ok ? await response.json() : null;
    if (health?.status !== "ok") return { compatible: false };
    const identified = health.service === "hometheater" || (!health.service && await isLegacyHomeTheater(url));
    if (!identified) return { compatible: false };
    const preflight = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      method: "OPTIONS",
      headers: { Origin: frontendOrigin, "Access-Control-Request-Method": "GET" }, signal: AbortSignal.timeout(1500),
    });
    await preflight.body?.cancel();
    return { compatible: true, originAllowed: preflight.ok && preflight.headers.get("access-control-allow-origin") === frontendOrigin };
  } catch { return { compatible: false }; }
}

export async function inspectFrontend(url, socketUrl) {
  try {
    const response = await fetch(`${url}/api/healthz`, { signal: AbortSignal.timeout(5000) });
    const health = response.ok ? await response.json() : null;
    return {
      compatible: health?.status === "ok" && health.service === "hometheater-frontend",
      socketMatches: typeof health?.socketUrl === "string" && health.socketUrl.replace(/\/$/, "") === socketUrl,
    };
  } catch { return { compatible: false, socketMatches: false }; }
}
