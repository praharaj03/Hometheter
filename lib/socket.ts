import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    const serverUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "";
    socket = io(serverUrl, { path: "/socket.io", autoConnect: true });
  }
  return socket;
};

export const subscribeToSocket = (onStoreChange: () => void): (() => void) => {
  const currentSocket = getSocket();
  currentSocket.on("connect", onStoreChange);
  if (currentSocket.connected) queueMicrotask(onStoreChange);
  return () => currentSocket.off("connect", onStoreChange);
};

export const getSocketSnapshot = (): Socket | null => socket;

export const getServerSocketSnapshot = (): null => null;

export const getSocketServerUrl = (): string =>
  process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin;

export const sanitizeInput = (str: unknown, maxLen = 500): string => {
  if (typeof str !== "string") return "";
  return str.trim().slice(0, maxLen).replace(/[<>]/g, "");
};
