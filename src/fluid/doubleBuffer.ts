import type { Grid } from "./grid";

const STORAGE_USAGE =
  GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;

/** A pair of same-format textures written alternately: a compute pass may not
 * read and write one texture, so each step reads `read` and writes `write`,
 * then the two are swapped. */
export class DoubleBuffer {
  readonly views: readonly [GPUTextureView, GPUTextureView];
  private readonly textures: readonly [GPUTexture, GPUTexture];
  private liveFace: 0 | 1 = 0;

  constructor(device: GPUDevice, grid: Grid, format: GPUTextureFormat) {
    const create = (): GPUTexture =>
      device.createTexture({
        size: [grid.width, grid.height],
        format,
        usage: STORAGE_USAGE,
      });
    const first = create();
    const second = create();
    this.textures = [first, second];
    this.views = [first.createView(), second.createView()];
  }

  get readFace(): 0 | 1 {
    return this.liveFace;
  }

  swap(): void {
    this.liveFace = this.liveFace === 0 ? 1 : 0;
  }

  destroy(): void {
    for (const texture of this.textures) texture.destroy();
  }
}
