const MAX_USERNAME_LEN = 32;
const MAX_MESSAGE_LEN = 500;
const MAX_SRC_LEN = 4096;
const MAX_USERS_PER_ROOM = 50;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 30;
const RECONNECT_GRACE_MS = 2 * 60 * 1000;
const HOST_RECONNECT_GRACE_MS = Math.max(100, Number(process.env.HOST_RECONNECT_GRACE_MS) || 60_000);
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function sanitizeString(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLen).replace(/[<>]/g, "");
}

function isValidMediaUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function createRateLimiter() {
  const counts = new Map();
  const isAllowed = (socketId) => {
    const now = Date.now();
    const entry = counts.get(socketId) || { count: 0, start: now };
    if (now - entry.start >= RATE_LIMIT_WINDOW_MS) {
      counts.set(socketId, { count: 1, start: now });
      return true;
    }
    if (entry.count >= RATE_LIMIT_MAX) return false;
    entry.count += 1;
    counts.set(socketId, entry);
    return true;
  };
  isAllowed.remove = (socketId) => counts.delete(socketId);
  return isAllowed;
}

function publicUsers(room) {
  return room.users
    .filter((user) => user.connected || user.isBlocked || user.isOwner)
    .map(({ id, username, uid, isOwner, isBlocked, connected, isReady }) => ({
      id, username, uid, isOwner, isBlocked, isReady, isConnected: connected,
    }));
}

function findConnectedUser(room, socketId) {
  return room?.users.find((user) => user.connected && user.id === socketId);
}

function sendRoomState(socket, room, user) {
  socket.emit("room-state", {
    videoState: playbackSnapshot(room),
    users: publicUsers(room),
    you: { uid: user.uid, isOwner: user.isOwner, isBlocked: user.isBlocked },
    hostReconnectUntil: room.hostReconnectUntil,
    queue: room.queue,
    subtitle: room.subtitle,
  });
}

function playbackSnapshot(room) {
  const state = room.videoState;
  return { ...state, currentTime: state.currentTime + (state.playing ? (Date.now() - room.updatedAt) / 1000 * state.speed : 0) };
}

