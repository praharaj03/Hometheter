import { create } from "zustand";

export interface User {
  id: string;
  username: string;
  uid?: string;
  isOwner?: boolean;
  isBlocked?: boolean;
  isConnected?: boolean;
  isReady?: boolean;
}

export interface ChatMessage {
  id: string;
  senderUid: string;
  username: string;
  message: string;
  time: number;
}

export interface QueueItem { id: string; src: string; title: string }
export interface Subtitle { text: string; label: string }

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
  myUid: string;
  queue: QueueItem[];
  subtitle: Subtitle | null;
  setUsername: (name: string) => void;
  setRoomId: (id: string) => void;
  setUsers: (users: User[]) => void;
  addMessage: (msg: ChatMessage) => void;
  setVideoState: (state: Partial<VideoState>) => void;
  setIsBlocked: (blocked: boolean) => void;
  setMyUid: (uid: string) => void;
  setQueue: (queue: QueueItem[]) => void;
  setSubtitle: (subtitle: Subtitle | null) => void;
}

export const useRoomStore = create<RoomStore>((set) => ({
  username: "",
  roomId: "",
  users: [],
  messages: [],
  videoState: { src: "", playing: false, currentTime: 0, speed: 1 },
  isBlocked: false,
  myUid: "",
  queue: [],
  subtitle: null,
  setUsername: (username) => set({ username }),
  setRoomId: (roomId) => set((state) => roomId === state.roomId ? { roomId } : {
    roomId,
    users: [],
    messages: [],
    isBlocked: false,
    myUid: "",
    queue: [],
    subtitle: null,
    videoState: { src: "", playing: false, currentTime: 0, speed: 1 },
  }),
  setUsers: (users) => set({ users: users.filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i) }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg].slice(-500) })),
  setVideoState: (state) =>
    set((s) => ({ videoState: { ...s.videoState, ...state } })),
  setIsBlocked: (isBlocked) => set({ isBlocked }),
  setMyUid: (myUid) => set({ myUid }),
  setQueue: (queue) => set({ queue }),
  setSubtitle: (subtitle) => set({ subtitle }),
}));
