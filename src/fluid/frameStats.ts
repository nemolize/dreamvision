import { STATS_WINDOW_MS } from "./config";
import type { FluidRenderer } from "./types";

export interface FrameReading {
  fps: number | null;
  /** Null when the window drew no frame or no timestamp arrived. */
  gpuMilliseconds: number | null;
}

/** Averages over fixed windows of the caller's clock, so a reading is as steady
 * as the window rather than as the frame it happens to land on. */
export class FrameStats {
  private windowStart = 0;
  private frames = 0;
  private gpuTotal = 0;
  private gpuSamples = 0;

  reset(now: number): void {
    this.windowStart = now;
    this.frames = 0;
    this.gpuTotal = 0;
    this.gpuSamples = 0;
  }

  frame(): void {
    this.frames += 1;
  }

  gpu(milliseconds: number): void {
    this.gpuTotal += milliseconds;
    this.gpuSamples += 1;
  }

  /** Null until the window has run its length; then its averages, and the next
   * window opens. */
  poll(now: number): FrameReading | null {
    const elapsed = now - this.windowStart;
    if (elapsed < STATS_WINDOW_MS) return null;

    const drew = this.frames > 0;
    const reading: FrameReading = {
      fps: drew ? (this.frames * 1000) / elapsed : null,
      gpuMilliseconds:
        drew && this.gpuSamples > 0 ? this.gpuTotal / this.gpuSamples : null,
    };
    this.reset(now);
    return reading;
  }
}

export class StatsMeter {
  private readonly stats = new FrameStats();
  private active = false;
  private restartPending = false;
  private readonly renderer: Pick<FluidRenderer, "measureGpu">;
  private readonly publish: (reading: FrameReading | null) => void;

  constructor(
    renderer: Pick<FluidRenderer, "measureGpu">,
    publish: (reading: FrameReading | null) => void,
  ) {
    this.renderer = renderer;
    this.publish = publish;
  }

  /** The next update opens a fresh window: a hidden tab gets no animation
   * frames, so the open one would otherwise span the whole gap. */
  restart(): void {
    this.restartPending = true;
  }

  /** Called once per animation frame, drawn or not, so a window in which nothing
   * drew still closes and reads as empty. */
  update(now: number, show: boolean, drew: boolean): void {
    if (show !== this.active) {
      this.active = show;
      this.renderer.measureGpu(
        show
          ? (milliseconds) => {
              this.stats.gpu(milliseconds);
            }
          : null,
      );
      if (!show) this.publish(null);
      this.restartPending = true;
    }
    if (this.restartPending) {
      this.restartPending = false;
      this.stats.reset(now);
      return;
    }
    if (!this.active) return;

    if (drew) this.stats.frame();
    const reading = this.stats.poll(now);
    if (reading !== null) this.publish(reading);
  }
}
