const { createServer } = require("http");
const { Server } = require("socket.io");
const next = require("next");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_USERNAME_LEN = 32;
const MAX_MESSAGE_LEN = 500;
const MAX_SRC_LEN = 2048;
const MAX_USERS_PER_ROOM = 50;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 30; // max events per window

// ── Helpers ──────────────────────────────────────────────────────────────────
function sanitizeString(str, maxLen) {
  if (typeof str !== "string") return "";
  return str.trim().slice(0, maxLen).replace(/[<>]/g, "");
}

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function genUid(room) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const existing = new Set((room?.users || []).map((u) => u.uid));
  let uid;
  do {
    uid = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (existing.has(uid));
  return uid;
}

// ── Rate limiter ─────────────────────────────────────────────────────────────
function createRateLimiter() {
  const counts = new Map();
  return function isAllowed(socketId) {
    const now = Date.now();
    const entry = counts.get(socketId) || { count: 0, start: now };
    if (now - entry.start > RATE_LIMIT_WINDOW_MS) {
      counts.set(socketId, { count: 1, start: now });
      return true;
    }
    if (entry.count >= RATE_LIMIT_MAX) return false;
    entry.count++;
    counts.set(socketId, entry);
    return true;
  };
}

// ── App ──────────────────────────────────────────────────────────────────────
app.prepare().then(() => {
  const httpServer = createServer(handle);

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
    : ["http://localhost:3000"];

  const io = new Server(httpServer, {
    cors: {
      origin: dev ? "*" : allowedOrigins,
      methods: ["GET", "POST"],
    },
    maxHttpBufferSize: 1e5, // 100KB max payload
  });

  /** @type {Record<string, { videoState: object, users: any[], ownerSocketId: string|null }>} */
  const rooms = {};
  const rateLimiter = createRateLimiter();

  io.on("connection", (socket) => {
    let currentRoom = null;
    let currentUser = null;

    const guard = () => rateLimiter(socket.id);

    socket.on("join-room", ({ roomId, username, isOwner }) => {
      const safeRoomId = sanitizeString(roomId, 64);
      const safeUsername = sanitizeString(username, MAX_USERNAME_LEN) || "Guest";

      if (!safeRoomId) return;

      currentRoom = safeRoomId;
      currentUser = safeUsername;

      if (!rooms[safeRoomId]) {
        rooms[safeRoomId] = {
          videoState: { playing: false, currentTime: 0, src: "", speed: 1 },
          users: [],
          ownerSocketId: null,
        };
      }

      const room = rooms[safeRoomId];

      if (room.users.length >= MAX_USERS_PER_ROOM) {
        socket.emit("error", { message: "Room is full" });
        return;
      }

      if (isOwner) room.ownerSocketId = socket.id;
      socket.join(safeRoomId);

      const uid = genUid(room);
      if (!room.users.find((u) => u.id === socket.id)) {
        room.users.push({ id: socket.id, username: safeUsername, uid, isOwner: !!isOwner });
      }

      io.to(safeRoomId).emit("users-update", room.users);

      if (!isOwner && room.ownerSocketId) {
        io.to(room.ownerSocketId).emit("request-state", { forSocketId: socket.id });
      } else {
        socket.emit("room-state", { ...room, uid });
      }
    });

    socket.on("sync-state", ({ forSocketId, videoState: vs }) => {
      if (!currentRoom || !rooms[currentRoom]) return;
      const room = rooms[currentRoom];
      // Validate videoState fields
      const safeVs = {
        src: typeof vs?.src === "string" ? vs.src.slice(0, MAX_SRC_LEN) : room.videoState.src,
        playing: typeof vs?.playing === "boolean" ? vs.playing : room.videoState.playing,
        currentTime: typeof vs?.currentTime === "number" && isFinite(vs.currentTime) ? vs.currentTime : room.videoState.currentTime,
        speed: [0.5, 0.75, 1, 1.25, 1.5, 2].includes(vs?.speed) ? vs.speed : room.videoState.speed,
      };
      room.videoState = { ...room.videoState, ...safeVs };
      const participant = room.users.find((u) => u.id === forSocketId);
      const uid = participant?.uid ?? "";
      io.to(forSocketId).emit("room-state", { ...room, uid });
    });

    socket.on("video-state", (state) => {
      if (!currentRoom || !guard()) return;
      const room = rooms[currentRoom];
      if (!room) return;
      const safeState = {};
      if (typeof state?.playing === "boolean") safeState.playing = state.playing;
      if (typeof state?.currentTime === "number" && isFinite(state.currentTime)) safeState.currentTime = Math.max(0, state.currentTime);
      if ([0.5, 0.75, 1, 1.25, 1.5, 2].includes(state?.speed)) safeState.speed = state.speed;
      if (typeof state?.src === "string" && state.src.length <= MAX_SRC_LEN) {
        // Only allow http/https URLs or plain filenames (no script injection)
        if (state.src === "" || isValidUrl(state.src) || /^[^<>"']+$/.test(state.src)) {
          safeState.src = state.src;
        }
      }
      if (Object.keys(safeState).length === 0) return;
      room.videoState = { ...room.videoState, ...safeState };
      io.to(currentRoom).emit("video-state", safeState);
    });

    socket.on("chat-message", ({ message, username }) => {
      if (!currentRoom || !guard()) return;
      const safeMsg = sanitizeString(message, MAX_MESSAGE_LEN);
      const safeUser = sanitizeString(username, MAX_USERNAME_LEN) || currentUser || "Guest";
      if (!safeMsg) return;
      io.to(currentRoom).emit("chat-message", { message: safeMsg, username: safeUser, time: Date.now() });
    });

    socket.on("kick-user", ({ participantId }) => {
      if (!currentRoom || !rooms[currentRoom]) return;
      // Only owner can kick
      if (rooms[currentRoom].ownerSocketId !== socket.id) return;
      if (typeof participantId !== "string") return;
      rooms[currentRoom].users = rooms[currentRoom].users.filter((u) => u.id !== participantId);
      io.to(participantId).emit("kicked");
      io.to(currentRoom).emit("users-update", rooms[currentRoom].users);
      const pSocket = io.sockets.sockets.get(participantId);
      if (pSocket) pSocket.leave(currentRoom);
    });

    socket.on("end-room", () => {
      if (!currentRoom || !rooms[currentRoom]) return;
      // Only owner can end room
      if (rooms[currentRoom].ownerSocketId !== socket.id) return;
      io.to(currentRoom).emit("room-ended");
      delete rooms[currentRoom];
    });

    socket.on("ping", (cb) => {
      if (typeof cb === "function") cb();
    });

    socket.on("broadcast-ping", ({ ping }) => {
      if (!currentRoom || typeof ping !== "number" || !isFinite(ping)) return;
      socket.to(currentRoom).emit("user-ping", { id: socket.id, ping: Math.max(0, Math.round(ping)) });
    });

    socket.on("signal", ({ to, signal }) => {
      if (typeof to !== "string" || !signal) return;
      io.to(to).emit("signal", { from: socket.id, signal });
    });

    socket.on("call-join", ({ roomId: rid }) => {
      const room = sanitizeString(rid, 64) || currentRoom;
      if (!room) return;
      socket.to(room).emit("call-user", { from: socket.id });
    });

    socket.on("call-leave", ({ roomId: rid }) => {
      const room = sanitizeString(rid, 64) || currentRoom;
      if (!room) return;
      socket.to(room).emit("call-leave", { id: socket.id });
    });

    socket.on("leave-room", () => {
      if (!currentRoom || !rooms[currentRoom]) return;
      rooms[currentRoom].users = rooms[currentRoom].users.filter((u) => u.id !== socket.id);
      io.to(currentRoom).emit("users-update", rooms[currentRoom].users);
      socket.leave(currentRoom);
      if (rooms[currentRoom].users.length === 0) delete rooms[currentRoom];
      currentRoom = null;
    });

    socket.on("disconnect", () => {
      if (!currentRoom || !rooms[currentRoom]) return;
      rooms[currentRoom].users = rooms[currentRoom].users.filter((u) => u.id !== socket.id);
      io.to(currentRoom).emit("users-update", rooms[currentRoom].users);
      // If owner disconnects, end the room
      if (rooms[currentRoom].ownerSocketId === socket.id) {
        io.to(currentRoom).emit("room-ended");
        delete rooms[currentRoom];
      } else if (rooms[currentRoom].users.length === 0) {
        delete rooms[currentRoom];
      }
    });
  });

  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => console.log(`> Ready on http://localhost:${PORT}`));
});
