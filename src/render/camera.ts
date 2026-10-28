import {
  invert,
  lookAt,
  type Mat4,
  mat4,
  multiply,
  ortho,
  perspective,
  transformPoint,
  type Vec3,
} from './math';

export type Projection = 'perspective' | 'orthographic';

export interface Ray {
  origin: Vec3;
  /** Unit length. */
  dir: Vec3;
}

/**
 * Orbit camera: looks at `target` from `distance` along a direction given by yaw (around Y,
 * 0 looks along −Z) and pitch (up is positive). Orthographic mode keeps the same framing as
 * perspective at the target distance, so switching does not jump.
 */
export class Camera {
  target: Vec3 = [0, 0, 0];
  yaw = Math.PI / 4;
  pitch = Math.PI / 6;
  distance = 60;
  /** Vertical field of view in radians. */
  fovY = (45 * Math.PI) / 180;
  projection: Projection = 'perspective';
  /** Viewport size in CSS pixels. */
  width = 1;
  height = 1;
  /** Radius of the content around the origin; keeps the far plane behind the scene. */
  sceneRadius = 256;

  readonly view: Mat4 = mat4();
  readonly proj: Mat4 = mat4();
  readonly viewProj: Mat4 = mat4();
  readonly invViewProj: Mat4 = mat4();

  /** Camera position in world space. */
  eye(): Vec3 {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
  }

  /** Unit vector from the eye towards the target. */
  forward(): Vec3 {
    const e = this.eye();
    const d = this.distance || 1;
    return [(this.target[0] - e[0]) / d, (this.target[1] - e[1]) / d, (this.target[2] - e[2]) / d];
  }

  /** Half the visible height at the target distance, in world units. */
  halfHeightAtTarget(): number {
    return this.distance * Math.tan(this.fovY / 2);
  }

  /** Horizontal field of view in radians for the current aspect ratio. */
  fovX(): number {
    return 2 * Math.atan(Math.tan(this.fovY / 2) * (this.width / Math.max(1, this.height)));
  }

  /** Moves the target to `center` and backs off until a sphere of `radius` fits the view. */
  fitSphere(center: Vec3, radius: number): void {
    this.target = [center[0], center[1], center[2]];
    this.distance = this.distanceToFit(radius);
  }

  /** Distance at which a sphere of `radius` around the target just fits the view. */
  distanceToFit(radius: number): number {
    const fov = Math.min(this.fovY, this.fovX());
    return Math.max(radius, 1) / Math.sin(fov / 2);
  }

  /** Near and far clip distances of the last update(). */
  private near = 0.1;
  private far = 1000;

  clipRange(): [number, number] {
    return [this.near, this.far];
  }

  update(): void {
    const aspect = this.width / Math.max(1, this.height);
    const eye = this.eye();
    // The camera's own up vector: perpendicular to the view direction, so straight top and
    // bottom views (pitch ±90°) stay well defined.
    const sp = Math.sin(this.pitch);
    const up: Vec3 = [-sp * Math.sin(this.yaw), Math.cos(this.pitch), -sp * Math.cos(this.yaw)];
    lookAt(this.view, eye, this.target, up);
    const reach = this.distance + this.sceneRadius * 2 + 100;
    if (this.projection === 'perspective') {
      const near = Math.max(0.05, this.distance * 0.002);
      this.near = near;
      this.far = reach * 4;
      perspective(this.proj, this.fovY, aspect, near, reach * 4);
    } else {
      const h = this.halfHeightAtTarget();
      // The orthographic camera sits far back so nothing in front of the target is clipped.
      this.near = this.distance - reach;
      this.far = this.distance + reach;
      ortho(
        this.proj,
        -h * aspect,
        h * aspect,
        -h,
        h,
        this.distance - reach,
        this.distance + reach,
      );
    }
    multiply(this.viewProj, this.proj, this.view);
    invert(this.invViewProj, this.viewProj);
  }

  /** The same view for a picture of another size: only its shape matters. */
  resized(width: number, height: number): Camera {
    const c = new Camera();
    c.target = [this.target[0], this.target[1], this.target[2]];
    c.yaw = this.yaw;
    c.pitch = this.pitch;
    c.distance = this.distance;
    c.fovY = this.fovY;
    c.projection = this.projection;
    c.sceneRadius = this.sceneRadius;
    c.width = width;
    c.height = height;
    c.update();
    return c;
  }

  /** World-space ray through a point of the viewport in CSS pixels (origin top left). */
  rayAt(x: number, y: number): Ray {
    const nx = (x / this.width) * 2 - 1;
    const ny = 1 - (y / this.height) * 2;
    const near = transformPoint(this.invViewProj, nx, ny, -1);
    const far = transformPoint(this.invViewProj, nx, ny, 1);
    const dir: Vec3 = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    return { origin: near, dir: [dir[0] / len, dir[1] / len, dir[2] / len] };
  }

  /** Projects a world point to CSS pixels; z is NDC depth (outside −1…1 means clipped). */
  project(p: Vec3): Vec3 {
    const c = transformPoint(this.viewProj, p[0], p[1], p[2]);
    return [((c[0] + 1) / 2) * this.width, ((1 - c[1]) / 2) * this.height, c[2]];
  }
}
