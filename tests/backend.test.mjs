import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";
import { inspectBackend, isPortAvailable } from "../scripts/dev-services.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function event(socket, name, predicate = () => true, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, receive); reject(new Error(`Timed out waiting for ${name}`)); }, timeout);
    function receive(data) {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(name, receive);
      resolve(data);
    }
    socket.on(name, receive);
  });
}

test("watch-party backend", { timeout: 30_000 }, async (t) => {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "hometheater-test-"));
  const backend = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot, windowsHide: true,
    env: { ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", BACKEND_PORT: String(port), ALLOWED_ORIGINS: "http://localhost:3000", HOST_RECONNECT_GRACE_MS: "1000", MEDIA_STORAGE_DIR: directory },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverErrors = "";
  backend.stderr.on("data", (data) => { serverErrors += data; });
  const clients = [];
  const owners = new Map();
  t.after(async () => {
    clients.forEach((socket) => socket.disconnect());
    if (backend.exitCode === null) { const exited = once(backend, "exit"); backend.kill(); await exited; }
    assert.ok(directory.startsWith(path.join(os.tmpdir(), "hometheater-test-")));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Backend startup timed out: ${serverErrors}`)), 5000);
    backend.stdout.once("data", () => { clearTimeout(timer); resolve(); });
    backend.once("error", (error) => { clearTimeout(timer); reject(error); });
    backend.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Backend exited ${code}: ${serverErrors}`)); });
  });

  async function connect() {
    const socket = io(base, { transports: ["websocket"], reconnection: false });
    clients.push(socket);
    await event(socket, "connect");
    return socket;
  }
  async function join(socket, payload) {
    const response = event(socket, "room-state");
    socket.emit("join-room", payload);
    return response;
  }
  async function room() {
    const host = await connect();
    const roomId = randomBytes(8).toString("hex");
    const ownerToken = randomUUID();
    const participantToken = randomUUID();
    const payload = { roomId, username: "Alex", ownerToken, participantToken, createRoom: true };
    const state = await join(host, payload);
    assert.equal(state.you.isOwner, true);
    owners.set(ownerToken, host);
    return { host, roomId, ownerToken, payload };
  }
  async function upload(roomId, ownerToken, data, activate = true) {
    const response = await fetch(`${base}/media/${roomId}`, { method: "POST", headers: { "Content-Type": "video/mp4", "X-Room-Token": ownerToken }, body: data });
    const result = { status: response.status, ...await response.json() };
    if (response.status === 201 && activate) {
      assert.equal((await ack(owners.get(ownerToken), "activate-media", { mediaId: result.mediaId, src: `${base}/media/${roomId}?v=${result.mediaId}` })).ok, true);
    }
    return result;
  }
  async function ack(socket, name, payload) {
    return new Promise((resolve, reject) => socket.timeout(3000).emit(name, payload, (error, result) => error ? reject(error) : resolve(result)));
  }

  async function runBackendLauncher(backendPort, { backendOnly = true, frontendPort = 3000 } = {}) {
    const child = spawn(process.execPath, ["scripts/dev.mjs", ...(backendOnly ? ["--backend-only"] : [])], {
      cwd: projectRoot, windowsHide: true,
      env: { ...process.env, BACKEND_PORT: String(backendPort), FRONTEND_PORT: String(frontendPort) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    const [code] = await once(child, "exit");
    return { code, stdout, stderr };
  }

  await t.test("launcher reuses the running backend without losing its rooms", async () => {
    const { host, payload } = await room();
    assert.equal(await isPortAvailable(port), false);
    assert.deepEqual(await inspectBackend(base, "http://localhost:3000"), { compatible: true, originAllowed: true });
    assert.deepEqual(await inspectBackend(base, "http://localhost:3999"), { compatible: true, originAllowed: false });
    const result = await runBackendLauncher(port);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Reusing the running HomeTheater backend/);
    const state = await join(host, payload);
    assert.equal(state.you.isOwner, true);
    assert.equal(state.users.length, 1);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    host.emit("end-room");
  });

  await t.test("repeated dev startup reuses both services and exits successfully", async () => {
    const existingBackend = http.createServer((request, response) => {
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "Access-Control-Allow-Origin": request.headers.origin }).end();
      } else response.writeHead(200, { "Content-Type": "application/json" }).end('{"status":"ok","service":"hometheater"}');
    });
    existingBackend.listen(0, "127.0.0.1");
    await once(existingBackend, "listening");
    const existingPort = existingBackend.address().port;
    const existingFrontend = http.createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", service: "hometheater-frontend", socketUrl: `http://localhost:${existingPort}` }));
    });
    existingFrontend.listen(0, "127.0.0.1");
    await once(existingFrontend, "listening");
    const frontendPort = existingFrontend.address().port;
    try {
      const result = await runBackendLauncher(existingPort, { backendOnly: false, frontendPort });
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /frontend is already running/);
      assert.match(result.stdout, /Reusing the running HomeTheater backend/);
      assert.equal((await fetch(`http://127.0.0.1:${existingPort}/healthz`)).status, 200);
      assert.equal((await fetch(`http://127.0.0.1:${frontendPort}/api/healthz`)).status, 200);
    } finally {
      await Promise.all([new Promise((resolve) => existingBackend.close(resolve)), new Promise((resolve) => existingFrontend.close(resolve))]);
    }
  });

  await t.test("an unrelated occupied port gets a clear error and its service is preserved", async () => {
    const other = http.createServer((request, response) => {
      if (request.url === "/healthz") response.writeHead(200, { "Content-Type": "application/json" }).end('{"status":"ok"}');
      else response.writeHead(404).end("Other service");
    });
    other.listen(0, "127.0.0.1");
    await once(other, "listening");
    const otherPort = other.address().port;
    try {
      const result = await runBackendLauncher(otherPort);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /occupied by another service or an unhealthy backend/);
      assert.doesNotMatch(result.stderr, /Unhandled|node:events/);
      assert.equal((await fetch(`http://127.0.0.1:${otherPort}/healthz`)).status, 200);
    } finally { await new Promise((resolve) => other.close(resolve)); }
  });

  await t.test("same-name chat uses distinct stable identities", async () => {
    const { host, roomId } = await room();
    const guest = await connect();
    const payload = { roomId, username: "Alex", participantToken: randomUUID() };
    const original = await join(guest, payload);
    const received = event(host, "chat-message");
    guest.emit("chat-message", { message: "hello", senderUid: "forged-id" });
    const message = await received;
    assert.equal(message.username, "Alex");
    assert.equal(message.senderUid, original.you.uid);
    assert.ok(message.id);
    guest.disconnect();
    const replacement = await connect();
    const rejoined = await join(replacement, payload);
    assert.equal(rejoined.you.uid, original.you.uid);
    host.emit("end-room");
  });

  await t.test("host disconnect pauses and reconnect restores the same room and media", async () => {
    const { host, roomId, payload } = await room();
    const guest = await connect();
    await join(guest, { roomId, username: "Guest", participantToken: randomUUID() });
    const playing = event(guest, "video-state", (state) => state.playing);
    host.emit("video-state", { src: "https://example.com/movie.mp4", playing: true, currentTime: 42 });
    await playing;
    const disconnected = event(guest, "room-presence", (state) => state.hostReconnectUntil !== null);
    host.disconnect();
    assert.ok((await disconnected).hostReconnectUntil > Date.now());
    const restored = event(guest, "room-presence", (state) => state.hostReconnectUntil === null);
    const newHost = await connect();
    const state = await join(newHost, payload);
    await restored;
    assert.equal(state.you.isOwner, true);
    assert.equal(state.videoState.playing, false);
    assert.equal(state.videoState.src, "https://example.com/movie.mp4");
    assert.ok(state.videoState.currentTime >= 42);
    assert.equal(state.users.filter((user) => user.isOwner).length, 1);
    const ended = event(guest, "room-ended");
    newHost.emit("end-room");
    await ended;
  });

  await t.test("expired host recovery closes the room", async () => {
    const { host, roomId } = await room();
    const guest = await connect();
    await join(guest, { roomId, username: "Guest", participantToken: randomUUID() });
    const ended = event(guest, "room-ended");
    host.disconnect();
    await ended;
    const response = await fetch(`${base}/media/${roomId}`);
    assert.equal(response.status, 404);
  });

  await t.test("temporary effect cleanup does not end the host room", async () => {
    const { host, payload } = await room();
    host.emit("leave-room", { temporary: true });
    const state = await join(host, payload);
    assert.equal(state.you.isOwner, true);
    assert.equal(state.hostReconnectUntil, null);
    host.emit("end-room");
  });

  await t.test("suffix, open, bounded, and invalid byte ranges", async () => {
    const { host, roomId, ownerToken } = await room();
    const data = Buffer.from(Array.from({ length: 100 }, (_, index) => index));
    assert.equal((await upload(roomId, ownerToken, data)).status, 201);
    for (const [range, start, end] of [["bytes=-10", 90, 99], ["bytes=0-0", 0, 0], ["bytes=10-", 10, 99], ["bytes=-200", 0, 99], ["bytes=90-200", 90, 99]]) {
      const response = await fetch(`${base}/media/${roomId}`, { headers: { Range: range } });
      assert.equal(response.status, 206, range);
      assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/100`, range);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), data.subarray(start, end + 1), range);
    }
    for (const range of ["bytes=-0", "bytes=-", "bytes=100-", "bytes=90-10", "bytes=0-2,5-6"]) {
      assert.equal((await fetch(`${base}/media/${roomId}`, { headers: { Range: range } })).status, 416, range);
    }
    const head = await fetch(`${base}/media/${roomId}`, { method: "HEAD", headers: { Range: "bytes=-10" } });
    assert.equal(head.headers.get("content-length"), "10");
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    host.emit("end-room");
  });

  await t.test("replacement uploads get unique versions and empty files are rejected", async () => {
    const { host, roomId, ownerToken } = await room();
    const first = await upload(roomId, ownerToken, Buffer.from("first movie"));
    const second = await upload(roomId, ownerToken, Buffer.from("second movie"));
    assert.notEqual(first.mediaId, second.mediaId);
    assert.equal((await fetch(`${base}/media/${roomId}?v=${first.mediaId}`)).status, 404);
    const fresh = await fetch(`${base}/media/${roomId}?v=${second.mediaId}`);
    assert.equal(await fresh.text(), "second movie");
    assert.equal((await upload(roomId, ownerToken, Buffer.alloc(0))).status, 400);
    host.emit("end-room");
  });

  await t.test("cancelled uploads remove their partial file", async () => {
    const { host, roomId, ownerToken } = await room();
    const before = await fs.readdir(directory);
    await new Promise((resolve) => {
      const request = http.request(`${base}/media/${roomId}`, { method: "POST", headers: { "Content-Type": "video/mp4", "Content-Length": 100_000, "X-Room-Token": ownerToken } });
      request.on("error", () => {});
      request.write(Buffer.alloc(1024));
      setTimeout(() => { request.destroy(); resolve(); }, 50);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const remaining = await fs.readdir(directory);
    assert.ok(remaining.every((file) => before.includes(file)), "No new partial upload remains");
    host.emit("end-room");
  });

  await t.test("a finished but unconfirmed upload leaves the current movie intact", async () => {
    const { host, roomId, ownerToken } = await room();
    const active = await upload(roomId, ownerToken, Buffer.from("current movie"));
    const pending = await upload(roomId, ownerToken, Buffer.from("cancelled replacement"), false);
    assert.notEqual(active.mediaId, pending.mediaId);
    const current = await fetch(`${base}/media/${roomId}?v=${active.mediaId}`);
    assert.equal(current.status, 200);
    assert.equal(await current.text(), "current movie");
    assert.equal((await fetch(`${base}/media/${roomId}?v=${pending.mediaId}`)).status, 404);
    host.emit("end-room");
  });

  await t.test("queue, captions, readiness, reconnect snapshots, and owner permissions", async () => {
    const { host, roomId } = await room();
    const guest = await connect();
    const guestPayload = { roomId, username: "Guest", participantToken: randomUUID() };
    const guestState = await join(guest, guestPayload);
    assert.ok((await ack(guest, "queue-add", { src: "https://example.com/forbidden.mp4" })).error);
    assert.ok((await ack(guest, "set-subtitle", { text: "WEBVTT\n" })).error);
    assert.equal((await ack(host, "queue-add", { title: "Next film", src: "https://example.com/next.mp4" })).ok, true);
    const next = event(guest, "video-state", (state) => state.src.endsWith("next.mp4"));
    host.emit("queue-next");
    assert.equal((await next).playing, false);
    const text = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n";
    assert.equal((await ack(host, "set-subtitle", { text, label: "English" })).ok, true);
    const ready = event(host, "users-update", (users) => users.some((user) => user.uid === guestState.you.uid && user.isReady));
    guest.emit("set-ready", { ready: true });
    await ready;
    const snapshot = await join(guest, guestPayload);
    assert.equal(snapshot.subtitle.text, text);
    assert.equal(snapshot.users.find((user) => user.uid === guestState.you.uid).isReady, true);
    const reset = event(guest, "users-update", (users) => users.every((user) => !user.isReady));
    host.emit("video-state", { src: "https://example.com/another.mp4" });
    await reset;
    const updated = await join(guest, guestPayload);
    assert.equal(updated.subtitle, null);
    host.emit("end-room");
  });
});
