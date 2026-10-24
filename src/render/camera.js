// Perspective camera: world millimetres → screen pixels.
export class Camera {
  constructor({ width = 1080, height = 1920, focal = 1500, cx = 540, cy = 1250 } = {}) {
    Object.assign(this, { width, height, focal, cx, cy });
    this.near = 40;
  }

  // Look at `target` from `dist` mm away, elevated by `pitch` (rad) above the keyboard plane.
  set(target, dist, pitch, yaw = 0, roll = 0) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cyw = Math.cos(yaw), syw = Math.sin(yaw);
    const fwd = [syw * cp, cyw * cp, -sp];
    let right = [cyw, -syw, 0];
    let up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    if (roll) {
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const r2 = right.map((v, i) => v * cr + up[i] * sr);
      const u2 = up.map((v, i) => v * cr - right[i] * sr);
      right = r2; up = u2;
    }
    this.fwd = fwd; this.right = right; this.up = up;
    this.pos = [target[0] - fwd[0] * dist, target[1] - fwd[1] * dist, target[2] - fwd[2] * dist];
    this.dist = dist;
    this.target = target;
    return this;
  }

  depth(p) {
    const dx = p[0] - this.pos[0], dy = p[1] - this.pos[1], dz = p[2] - this.pos[2];
    return dx * this.fwd[0] + dy * this.fwd[1] + dz * this.fwd[2];
  }

  // Returns [sx, sy, depth, scale(px per mm at that depth)].
  project(p) {
    const dx = p[0] - this.pos[0], dy = p[1] - this.pos[1], dz = p[2] - this.pos[2];
    const z = Math.max(this.near * 0.25, dx * this.fwd[0] + dy * this.fwd[1] + dz * this.fwd[2]);
    const x = dx * this.right[0] + dy * this.right[1] + dz * this.right[2];
    const y = dx * this.up[0] + dy * this.up[1] + dz * this.up[2];
    const s = this.focal / z;
    return [this.cx + x * s, this.cy - y * s, z, s];
  }

  // World point on the plane z = h seen at screen (sx, sy).
  unprojectToZ(sx, sy, h) {
    const x = (sx - this.cx) / this.focal, y = -(sy - this.cy) / this.focal;
    const d = [0, 1, 2].map((i) => this.fwd[i] + this.right[i] * x + this.up[i] * y);
    const t = (h - this.pos[2]) / d[2];
    return [this.pos[0] + d[0] * t, this.pos[1] + d[1] * t, h];
  }
}

// Clip a 3-D segment against the near plane; returns null when fully behind.
export function clipSegment(cam, a, b) {
  const da = cam.depth(a), db = cam.depth(b), n = cam.near;
  if (da < n && db < n) return null;
  if (da >= n && db >= n) return [a, b];
  const t = (n - da) / (db - da);
  const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return da < n ? [c, b] : [a, c];
}
