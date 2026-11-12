import type { FrameReading } from "@/fluid/frameStats";

const MISSING = "–";

export const FrameReadout = ({ reading }: { reading: FrameReading | null }) => {
  const fps = reading?.fps == null ? MISSING : Math.round(reading.fps);
  const gpu =
    reading?.gpuMilliseconds == null
      ? MISSING
      : reading.gpuMilliseconds.toFixed(1);

  return <p className="frame-stats">{`${String(fps)} fps · ${gpu} ms`}</p>;
};
