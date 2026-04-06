import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;
let kickHandler: (() => void) | null = null;
let endHandler: (() => void) | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io({ path: "/socket.io", autoConnect: true });
  }
  return socket;
};

export const sanitizeInput = (str: unknown, maxLen = 500): string => {
  if (typeof str !== "string") return "";
  return str.trim().slice(0, maxLen).replace(/[<>]/g, "");
};

// One-time join per socket connection — tracked on the socket instance
export const joinRoom = (roomId: string, payload: object): void => {
  const s = getSocket();
  const key = `joined_${roomId}`;
  if ((s as unknown as Record<string, unknown>)[key]) return;
  (s as unknown as Record<string, unknown>)[key] = true;
  s.emit("join-room", payload);
};

export const resetJoin = (roomId: string): void => {
  const s = getSocket();
  delete (s as unknown as Record<string, unknown>)[`joined_${roomId}`];
};

export const onKickedOrEnded = (onKicked: () => void, onEnded: () => void): void => {
  const s = getSocket();
  if (kickHandler) s.off("kicked", kickHandler);
  if (endHandler) s.off("room-ended", endHandler);
  kickHandler = onKicked;
  endHandler = onEnded;
  s.on("kicked", kickHandler);
  s.on("room-ended", endHandler);
};
