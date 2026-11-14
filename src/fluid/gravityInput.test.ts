import { afterEach, describe, expect, it, vi } from "vitest";

import { GravityTracker } from "./gravity";
import { watchGravity } from "./gravityInput";

const G = 9.8;

const motion = (
  accelerationIncludingGravity: {
    x: number | null;
    y: number | null;
    z?: number | null;
  } | null,
): Event =>
  Object.assign(new Event("devicemotion"), { accelerationIncludingGravity });

const defineOnce = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, configurable: true });
};

const restore: (() => void)[] = [];

const stub = (target: object, key: string, value: unknown): void => {
  const original = Object.getOwnPropertyDescriptor(target, key);
  defineOnce(target, key, value);
  restore.push(() => {
    if (original === undefined) Reflect.deleteProperty(target, key);
    else Object.defineProperty(target, key, original);
  });
};

afterEach(() => {
  restore.splice(0).forEach((undo) => {
    undo();
  });
});

const watched = (): {
  tracker: GravityTracker;
  watch: ReturnType<typeof watchGravity>;
} => {
  const tracker = new GravityTracker();
  return { tracker, watch: watchGravity(window, tracker) };
};

describe("the devicemotion listener", () => {
  it("feeds a usable reading to the tracker", () => {
    const { tracker, watch } = watched();
    window.dispatchEvent(motion({ x: G, y: 0 }));
    expect(tracker.step(100)[0]).toBeCloseTo(1, 6);
    watch.dispose();
  });

  it("passes the reading's z on, so a tilted device lifts less", () => {
    const { tracker, watch } = watched();
    window.dispatchEvent(motion({ x: 0, y: 3, z: 4 }));
    const [x, y] = tracker.step(100);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(-0.6, 6);
    watch.dispose();
  });

  it("rotates the reading by the screen's angle", () => {
    stub(window.screen, "orientation", { angle: 90 });
    const { tracker, watch } = watched();
    window.dispatchEvent(motion({ x: G, y: 0 }));
    const [x, y] = tracker.step(100);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(-1, 6);
    watch.dispose();
  });

  it("reads the angle as 0 when the screen has no orientation, or a bad one", () => {
    for (const orientation of [
      undefined,
      null,
      { angle: "90" },
      { angle: Infinity },
    ]) {
      stub(window.screen, "orientation", orientation);
      const { tracker, watch } = watched();
      window.dispatchEvent(motion({ x: G, y: 0 }));
      expect(tracker.step(100)[0]).toBeCloseTo(1, 6);
      watch.dispose();
    }
  });

  it("keeps the default direction for a sensorless reading", () => {
    const { tracker, watch } = watched();
    window.dispatchEvent(motion({ x: null, y: null }));
    window.dispatchEvent(motion(null));
    expect(tracker.step(100)).toStrictEqual([0, -1]);
    watch.dispose();
  });

  it("stops listening once disposed", () => {
    const { tracker, watch } = watched();
    watch.dispose();
    window.dispatchEvent(motion({ x: G, y: 0 }));
    expect(tracker.step(100)).toStrictEqual([0, -1]);
  });
});

describe("requestPermission", () => {
  const withApi = (api: unknown): void => {
    stub(window, "DeviceMotionEvent", api);
  };

  it("does nothing where motion needs no grant", async () => {
    withApi(undefined);
    const { watch } = watched();
    await expect(watch.requestPermission()).resolves.toBeUndefined();
    watch.dispose();

    withApi(vi.fn());
    const second = watched();
    await expect(second.watch.requestPermission()).resolves.toBeUndefined();
    second.watch.dispose();
  });

  it("asks once, however many gestures follow", async () => {
    const request = vi.fn().mockResolvedValue("granted");
    withApi(Object.assign(vi.fn(), { requestPermission: request }));
    const { watch } = watched();
    await watch.requestPermission();
    await watch.requestPermission();
    expect(request).toHaveBeenCalledOnce();
    watch.dispose();
  });

  it("calls the request on the API itself, as Safari requires", async () => {
    const api = Object.assign(vi.fn(), {
      requestPermission(this: unknown) {
        return Promise.resolve(this === api ? "granted" : "wrong receiver");
      },
    });
    const spy = vi.spyOn(api, "requestPermission");
    withApi(api);
    const { watch } = watched();
    await watch.requestPermission();
    expect(spy).toHaveReturnedWith(expect.any(Promise));
    await expect(spy.mock.results[0]?.value).resolves.toBe("granted");
    watch.dispose();
  });

  it("falls back to the default direction when the request is refused", async () => {
    withApi(
      Object.assign(vi.fn(), {
        requestPermission: () => Promise.resolve("denied"),
      }),
    );
    const { tracker, watch } = watched();
    await expect(watch.requestPermission()).resolves.toBeUndefined();
    expect(tracker.step(1)).toStrictEqual([0, -1]);
    watch.dispose();
  });

  it("falls back to the default direction when the request rejects", async () => {
    withApi(
      Object.assign(vi.fn(), {
        requestPermission: () => Promise.reject(new Error("not a gesture")),
      }),
    );
    const { tracker, watch } = watched();
    await expect(watch.requestPermission()).resolves.toBeUndefined();
    expect(tracker.step(1)).toStrictEqual([0, -1]);
    watch.dispose();
  });
});
