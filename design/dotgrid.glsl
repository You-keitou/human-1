/** @resolution */
uniform vec2 u_resolution;

/**
 * @label Background
 * @color
 * @default #F6F7FB
 */
uniform vec3 u_bg;

/**
 * @label Dot Color
 * @color
 * @default #C3CAD8
 */
uniform vec3 u_dot;

/**
 * @label Spacing
 * @default 22
 * @range 8, 48
 */
uniform float u_spacing;

/**
 * @label Dot Radius
 * @default 1.15
 * @range 0.5, 3
 */
uniform float u_radius;

void main() {
  vec2 cell = mod(gl_FragCoord.xy, u_spacing);
  vec2 center = vec2(u_spacing * 0.5);
  float dist = distance(cell, center);
  float dot = 1.0 - smoothstep(u_radius, u_radius + 1.2, dist);
  vec3 color = mix(u_bg, u_dot, dot * 0.55);
  gl_FragColor = vec4(color, 1.0);
}
