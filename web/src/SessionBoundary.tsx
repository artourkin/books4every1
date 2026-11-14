import { useEffect, useState, type ReactNode } from "react";
import { api, requestProfile, type Session } from "./api";
const channelName = "folio-account-change";
const eventName = "folio:account-change";
const tabId = String(Date.now()) + Math.random();
// No private account information is sent through browser storage or channels.
export function notifySessionChange(reloadCurrent = true) {
  try {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage({ source: tabId });
    channel.close();
  } catch {
    /* Storage events support browsers without BroadcastChannel. */
  }
  try {
    localStorage.setItem(channelName, String(Date.now()) + Math.random());
  } catch {
    /* BroadcastChannel is sufficient when storage is unavailable. */
  }
  if (reloadCurrent) window.dispatchEvent(new Event(eventName));
}
export function SessionBoundary({ children }: { children: ReactNode }) {
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    const lock = () => setChanged(true);
    const storage = (event: StorageEvent) => {
      if (event.key === channelName) lock();
    };
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = (event) => {
        if (event.data?.source !== tabId) lock();
      };
    } catch {
      /* Storage events remain available. */
    }
    const check = async () => {
      const expected = requestProfile();
      if (!expected || document.visibilityState === "hidden") return;
      try {
        const session = await api<Session>("/session");
        if (
          (session.authenticated ? session.profileId : undefined) !== expected
        )
          lock();
      } catch {
        /* Normal request errors are shown by the active screen. */
      }
    };
    window.addEventListener(eventName, lock);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      channel?.close();
      window.removeEventListener(eventName, lock);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  useEffect(() => {
    if (changed) window.location.reload();
  }, [changed]);
  // Unmount private views and cancel their listeners before navigating. Old async
  // callbacks retain their previous profile header and cannot write into the new account.
  return changed ? (
    <div className="boot">
      <p>Refreshing your account…</p>
    </div>
  ) : (
    children
  );
}