async function main() {
  if (process.argv.includes("--production")) process.env.NODE_ENV = "production";
  const [{ createServer }, { Server }, fs, path, os, crypto, stream, streamPromises] = await Promise.all([
    import("node:http"),
    import("socket.io"),
    import("node:fs"),
    import("node:path"),
    import("node:os"),
    import("node:crypto"),
    import("node:stream"),
    import("node:stream/promises"),
  ]);
  const mediaDir = process.env.MEDIA_STORAGE_DIR || path.join(os.tmpdir(), "hometheater-media");
  await fs.promises.mkdir(mediaDir, { recursive: true });
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : process.env.NODE_ENV === "production" ? [] : ["http://localhost:3000"];
  if (!allowedOrigins.length || allowedOrigins.includes("*")) {
    throw new Error("Set ALLOWED_ORIGINS to the deployed frontend origin before starting the backend.");
  }

  const rooms = new Map();
  const httpServer = createServer(async (request, response) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    if (pathname === "/healthz") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", service: "hometheater" }));
      return;
    }
    if (pathname.startsWith("/socket.io/")) return;
    if (pathname.startsWith("/media/")) {
      try {
        await handleMediaRequest(request, response, pathname, {
          fs, path, crypto, stream, streamPromises, rooms, allowedOrigins, mediaDir,
        });
      } catch (error) {
        console.error("Media request failed:", error);
        if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Media request failed." }));
      }
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Not found" }));
  });
  httpServer.requestTimeout = 30 * 60 * 1000;

  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e5,
  });
  const rateLimit = createRateLimiter();

  const deleteRoom = (roomId, room) => {
    if (rooms.get(roomId) !== room) return;
    for (const user of room.users) {
      if (user.expiryTimer) clearTimeout(user.expiryTimer);
    }
    rooms.delete(roomId);
    io.in(roomId).emit("room-ended");
    io.in(roomId).socketsLeave(roomId);
    if (room.mediaPath) fs.promises.unlink(room.mediaPath).catch((error) => {
      console.error("Failed to remove room media:", error);
    });
    if (room.pendingMedia) {
      clearTimeout(room.pendingMedia.timer);
      fs.promises.unlink(room.pendingMedia.path).catch(() => {});
    }
  };

  const removeUser = (roomId, room, user) => {
    if (user.isOwner) {
      deleteRoom(roomId, room);
      return;
    }
    room.users = room.users.filter((member) => member !== user);
    io.to(roomId).emit("users-update", publicUsers(room));
  };

  const disconnectUser = (roomId, room, user) => {
    user.connected = false;
    user.isReady = false;
    if (user.expiryTimer) clearTimeout(user.expiryTimer);
    if (user.isOwner) {
      room.ownerSocketId = null;
      room.videoState = { ...playbackSnapshot(room), playing: false };
      room.updatedAt = Date.now();
      room.hostReconnectUntil = Date.now() + HOST_RECONNECT_GRACE_MS;
      user.expiryTimer = setTimeout(() => deleteRoom(roomId, room), HOST_RECONNECT_GRACE_MS);
      io.to(roomId).emit("video-state", room.videoState);
      io.to(roomId).emit("room-presence", { hostReconnectUntil: room.hostReconnectUntil });
    } else if (!user.isBlocked) {
      user.expiryTimer = setTimeout(() => removeUser(roomId, room, user), RECONNECT_GRACE_MS);
    }
    io.to(roomId).emit("users-update", publicUsers(room));
  };

  const changeSource = (roomId, room, src) => {
    room.videoState = { src, playing: false, currentTime: 0, speed: 1 };
    room.updatedAt = Date.now();
    room.subtitle = null;
    for (const member of room.users) member.isReady = false;
    io.to(roomId).emit("subtitle-update", null);
    io.to(roomId).emit("users-update", publicUsers(room));
  };

  io.on("connection", (socket) => {
    let currentRoomId = null;
    const guard = () => rateLimit(socket.id);

    socket.on("join-room", (payload = {}) => {
      if (!payload || typeof payload !== "object" || !guard()) return;
      const roomId = sanitizeString(payload.roomId, 64);
      const username = sanitizeString(payload.username, MAX_USERNAME_LEN) || "Guest";
      const participantToken = sanitizeString(payload.participantToken, 128);
      const ownerToken = sanitizeString(payload.ownerToken, 128);
      if (!/^[A-Za-z0-9]{16}$/.test(roomId) || !participantToken) {
        socket.emit("room-error", { message: "Invalid room code or session. Return home and try again." });
        return;
      }

      let room = rooms.get(roomId);
      if (!room && payload.createRoom === true && ownerToken) {
        room = {
          ownerToken,
          ownerParticipantToken: participantToken,
          ownerSocketId: null,
          users: [],
          videoState: { playing: false, currentTime: 0, src: "", speed: 1 },
          updatedAt: Date.now(),
          hostReconnectUntil: null,
          queue: [],
          subtitle: null,
          mediaPath: null,
          mediaType: null,
        };
        rooms.set(roomId, room);
      }
      if (!room) {
        socket.emit("room-error", { message: "Room not found. Check the code or ask the owner to create a new room." });
        return;
      }

      const isOwner = room.ownerToken === ownerToken && room.ownerParticipantToken === participantToken;
      if (payload.createRoom === true && ownerToken && !isOwner) {
        socket.emit("room-error", { message: "This room already exists and cannot be claimed by this browser." });
        return;
      }
      let user = room.users.find((member) => member.participantToken === participantToken);
      const onlineCount = room.users.filter((member) => member.connected && member !== user).length;
      const reservedHost = !isOwner && room.hostReconnectUntil ? 1 : 0;
      if (onlineCount + reservedHost >= MAX_USERS_PER_ROOM) {
        socket.emit("room-error", { message: "Room is full (maximum 50 participants, including the owner)." });
        return;
      }

      if (currentRoomId && currentRoomId !== roomId) {
        const previousRoom = rooms.get(currentRoomId);
        const previousUser = findConnectedUser(previousRoom, socket.id);
        if (previousUser) disconnectUser(currentRoomId, previousRoom, previousUser);
        socket.leave(currentRoomId);
      }

      if (!user) {
        user = {
          id: socket.id,
          participantToken,
          username,
          uid: crypto.randomBytes(4).toString("hex").toUpperCase(),
          isOwner,
          isBlocked: false,
          connected: true,
          isReady: false,
          expiryTimer: null,
        };
        room.users.push(user);
      } else {
        if (user.expiryTimer) clearTimeout(user.expiryTimer);
        if (user.connected && user.id !== socket.id) io.sockets.sockets.get(user.id)?.leave(roomId);
        user.id = socket.id;
        user.username = username;
        user.connected = true;
        user.isOwner = isOwner;
      }
      if (isOwner) {
        room.ownerSocketId = socket.id;
        room.hostReconnectUntil = null;
        io.to(roomId).emit("room-presence", { hostReconnectUntil: null });
      }
      currentRoomId = roomId;
      socket.join(roomId);
      io.to(roomId).emit("users-update", publicUsers(room));
      sendRoomState(socket, room, user);
      if (room.ownerSocketId && !isOwner) {
        io.to(room.ownerSocketId).emit("request-state", { forSocketId: socket.id });
      }
    });

    socket.on("sync-state", (payload = {}) => {
      if (!payload || typeof payload !== "object") return;
      const room = rooms.get(currentRoomId);
      const user = findConnectedUser(room, socket.id);
      if (!room || !user?.isOwner || user.isBlocked) return;
      const target = room.users.find((member) => member.connected && member.id === payload.forSocketId);
      if (!target) return;
      const incoming = payload.videoState || {};
      const currentTime = Number.isFinite(incoming.currentTime) ? Math.max(0, incoming.currentTime) : room.videoState.currentTime;
      room.videoState = {
        src: typeof incoming.src === "string" && incoming.src.length <= MAX_SRC_LEN && (!incoming.src || isValidMediaUrl(incoming.src))
          ? incoming.src : room.videoState.src,
        playing: typeof incoming.playing === "boolean" ? incoming.playing : room.videoState.playing,
        currentTime,
        speed: [0.5, 0.75, 1, 1.25, 1.5, 2].includes(incoming.speed) ? incoming.speed : room.videoState.speed,
      };
      room.updatedAt = Date.now();
      const targetSocket = io.sockets.sockets.get(target.id);
      if (targetSocket) sendRoomState(targetSocket, room, target);
    });

    socket.on("video-state", (state = {}) => {
      if (!state || typeof state !== "object") return;
      const room = rooms.get(currentRoomId);
      const user = findConnectedUser(room, socket.id);
      if (!room || !user?.isOwner || user.isBlocked || !guard()) return;
      const updated = {};
      if (typeof state.playing === "boolean") updated.playing = state.playing;
      if (typeof state.currentTime === "number" && Number.isFinite(state.currentTime)) updated.currentTime = Math.max(0, state.currentTime);
      if ([0.5, 0.75, 1, 1.25, 1.5, 2].includes(state.speed)) updated.speed = state.speed;
      if (typeof state.src === "string" && state.src.length <= MAX_SRC_LEN && (!state.src || isValidMediaUrl(state.src))) updated.src = state.src;
      if (!Object.keys(updated).length) return;
      if (updated.src !== undefined && updated.src !== room.videoState.src) changeSource(currentRoomId, room, updated.src);
      room.videoState = { ...playbackSnapshot(room), ...updated };
      room.updatedAt = Date.now();
      io.to(currentRoomId).emit("video-state", room.videoState);
    });

    socket.on("activate-media", (payload = {}, acknowledge) => {
      const room = rooms.get(currentRoomId);
      const user = findConnectedUser(room, socket.id);
      const respond = (result) => { if (typeof acknowledge === "function") acknowledge(result); };
      if (!user?.isOwner || !guard()) return respond({ error: "Only the host can load uploaded media." });
      const pending = room.pendingMedia;
      if (!pending || pending.id !== payload?.mediaId) return respond({ error: "This upload expired or was cancelled. Please upload again." });
      let url;
      try { url = new URL(payload.src); } catch { return respond({ error: "Invalid uploaded media URL." }); }
      if (!isValidMediaUrl(payload.src) || url.pathname !== `/media/${currentRoomId}` || url.searchParams.get("v") !== pending.id) return respond({ error: "Invalid uploaded media URL." });
      clearTimeout(pending.timer);
      const previousPath = room.mediaPath;
      room.mediaPath = pending.path;
      room.mediaType = pending.type;
      room.mediaId = pending.id;
      room.pendingMedia = null;
      changeSource(currentRoomId, room, payload.src);
      io.to(currentRoomId).emit("video-state", room.videoState);
      if (previousPath) fs.promises.unlink(previousPath).catch((error) => console.error("Failed to remove replaced media:", error));
      respond({ ok: true });
    });

    socket.on("request-playback-sync", () => {
      const room = rooms.get(currentRoomId);
      const user = findConnectedUser(room, socket.id);
      if (!room || !user || user.isOwner || user.isBlocked) return;
      socket.emit("playback-sync", playbackSnapshot(room));
    });

    socket.on("chat-message", (payload = {}) => {
      if (!payload || typeof payload !== "object") return;
      const room = rooms.get(currentRoomId);
      const user = findConnectedUser(room, socket.id);
      if (!room || !user || user.isBlocked || !guard()) return;
      const message = sanitizeString(payload.message, MAX_MESSAGE_LEN);
      if (!message) return;
      io.to(currentRoomId).emit("chat-message", { id: crypto.randomUUID(), senderUid: user.uid, username: user.username, message, time: Date.now() });
    });

    socket.on("set-ready", (payload = {}) => {
      const room = rooms.get(currentRoomId);
      const user = findConnectedUser(room, socket.id);
      if (!user || user.isBlocked || typeof payload?.ready !== "boolean" || !guard()) return;
      user.isReady = payload.ready;
      io.to(currentRoomId).emit("users-update", publicUsers(room));
    });

    socket.on("set-subtitle", (payload = {}, acknowledge) => {
      const room = rooms.get(currentRoomId);
      const user = findConnectedUser(room, socket.id);
      const respond = (result) => { if (typeof acknowledge === "function") acknowledge(result); };
      if (!user?.isOwner || !guard()) return respond({ error: "Only the host can change subtitles." });
      if (payload === null) room.subtitle = null;
      else if (typeof payload?.text === "string" && Buffer.byteLength(payload.text) <= 65_536 && /^WEBVTT(?:\s|$)/.test(payload.text)) {
        room.subtitle = { text: payload.text, label: sanitizeString(payload.label, 64) || "Subtitles" };
      } else return respond({ error: "Use a valid VTT or SRT subtitle file up to 64 KB." });
      io.to(currentRoomId).emit("subtitle-update", room.subtitle);
      respond({ ok: true });
    });

    socket.on("queue-add", (payload = {}, acknowledge) => {
      const room = rooms.get(currentRoomId);
      const user = findConnectedUser(room, socket.id);
      const respond = (result) => { if (typeof acknowledge === "function") acknowledge(result); };
      if (!user?.isOwner || !guard()) return respond({ error: "Only the host can edit the queue." });
      if (room.queue.length >= 20) return respond({ error: "The queue holds up to 20 links." });
      if (typeof payload?.src !== "string" || payload.src.length > MAX_SRC_LEN || !isValidMediaUrl(payload.src)) return respond({ error: "Enter a valid media URL." });
      room.queue.push({ id: crypto.randomUUID(), src: payload.src, title: sanitizeString(payload.title, 80) || "Untitled media" });
      io.to(currentRoomId).emit("queue-update", room.queue);
      respond({ ok: true });
    });

    socket.on("queue-remove", (payload = {}) => {
      const room = rooms.get(currentRoomId);
      if (!findConnectedUser(room, socket.id)?.isOwner || !guard()) return;
      room.queue = room.queue.filter((item) => item.id !== payload?.id);
      io.to(currentRoomId).emit("queue-update", room.queue);
    });

    socket.on("queue-next", () => {
      const room = rooms.get(currentRoomId);
      if (!findConnectedUser(room, socket.id)?.isOwner || !guard()) return;
      const next = room.queue.shift();
      if (!next) return;
      changeSource(currentRoomId, room, next.src);
      io.to(currentRoomId).emit("video-state", room.videoState);
      io.to(currentRoomId).emit("queue-update", room.queue);
    });

    socket.on("set-blocked", (payload = {}) => {
      if (!payload || typeof payload !== "object") return;
      const room = rooms.get(currentRoomId);
      const owner = findConnectedUser(room, socket.id);
      if (!room || !owner?.isOwner || owner.isBlocked || typeof payload.participantId !== "string" || typeof payload.blocked !== "boolean") return;
      const target = room.users.find((user) => user.uid === payload.participantId);
      if (!target || target.isOwner) return;
      target.isBlocked = payload.blocked;
      if (target.expiryTimer) clearTimeout(target.expiryTimer);
      target.expiryTimer = null;
      if (target.connected) io.to(target.id).emit("blocked-state", target.isBlocked);
      else if (!target.isBlocked) {
        const roomId = currentRoomId;
        target.expiryTimer = setTimeout(() => removeUser(roomId, room, target), RECONNECT_GRACE_MS);
      }
      io.to(currentRoomId).emit("users-update", publicUsers(room));
    });

    socket.on("end-room", () => {
      const room = rooms.get(currentRoomId);
      const user = findConnectedUser(room, socket.id);
      if (room && user?.isOwner) deleteRoom(currentRoomId, room);
    });

    socket.on("ping", (callback) => {
      const room = rooms.get(currentRoomId);
      const user = findConnectedUser(room, socket.id);
      if (user && !user.isBlocked && typeof callback === "function") callback();
    });

    socket.on("broadcast-ping", (payload = {}) => {
      if (!payload || typeof payload !== "object") return;
      const room = rooms.get(currentRoomId);
      const user = findConnectedUser(room, socket.id);
      if (!room || !user || user.isBlocked || typeof payload.ping !== "number" || !Number.isFinite(payload.ping)) return;
      socket.to(currentRoomId).emit("user-ping", { id: socket.id, ping: Math.min(60_000, Math.max(0, Math.round(payload.ping))) });
    });

    socket.on("leave-room", (payload) => {
      const roomId = currentRoomId;
      const room = rooms.get(roomId);
      const user = findConnectedUser(room, socket.id);
      if (!room || !user) {
        currentRoomId = null;
        return;
      }
      if (payload?.temporary === true) {
        disconnectUser(roomId, room, user);
        socket.leave(roomId);
      } else if (user.isOwner) {
        deleteRoom(roomId, room);
      } else if (user.isBlocked) {
        user.connected = false;
        socket.leave(roomId);
        io.to(roomId).emit("users-update", publicUsers(room));
      } else {
        removeUser(roomId, room, user);
        socket.leave(roomId);
      }
      currentRoomId = null;
    });

    socket.on("disconnect", () => {
      rateLimit.remove(socket.id);
      const roomId = currentRoomId;
      const room = rooms.get(roomId);
      const user = findConnectedUser(room, socket.id);
      if (!room || !user) return;
      disconnectUser(roomId, room, user);
    });
  });

  const port = process.env.NODE_ENV === "production"
    ? Number(process.env.PORT) || 3001
    : Number(process.env.BACKEND_PORT) || 3001;
  const host = process.env.HOST || "0.0.0.0";
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      console.log(`> Socket.IO/media backend listening on ${host}:${port}`);
      resolve();
    });
  });

  async function handleMediaRequest(request, response, pathname, context) {
    const { fs, path, crypto, stream, streamPromises, rooms, allowedOrigins, mediaDir } = context;
    const origin = request.headers.origin;
    const allowOrigin = !origin || allowedOrigins.includes(origin);
    if (!allowOrigin) {
      response.writeHead(403).end("Origin not allowed");
      return;
    }
    if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");

    let roomId;
    try {
      roomId = decodeURIComponent(pathname.slice("/media/".length));
    } catch {
      response.writeHead(404).end("Not found");
      return;
    }
    if (!/^[A-Za-z0-9]{16}$/.test(roomId)) {
      response.writeHead(404).end("Not found");
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Room-Token, Range",
        "Access-Control-Max-Age": "600",
      }).end();
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      response.writeHead(404).end("Room not found");
      return;
    }
    if (request.method === "POST") {
      const owner = room.ownerToken === request.headers["x-room-token"];
      if (!owner) {
        response.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Only the room owner can upload media." }));
        return;
      }
      const contentType = String(request.headers["content-type"] || "").toLowerCase();
      if (!/^(video|audio)\/[a-z0-9.+-]+$/.test(contentType)) {
        response.writeHead(415, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Upload must be a video or audio file." }));
        return;
      }
      const contentLength = Number(request.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
        response.writeHead(413, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Upload exceeds the 2 GB limit." }));
        return;
      }

      const tempPath = path.join(mediaDir, `${crypto.randomUUID()}.upload`);
      let bytes = 0;
      const limit = new stream.Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          if (bytes > MAX_UPLOAD_BYTES) callback(new Error("Upload exceeds the configured size limit."));
          else callback(null, chunk);
        },
      });
      try {
        await streamPromises.pipeline(request, limit, fs.createWriteStream(tempPath, { flags: "wx" }));
      } catch (error) {
        await fs.promises.unlink(tempPath).catch(() => {});
        if (error.message.includes("size limit")) {
          response.writeHead(413, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Upload exceeds the configured size limit." }));
        } else {
          response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Media upload did not complete." }));
        }
        return;
      }
      if (rooms.get(roomId) !== room || room.ownerToken !== request.headers["x-room-token"]) {
        await fs.promises.unlink(tempPath).catch(() => {});
        response.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "The room ended during upload." }));
        return;
      }
      if (!bytes) {
        await fs.promises.unlink(tempPath).catch(() => {});
        response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "The uploaded file is empty." }));
        return;
      }
      if (room.pendingMedia) {
        clearTimeout(room.pendingMedia.timer);
        fs.promises.unlink(room.pendingMedia.path).catch(() => {});
      }
      const pending = { id: crypto.randomUUID(), path: tempPath, type: contentType, timer: null };
      pending.timer = setTimeout(() => {
        if (room.pendingMedia === pending) room.pendingMedia = null;
        fs.promises.unlink(tempPath).catch(() => {});
      }, 60_000);
      room.pendingMedia = pending;
      response.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ uploaded: true, bytes, mediaId: pending.id }));
      return;
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD, POST, OPTIONS" }).end();
      return;
    }
    if (!room.mediaPath) {
      response.writeHead(404).end("Media not found");
      return;
    }
    const mediaPath = room.mediaPath;
    const mediaType = room.mediaType;
    const requestedVersion = new URL(request.url, "http://localhost").searchParams.get("v");
    if (requestedVersion && requestedVersion !== room.mediaId) {
      response.writeHead(404).end("This media has been replaced");
      return;
    }

    let stat;
    try {
      stat = await fs.promises.stat(mediaPath);
    } catch {
      response.writeHead(404).end("Media not found");
      return;
    }
    const range = request.headers.range;
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
        return;
      }
      if (!match[1]) {
        const suffixLength = Number(match[2]);
        start = Math.max(0, stat.size - suffixLength);
        if (!match[2] || !Number.isSafeInteger(suffixLength) || suffixLength <= 0) start = stat.size;
      } else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), end);
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
        response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
        return;
      }
      status = 206;
    }
    const headers = {
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": mediaType || "application/octet-stream",
      "Cache-Control": "private, no-store",
    };
    if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
    response.writeHead(status, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    const fileStream = fs.createReadStream(mediaPath, { start, end });
    response.on("close", () => fileStream.destroy());
    fileStream.on("error", (error) => {
      console.error("Failed to stream room media:", error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
    fileStream.pipe(response);
  }
}

main().catch((error) => {
  console.error(error.code === "EADDRINUSE"
    ? "The backend port is already in use. Use npm run dev to reuse a running HomeTheater backend, or set a different BACKEND_PORT."
    : `Failed to start HomeTheater server: ${error.message}`);
  process.exitCode = 1;
});
