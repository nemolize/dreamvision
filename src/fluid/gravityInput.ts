import type { GravityTracker } from "./gravity";

export interface GravityWatch {
  /** Call from a user gesture: iOS Safari refuses the request elsewhere. */
  requestPermission: () => Promise<void>;
  dispose: () => void;
}

/** Absent before iOS 16.4 and on desktop, so read as untrusted input. */
const screenAngle = (win: Window): number => {
  const orientation: unknown = Reflect.get(win.screen, "orientation");
  const angle: unknown =
    typeof orientation === "object" && orientation !== null
      ? Reflect.get(orientation, "angle")
      : undefined;
  return typeof angle === "number" && Number.isFinite(angle) ? angle : 0;
};

/** Only iOS Safari defines a static `requestPermission`. */
const permissionRequest = (win: Window): (() => Promise<unknown>) | null => {
  const api: unknown = Reflect.get(win, "DeviceMotionEvent");
  if (typeof api !== "function") return null;
  const request: unknown = Reflect.get(api, "requestPermission");
  if (typeof request !== "function") return null;
  return async () => {
    const outcome: unknown = await Reflect.apply(request, api, []);
    return outcome;
  };
};

export const watchGravity = (
  win: Window,
  tracker: GravityTracker,
): GravityWatch => {
  const onMotion = (event: DeviceMotionEvent): void => {
    tracker.update(event.accelerationIncludingGravity, screenAngle(win));
  };
  win.addEventListener("devicemotion", onMotion);

  let asked = false;
  return {
    requestPermission: async () => {
      if (asked) return;
      asked = true;
      const request = permissionRequest(win);
      if (request === null) return;
      // A refusal leaves no events, which keeps the default direction.
      try {
        await request();
      } catch {
        return;
      }
    },
    dispose: () => {
      win.removeEventListener("devicemotion", onMotion);
    },
  };
};
