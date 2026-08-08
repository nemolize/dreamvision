/** Simulation grid cells along the longer viewport axis. */
export const SIM_RESOLUTION = 320;

/** Dye grid cells along the longer viewport axis; higher than the velocity
 * grid because colour detail is what the eye actually resolves. */
export const DYE_RESOLUTION = 1024;

/** Jacobi sweeps per frame for the pressure projection. */
export const PRESSURE_ITERATIONS = 32;

/** Fixed timestep. Decoupling from the frame interval keeps the fluid's
 * behaviour identical on a 60Hz and a 120Hz display. */
export const TIME_STEP = 1 / 60;

/** Per-second survival ratio: velocity keeps some momentum, dye fades faster
 * so the screen does not saturate. */
export const VELOCITY_DISSIPATION = 0.2;
export const DYE_DISSIPATION = 0.6;

/** Splat radius as a fraction of the grid's longer axis. */
export const SPLAT_RADIUS = 0.0035;

/** Scales normalised pointer motion into the velocity written to the field.
 * Advection travels `velocity * TIME_STEP` normalised units per step, so this
 * keeps a brisk drag near a few percent of the screen per step. */
export const SPLAT_FORCE = 30;

/** Workgroup edge length; 8x8 = 64 invocations, a safe fit everywhere. */
export const WORKGROUP_SIZE = 8;
