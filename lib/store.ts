import { create } from "zustand";

export interface User {
  id: string;
  username: string;
  uid?: string;
  isOwner?: boolean;
  isBlocked?: boolean;
  isConnected?: boolean;
}

export interface ChatMessage {
  username: string;
  message: string;
  time: number;
}

export interface VideoState {
  src: string;
  playing: boolean;
  currentTime: number;
  speed: number;
}

interface RoomStore {
  username: string;
  roomId: string;
  users: User[];
  messages: ChatMessage[];
  videoState: VideoState;
  isBlocked: boolean;
  setUsername: (name: string) => void;
  setRoomId: (id: string) => void;
  setUsers: (users: User[]) => void;
  addMessage: (msg: ChatMessage) => void;
  setVideoState: (state: Partial<VideoState>) => void;
  setIsBlocked: (blocked: boolean) => void;
}

export const useRoomStore = create<RoomStore>((set) => ({
  username: "",
  roomId: "",
  users: [],
  messages: [],
  videoState: { src: "", playing: false, currentTime: 0, speed: 1 },
  isBlocked: false,
  setUsername: (username) => set({ username }),
  setRoomId: (roomId) => set((state) => roomId === state.roomId ? { roomId } : {
    roomId,
    users: [],
    messages: [],
    isBlocked: false,
    videoState: { src: "", playing: false, currentTime: 0, speed: 1 },
  }),
  setUsers: (users) => set({ users: users.filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i) }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg].slice(-500) })),
  setVideoState: (state) =>
    set((s) => ({ videoState: { ...s.videoState, ...state } })),
  setIsBlocked: (isBlocked) => set({ isBlocked }),
}));
