// Draws the dye field over the whole canvas.

@group(0) @binding(0) var dye: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

/// A single oversized triangle covering the viewport — cheaper than a quad and
/// free of the diagonal seam two triangles produce under interpolation.
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var out: VertexOutput;
  out.position = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
  // Flip Y: clip space runs bottom-up, the dye grid is stored top-down.
  out.uv = vec2f(corner.x, 1.0 - corner.y);
  return out;
}

fn loadDye(cell: vec2i, maxCell: vec2i) -> vec3f {
  return textureLoad(dye, clamp(cell, vec2i(0, 0), maxCell), 0).rgb;
}

/// Bilinear fetch, by hand: the dye texture is `rgba32float`, which storage
/// access requires and which is not filterable by a sampler.
fn sampleDye(uv: vec2f) -> vec3f {
  let size = vec2f(textureDimensions(dye));
  let cell = uv * size - 0.5;
  let base = floor(cell);
  let frac = cell - base;
  let corner = vec2i(base);
  let maxCell = vec2i(size) - vec2i(1, 1);

  let c00 = loadDye(corner, maxCell);
  let c10 = loadDye(corner + vec2i(1, 0), maxCell);
  let c01 = loadDye(corner + vec2i(0, 1), maxCell);
  let c11 = loadDye(corner + vec2i(1, 1), maxCell);

  return mix(mix(c00, c10, frac.x), mix(c01, c11, frac.x), frac.y);
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4f {
  let colour = sampleDye(in.uv);
  // The dye field is unbounded, so map it through a saturating curve rather
  // than clipping — bright cores keep their hue instead of going white. The
  // exponent lifts the mid-tones the plain curve leaves muddy.
  let tonemapped = pow(colour / (1.0 + colour), vec3f(0.75));
  return vec4f(tonemapped, 1.0);
}
