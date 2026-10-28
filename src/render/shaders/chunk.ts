/**
 * Viewport shader for chunk meshes. Unpacks the 8-byte vertex (docs/rendering.md), takes the
 * colour from the palette texture and lights it with sky/ground ambient, one directional light
 * and per-vertex AO. Lighting runs in linear space; palette colours are sRGB.
 */

export const CHUNK_VERTEX = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in uvec2 aVertex;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uChunkOrigin;
uniform sampler2D uPalette;
/** Ghost faces are pushed out along their normal so they sit just over the real surface. */
uniform float uInflate;

out vec3 vAlbedo;
out vec3 vNormal;
out vec3 vLocal;
out float vAO;
out vec2 vQuadUV;
flat out uint vFace;
flat out uint vFlip;

void main() {
  uint w = aVertex.x;
  vec3 pos = vec3(float(w & 63u), float((w >> 6u) & 63u), float((w >> 12u) & 63u));
  uint face = (w >> 18u) & 7u;
  uint axis = face >> 1u;
  float sign = (face & 1u) == 0u ? 1.0 : -1.0;
  vec3 n = vec3(0.0);
  n[axis] = sign;

  vLocal = uChunkOrigin + pos + n * uInflate;
  vNormal = normalize(mat3(uModel) * n);
  vAO = float((w >> 21u) & 3u);
  vQuadUV = vec2(float((w >> 23u) & 1u), float((w >> 24u) & 1u));
  vFace = face;
  vFlip = (w >> 25u) & 1u;

  uint id = aVertex.y & 65535u;
  vec3 srgb = texelFetch(uPalette, ivec2(int(id & 255u), int(id >> 8u)), 0).rgb;
  vAlbedo = pow(srgb, vec3(2.2));
  gl_Position = uViewProj * uModel * vec4(vLocal, 1.0);
}
`;

export const CHUNK_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

in vec3 vAlbedo;
in vec3 vNormal;
in vec3 vLocal;
in float vAO;
in vec2 vQuadUV;
flat in uint vFace;
flat in uint vFlip;

/** 0: lit, 1: flat (palette colour as is), 2: clay (one light colour, to judge form). */
uniform int uShading;
uniform float uLightStrength;
/** 1 for objects pushed back while another one is edited. */
uniform float uDim;
uniform bool uUseAO;
uniform bool uEdges;
uniform bool uWireframe;
uniform vec3 uLightDir;
/** 0: normal; ghost previews: 1 add, 2 erase, 3 paint, 4 select. */
uniform int uGhost;
/** Viewport colours, linear: the background (dimmed objects fade to it), edges, selection. */
uniform vec3 uBackdrop;
uniform vec3 uEdgeColor;
uniform vec3 uSelectionColor;

out vec4 outColor;

const vec3 SKY = vec3(0.62, 0.66, 0.72);
const vec3 GROUND = vec3(0.30, 0.27, 0.25);
const vec3 SUN = vec3(0.85, 0.80, 0.72);
/** Clay: a warm light grey, in linear space. */
const vec3 CLAY = vec3(0.55, 0.53, 0.5);

/** 1 on a line of about one pixel around value 0 of 'd', fading out over a pixel. */
float line(float d, float fw) {
  return 1.0 - smoothstep(0.5 * fw, 1.5 * fw, abs(d));
}

/** A thinner line for the dense mesh wireframe. */
float hairline(float d, float fw) {
  return 1.0 - smoothstep(0.0, fw, abs(d));
}

void main() {
  float ao = uUseAO ? mix(0.42, 1.0, pow(vAO / 3.0, 1.2)) : 1.0;
  vec3 color;
  if (uShading == 1) {
    color = vAlbedo;
  } else {
    vec3 albedo = uShading == 2 ? CLAY : vAlbedo;
    vec3 n = normalize(vNormal);
    vec3 ambient = mix(GROUND, SKY, n.y * 0.5 + 0.5);
    float sun = max(dot(n, uLightDir), 0.0) * uLightStrength;
    color = albedo * (ambient * ao + SUN * sun * mix(1.0, ao, 0.6));
  }

  if (uEdges) {
    // Voxel grid on the face: distance to the nearest integer along both face axes.
    uint axis = vFace >> 1u;
    vec2 t = axis == 0u ? vLocal.yz : axis == 1u ? vLocal.zx : vLocal.xy;
    vec2 d = abs(t - round(t));
    vec2 fw = max(fwidth(t), vec2(1e-4));
    float e = max(line(d.x, fw.x), line(d.y, fw.y));
    color = mix(color, uEdgeColor, 0.35 * e);
  }

  if (uWireframe) {
    // Edges of the merged quads and of the diagonal that splits them.
    vec2 uv = vQuadUV;
    vec2 fw = max(fwidth(uv), vec2(1e-4));
    float border = max(max(hairline(uv.x, fw.x), hairline(1.0 - uv.x, fw.x)),
                       max(hairline(uv.y, fw.y), hairline(1.0 - uv.y, fw.y)));
    float diag = vFlip == 0u ? uv.x - uv.y : uv.x + uv.y - 1.0;
    float diagLine = hairline(diag, max(fwidth(diag), 1e-4));
    float wire = max(border, diagLine * 0.5);
    color = mix(color * 0.45, vec3(0.85, 0.9, 1.0), wire * 0.85);
  }

  if (uDim > 0.0) {
    // Other objects: grey and faded, still readable as context.
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(color, mix(vec3(luma), uBackdrop, 0.55), 0.8 * uDim);
  }

  float alpha = 1.0;
  if (uGhost == 1) {
    // Future voxels: their own colour, lifted and see-through.
    color = mix(color, vec3(1.0), 0.15);
    alpha = 0.6;
  } else if (uGhost == 2) {
    color = vec3(1.0, 0.12, 0.08) * (0.6 + 0.4 * ao);
    alpha = 0.68;
  } else if (uGhost == 3) {
    alpha = 0.92;
  } else if (uGhost == 4) {
    // Selection: a blue film with the voxel grid drawn on it, so its extent reads at a glance.
    uint axis = vFace >> 1u;
    vec2 t = axis == 0u ? vLocal.yz : axis == 1u ? vLocal.zx : vLocal.xy;
    vec2 d = abs(t - round(t));
    vec2 fw = max(fwidth(t), vec2(1e-4));
    float grid = max(line(d.x, fw.x), line(d.y, fw.y));
    color = mix(uSelectionColor * (0.6 + 0.4 * ao), mix(uSelectionColor, vec3(1.0), 0.6), grid * 0.8);
    alpha = 0.38 + grid * 0.4;
  } else if (uGhost >= 5) {
    // Onion skin: the frame before in a cool tint, the frame after in a warm one, faint.
    vec3 tint = uGhost == 5 ? vec3(0.25, 0.55, 1.0) : vec3(1.0, 0.5, 0.2);
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), tint, 0.6) * (0.7 + 0.3 * ao);
    alpha = 0.3;
  }
  outColor = vec4(pow(color, vec3(1.0 / 2.2)), alpha);
}
`;
