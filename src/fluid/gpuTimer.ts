const SLOTS = 2;
const SLOT_BYTES = 8;
const NANOSECONDS_PER_MILLISECOND = 1e6;

/** Timestamps bracketing one frame: the compute pass writes the first slot, the
 * display pass the second. */
export interface FrameTiming {
  computeWrites: GPUComputePassTimestampWrites;
  renderWrites: GPURenderPassTimestampWrites;
  resolve: (encoder: GPUCommandEncoder) => void;
}

export interface GpuTimer {
  /** Null while an earlier reading is still in flight, so a frame never queues
   * behind it. Every non-null result owes one `read` after its submit. */
  begin: () => FrameTiming | null;
  read: () => Promise<number>;
  destroy: () => void;
}

export const createGpuTimer = (device: GPUDevice): GpuTimer | null => {
  if (!device.features.has("timestamp-query")) return null;

  const bytes = SLOTS * SLOT_BYTES;
  const querySet = device.createQuerySet({ type: "timestamp", count: SLOTS });
  const resolveBuffer = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  let busy = false;

  const timing: FrameTiming = {
    computeWrites: { querySet, beginningOfPassWriteIndex: 0 },
    renderWrites: { querySet, endOfPassWriteIndex: 1 },
    resolve: (encoder) => {
      encoder.resolveQuerySet(querySet, 0, SLOTS, resolveBuffer, 0);
      encoder.copyBufferToBuffer(resolveBuffer, 0, readback, 0, bytes);
    },
  };

  return {
    begin: () => {
      if (busy) return null;
      busy = true;
      return timing;
    },
    read: async () => {
      try {
        await readback.mapAsync(GPUMapMode.READ);
        let first: bigint | undefined;
        let last: bigint | undefined;
        try {
          [first, last] = new BigInt64Array(readback.getMappedRange());
        } finally {
          readback.unmap();
        }
        if (first === undefined || last === undefined || last < first) {
          throw new Error("The GPU returned timestamps out of order.");
        }
        return Number(last - first) / NANOSECONDS_PER_MILLISECOND;
      } finally {
        busy = false;
      }
    },
    destroy: () => {
      querySet.destroy();
      resolveBuffer.destroy();
      readback.destroy();
    },
  };
};
