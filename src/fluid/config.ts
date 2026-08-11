/** Simulation grid cells along the longer viewport axis. */
export const SIM_RESOLUTION = 320;

/** Dye grid cells along the longer viewport axis; higher than the velocity
 * grid because colour detail is what the eye actually resolves. */
export const DYE_RESOLUTION = 1024;

/** Jacobi sweeps per frame for the pressure projection. */
export const PRESSURE_ITERATIONS = 32;

/** Fixed timestep the solver always advances by. The frame loop accumulates
 * real elapsed time and runs whole steps, so a 120Hz display runs the same
 * simulation as a 60Hz one rather than twice as fast. */
export const TIME_STEP = 1 / 60;

/** Ceiling on steps per frame. After a background tab or a long stall the
 * accumulated time can span seconds; without this the catch-up loop would
 * freeze the page trying to replay all of it. */
export const MAX_STEPS_PER_FRAME = 4;

/** Decay rates, applied as `1 / (1 + rate * dt)` per step — so these are not
 * survival ratios: 0.2 leaves ~82% of the velocity after a second, 0.6 leaves
 * ~55% of the dye. Dye fades faster so the screen does not saturate. */
export const VELOCITY_DISSIPATION = 0.2;
export const DYE_DISSIPATION = 0.6;

/** Divides squared distance in `exp(-d² / r)`, so it is a squared length, not
 * a radius — 0.0035 puts the splat's e-folding edge ~6% across the screen. */
export const SPLAT_RADIUS = 0.0035;

/** Scales normalised pointer motion into the velocity written to the field. */
export const SPLAT_FORCE = 30;

/** Ceiling on splats injected in one frame. The seed burst is the only thing
 * that approaches it; the cap bounds the uniform buffer the splat pass indexes
 * into, so anything beyond it is dropped rather than read out of range. */
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
