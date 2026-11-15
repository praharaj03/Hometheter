import { useSyncExternalStore } from "react";

const NAME_KEY = "hometheater:display-name";
const NAME_EVENT = "hometheater:name-changed";

function getSavedName(): string {
  try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(NAME_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(NAME_EVENT, listener);
  };
}

export function useSavedName() {
  return useSyncExternalStore(subscribe, getSavedName, () => "");
}

export function saveName(name: string) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* Room sessions can still work without local storage. */ }
  window.dispatchEvent(new Event(NAME_EVENT));
}
