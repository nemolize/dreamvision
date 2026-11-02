/** Simulation grid cells along the longer viewport axis. */
export const SIM_RESOLUTION = 320;

/** Dye grid cells along the longer viewport axis; higher than the velocity
 * grid because colour detail is what the eye actually resolves. */
export const DYE_RESOLUTION = 1024;

/** Jacobi sweeps per frame for the pressure projection. */
export const PRESSURE_ITERATIONS = 32;

/** One 60Hz frame: the length the pointer's dye is calibrated at. A frame of
 * length `dt` adds `dt / REFERENCE_STEP` times as much, so refresh rate cancels. */
export const REFERENCE_STEP = 1 / 60;

/** A 30 fps floor: below it the simulation slows rather than take one step so
 * large that the dye leaves the screen in a single frame. */
export const MAX_FRAME_SECONDS = 1 / 30;

/** Applied as `1 / (1 + rate * dt)` per frame, so not survival ratios: 0.2 leaves
 * ~82% of the velocity after a second, 0.6 leaves ~55% of the dye. */
export const VELOCITY_DISSIPATION = 0.2;
export const DYE_DISSIPATION = 0.6;

/** Divides squared distance in `exp(-d² / r)`, so it is a squared length, not
 * a radius — 0.0035 puts the splat's e-folding edge ~6% across the screen. */
export const SPLAT_RADIUS = 0.0035;

/** Scales normalised pointer motion into the velocity written to the field. */
export const SPLAT_FORCE = 30;

/** Bounds the uniform buffer the splat pass indexes into, so anything beyond
 * it is dropped rather than read out of range. */
export const MAX_SPLATS_PER_FRAME = 32;

/** Splats injected once at startup, so the canvas opens mid-motion instead of
 * black. Range is inclusive at both ends. */
export const SEED_SPLATS_MIN = 8;
export const SEED_SPLATS_MAX = 20;

/** Normalised travel given to a seeded splat. Scaled like a pointer
 * displacement, so it is comparable to `SPLAT_FORCE` times a fraction of the
 * screen. */
export const SEED_SPLAT_FORCE = 12;

/** Brightens a seeded splat. A dragged splat is re-applied on every frame of
 * the drag and accumulates; these land once, so at the pointer's per-frame
 * intensity they read as almost black. */
export const SEED_DYE_GAIN = 8;

/** Workgroup edge length; 8x8 = 64 invocations, a safe fit everywhere. The
 * renderer substitutes it into the shader source, so this is the only copy. */
export const WORKGROUP_SIZE = 8;
