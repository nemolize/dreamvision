// Stable-fluids solver (Stam 1999) over storage textures.
//
// Two grids: a coarse velocity/pressure grid and a finer dye grid. Each pass
// reads one texture and writes another, so every entry point takes its inputs
// as read-only and its output as write-only — no pass ever aliases a resource.
//
// `Uniforms` is padded to 16-byte alignment by hand and holds no vec3: vec3
// padding in a host-shared struct is driver-fragile, so every field is either
// a scalar or a vec4.
//
// The three projection passes have a hand-written CPU twin in
// `projection.test.ts`, which is where their arithmetic is actually checked —
// editing one of them means editing it there too.

struct Uniforms {
  simSize: vec2f,      // velocity grid, in cells
  dt: f32,
  aspect: f32,         // width / height, keeps splats circular
  // The projection's metric, derived host-side in `projection.ts`. The two are
  // reciprocals — stored velocity to cells per second and back — so they cancel
  // across the solve and the Jacobi sweep needs no weights of its own.
  toCells: vec2f,
  toStored: vec2f,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

/// Read one texel, clamping to the edge so out-of-range reads mirror the
/// wall's value rather than wrapping to the far side of the grid.
fn loadAt(tex: texture_2d<f32>, size: vec2f, cell: vec2i) -> vec4f {
  let bounded = clamp(cell, vec2i(0, 0), vec2i(size) - vec2i(1, 1));
  return textureLoad(tex, bounded, 0);
}

/// Bilinearly sample `tex` at a cell-space coordinate on a grid of `size`.
/// Done by hand because the 32-bit float storage formats are not filterable.
fn sampleAt(tex: texture_2d<f32>, size: vec2f, cell: vec2f) -> vec4f {
  let base = floor(cell);
  let frac = cell - base;
  let corner = vec2i(base);

  let c00 = loadAt(tex, size, corner);
  let c10 = loadAt(tex, size, corner + vec2i(1, 0));
  let c01 = loadAt(tex, size, corner + vec2i(0, 1));
  let c11 = loadAt(tex, size, corner + vec2i(1, 1));

  return mix(mix(c00, c10, frac.x), mix(c01, c11, frac.x), frac.y);
}

/// Free-slip walls: no flow crosses the edge, so the component normal to it is
/// dropped while the tangential one slides along untouched. Negating the normal
/// component instead would keep its magnitude and merely reverse the leak.
fn applyVelocityBoundary(velocity: vec2f, id: vec2u, size: vec2u) -> vec2f {
  var bounded = velocity;
  if (id.x == 0u || id.x == size.x - 1u) { bounded.x = 0.0; }
  if (id.y == 0u || id.y == size.y - 1u) { bounded.y = 0.0; }
  return bounded;
}

// ---------------------------------------------------------------- advection

struct AdvectParams {
  gridSize: vec2f,
  dissipation: f32,
  _pad: f32,
}

@group(1) @binding(0) var advectSource: texture_2d<f32>;
@group(1) @binding(1) var advectVelocity: texture_2d<f32>;
@group(1) @binding(2) var advectOutput: texture_storage_2d<rgba32float, write>;
@group(1) @binding(3) var<uniform> advectParams: AdvectParams;

/// Semi-Lagrangian advection: trace each cell back along the velocity field
/// and read what was there a timestep ago.
@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn advect(@builtin(global_invocation_id) gid: vec3u) {
  let size = vec2u(advectParams.gridSize);
  if (gid.x >= size.x || gid.y >= size.y) { return; }

  let cell = vec2f(gid.xy);
  // The velocity grid is coarser than the dye grid, so sample it in its own
  // cell space rather than assuming the two grids share dimensions.
  let velocityCell = (cell + 0.5) / advectParams.gridSize * u.simSize - 0.5;
  let velocity = sampleAt(advectVelocity, u.simSize, velocityCell).xy;

  // Velocity is in normalised units per second; convert to this grid's cells.
  let source = cell - velocity * u.dt * advectParams.gridSize;
  let advected = sampleAt(advectSource, advectParams.gridSize, source);

  let decay = 1.0 / (1.0 + advectParams.dissipation * u.dt);
  textureStore(advectOutput, gid.xy, advected * decay);
}

// ---------------------------------------------------------------- divergence

@group(1) @binding(0) var divergenceVelocity: texture_2d<f32>;
@group(1) @binding(1) var divergenceOutput: texture_storage_2d<r32float, write>;

@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn divergence(@builtin(global_invocation_id) gid: vec3u) {
  let size = vec2u(u.simSize);
  if (gid.x >= size.x || gid.y >= size.y) { return; }

  let cell = vec2f(gid.xy);
  var left = sampleAt(divergenceVelocity, u.simSize, cell - vec2f(1.0, 0.0)).x;
  var right = sampleAt(divergenceVelocity, u.simSize, cell + vec2f(1.0, 0.0)).x;
  var down = sampleAt(divergenceVelocity, u.simSize, cell - vec2f(0.0, 1.0)).y;
  var up = sampleAt(divergenceVelocity, u.simSize, cell + vec2f(0.0, 1.0)).y;

  // At a wall the outside sample is a clamped copy of the centre cell, which
  // would read as a non-zero normal flow; mirror it instead.
  let centre = sampleAt(divergenceVelocity, u.simSize, cell).xy;
  if (gid.x == 0u) { left = -centre.x; }
  if (gid.x == size.x - 1u) { right = -centre.x; }
  if (gid.y == 0u) { down = -centre.y; }
  if (gid.y == size.y - 1u) { up = -centre.y; }

  let divergenceValue =
    0.5 * u.toCells.x * (right - left) + 0.5 * u.toCells.y * (up - down);
  textureStore(divergenceOutput, gid.xy, vec4f(divergenceValue, 0.0, 0.0, 1.0));
}

// ------------------------------------------------------------------ pressure

@group(1) @binding(0) var pressureInput: texture_2d<f32>;
@group(1) @binding(1) var pressureDivergence: texture_2d<f32>;
@group(1) @binding(2) var pressureOutput: texture_storage_2d<r32float, write>;

/// One Jacobi sweep of the Poisson equation for pressure.
@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn pressure(@builtin(global_invocation_id) gid: vec3u) {
  let size = vec2u(u.simSize);
  if (gid.x >= size.x || gid.y >= size.y) { return; }

  let cell = vec2f(gid.xy);
  let left = sampleAt(pressureInput, u.simSize, cell - vec2f(1.0, 0.0)).x;
  let right = sampleAt(pressureInput, u.simSize, cell + vec2f(1.0, 0.0)).x;
  let down = sampleAt(pressureInput, u.simSize, cell - vec2f(0.0, 1.0)).x;
  let up = sampleAt(pressureInput, u.simSize, cell + vec2f(0.0, 1.0)).x;
  let divergenceValue = sampleAt(pressureDivergence, u.simSize, cell).x;

  let next = (left + right + down + up - divergenceValue) * 0.25;
  textureStore(pressureOutput, gid.xy, vec4f(next, 0.0, 0.0, 1.0));
}

// ------------------------------------------------------------ gradient subtract

@group(1) @binding(0) var gradientPressure: texture_2d<f32>;
@group(1) @binding(1) var gradientVelocity: texture_2d<f32>;
@group(1) @binding(2) var gradientOutput: texture_storage_2d<rgba32float, write>;

/// Subtract the pressure gradient, leaving a divergence-free velocity field.
@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn gradientSubtract(@builtin(global_invocation_id) gid: vec3u) {
  let size = vec2u(u.simSize);
  if (gid.x >= size.x || gid.y >= size.y) { return; }

  let cell = vec2f(gid.xy);
  let left = sampleAt(gradientPressure, u.simSize, cell - vec2f(1.0, 0.0)).x;
  let right = sampleAt(gradientPressure, u.simSize, cell + vec2f(1.0, 0.0)).x;
  let down = sampleAt(gradientPressure, u.simSize, cell - vec2f(0.0, 1.0)).x;
  let up = sampleAt(gradientPressure, u.simSize, cell + vec2f(0.0, 1.0)).x;

  let velocity = sampleAt(gradientVelocity, u.simSize, cell).xy;
  let gradient = 0.5 * u.toStored * vec2f(right - left, up - down);
  let projected = velocity - gradient;
  let bounded = applyVelocityBoundary(projected, gid.xy, size);

  textureStore(gradientOutput, gid.xy, vec4f(bounded, 0.0, 1.0));
}

// ------------------------------------------------------------------ resample

struct ResampleParams {
  sourceSize: vec2f,
  targetSize: vec2f,
}

@group(1) @binding(0) var resampleSource: texture_2d<f32>;
@group(1) @binding(1) var resampleOutput: texture_storage_2d<rgba32float, write>;
@group(1) @binding(2) var<uniform> resampleParams: ResampleParams;

/// Carry a field onto a grid of a different size. Both grids cover the same
/// region, so the target cell's centre maps onto the source's cell space and
/// `sampleAt` gathers what was there.
@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn resample(@builtin(global_invocation_id) gid: vec3u) {
  let size = vec2u(resampleParams.targetSize);
  if (gid.x >= size.x || gid.y >= size.y) { return; }

  let cell = (vec2f(gid.xy) + 0.5) / resampleParams.targetSize
    * resampleParams.sourceSize - 0.5;
  let carried = sampleAt(resampleSource, resampleParams.sourceSize, cell);
  textureStore(resampleOutput, gid.xy, carried);
}

// --------------------------------------------------------------------- splat

struct SplatParams {
  gridSize: vec2f,
  isVelocity: f32,   // 1 writes a force into .xy, 0 adds colour into .rgb
  _pad: f32,
}

/// One splat's own parameters. Separate from `Uniforms` because a frame injects
/// any number of splats — each dispatch selects its own slot by dynamic offset,
/// so they cannot be folded into the per-frame block.
struct SplatUniforms {
  point: vec2f,        // normalised 0..1, origin top-left
  delta: vec2f,        // a displacement rather than a rate
  color: vec4f,
  radius: f32,         // divides squared distance, so a squared length
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(1) @binding(0) var splatSource: texture_2d<f32>;
@group(1) @binding(1) var splatOutput: texture_storage_2d<rgba32float, write>;
@group(1) @binding(2) var<uniform> splatParams: SplatParams;

// Its own group, so the passes that never read a splat are not made to bind one.
@group(2) @binding(0) var<uniform> s: SplatUniforms;

/// Add a gaussian blob of force or colour at the splat's point.
@compute @workgroup_size(WORKGROUP_SIZE, WORKGROUP_SIZE)
fn splat(@builtin(global_invocation_id) gid: vec3u) {
  let size = vec2u(splatParams.gridSize);
  if (gid.x >= size.x || gid.y >= size.y) { return; }

  let existing = sampleAt(splatSource, splatParams.gridSize, vec2f(gid.xy));

  // Distance in normalised space, x stretched by the aspect ratio so the blob
  // stays circular on screen rather than following the grid's proportions.
  var offset = (vec2f(gid.xy) + 0.5) / splatParams.gridSize - s.point;
  offset.x *= u.aspect;
  let falloff = exp(-dot(offset, offset) / s.radius);

  var added = vec4f(0.0);
  if (splatParams.isVelocity > 0.5) {
    added = vec4f(s.delta * falloff, 0.0, 0.0);
  } else {
    added = vec4f(s.color.rgb * falloff, 0.0);
  }

  textureStore(splatOutput, gid.xy, existing + added);
}
