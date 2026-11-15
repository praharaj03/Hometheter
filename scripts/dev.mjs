import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { inspectBackend, inspectFrontend, isPortAvailable } from "./dev-services.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
nextEnv.loadEnvConfig(projectRoot, true);

const frontendPort = Number(process.env.FRONTEND_PORT || 3000);
const backendPort = Number(process.env.BACKEND_PORT || 3001);
if (![frontendPort, backendPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535) || frontendPort === backendPort) {
  throw new Error("FRONTEND_PORT and BACKEND_PORT must be different valid port numbers.");
}

const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === "win32") {
      // Stop only the process trees started by this launcher, including Next's worker.
      spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else child.kill("SIGTERM");
  }
  process.exitCode = code;
}

function launch(args, env) {
  const child = spawn(process.execPath, args, { cwd: projectRoot, env, windowsHide: true, stdio: "inherit" });
  children.add(child);
  child.once("error", (error) => { console.error(error.message); stop(1); });
  child.once("exit", (code) => {
    children.delete(child);
    if (!stopping) stop(code ?? 1);
  });
  return child;
}

process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());

const localSocketUrl = `http://localhost:${backendPort}`;
const allowedOrigins = [...new Set([
  ...(process.env.ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean),
  `http://localhost:${frontendPort}`,
  `http://127.0.0.1:${frontendPort}`,
])].join(",");
const env = { ...process.env, NODE_ENV: "development", BACKEND_PORT: String(backendPort), ALLOWED_ORIGINS: allowedOrigins, NEXT_PUBLIC_SOCKET_URL: localSocketUrl };

try {
  const backendOnly = process.argv.includes("--backend-only");
  let reuseFrontend = false;
  if (!backendOnly && !await isPortAvailable(frontendPort)) {
    const existing = await inspectFrontend(`http://localhost:${frontendPort}`, localSocketUrl);
    if (!existing.compatible) throw new Error(`Frontend port ${frontendPort} is occupied by another service. Stop it or set a different FRONTEND_PORT.`);
    if (!existing.socketMatches) throw new Error("The running HomeTheater frontend uses a different backend URL. Stop that frontend and run npm run dev again.");
    reuseFrontend = true;
    console.log(`HomeTheater frontend is already running: http://localhost:${frontendPort}`);
  }
  console.log(`HomeTheater local backend: ${localSocketUrl}`);
  if (!await isPortAvailable(backendPort)) {
    const existing = await inspectBackend(localSocketUrl, `http://localhost:${frontendPort}`);
    if (!existing.compatible) throw new Error(`Port ${backendPort} is occupied by another service or an unhealthy backend. Stop that service or set a different BACKEND_PORT.`);
    if (!existing.originAllowed) throw new Error(`The running HomeTheater backend does not allow http://localhost:${frontendPort}. Restart it with this frontend in ALLOWED_ORIGINS, or choose another BACKEND_PORT.`);
    console.log("Reusing the running HomeTheater backend. It will stay running when this frontend stops.");
  } else {
    launch(["server.js"], env);
    let ready = false;
    for (let attempt = 0; attempt < 50 && !stopping; attempt++) {
      const state = await inspectBackend(localSocketUrl, `http://localhost:${frontendPort}`);
      if (state.compatible && state.originAllowed) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!stopping && !ready) throw new Error("Local backend did not start. Check the error above or choose another BACKEND_PORT.");
  }
  if (!stopping && !backendOnly && !reuseFrontend) launch([require.resolve("next/dist/bin/next"), "dev", "--port", String(frontendPort)], env);
} catch (error) {
  console.error(error.message);
  stop(1);
}
