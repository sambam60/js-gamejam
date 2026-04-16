// Player physics — ported from public/game.js update() block (~L2154-L2221) and
// helpers tryJump (L1875), tryDashFromDirection (L949), crouchHeadBandBlocked (L1910),
// resolveHorizontal (L1921), resolveVertical (L2126), getCollisionRects (L1934).
// All per-frame values have been converted to per-second (see sim/constants.ts).
// Sim convention differs from game.js: sim uses Y-up (player.y increases upward, vy>0 = up,
// gravity negative), whereas game.js uses Y-down (playerY<0 above floor, vy>0 = down,
// gravity +0.3). Conversions are folded into the sign of the ported constants.

import {
  DASH_COOLDOWN_SECONDS,
  GRAPPLE_COOLDOWN_SECONDS,
  GRAPPLE_PULL_BASE,
  GRAPPLE_PULL_DIST_COEF,
  GRAPPLE_PULL_MAX,
  GRAPPLE_RELEASE_DIST,
  GRAPPLE_RELEASE_VY,
  GRAPPLE_VY_BLEND,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_CROUCH_MULT,
  PLAYER_DASH_SECONDS,
  PLAYER_DASH_SPEED,
  PLAYER_GLIDE_FALL_SPEED,
  PLAYER_GRAPPLE_RANGE,
  PLAYER_GRAVITY,
  PLAYER_HEIGHT,
  PLAYER_JUMP_VELOCITY,
  PLAYER_MOVE_SPEED,
  PLAYER_SPRINT_SPEED,
  PLAYER_TERMINAL_VELOCITY,
  PLAYER_WIDTH,
  PORTAL_BOOST_CUTOFF,
  PORTAL_BOOST_DECAY_PER_SECOND,
  WORLD_FLOOR_Y
} from "./constants";
import type { FrameInputState, GrappleState, PlayerState, Rect, SegmentedShape, Vec2 } from "./types";

export function playerHeight(player: Pick<PlayerState, "crouching">): number {
  return player.crouching ? PLAYER_CROUCH_HEIGHT : PLAYER_HEIGHT;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function circleIntersectsRect(center: Vec2, radius: number, rect: Rect): boolean {
  const nearestX = Math.max(rect.x, Math.min(center.x, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(center.y, rect.y + rect.height));
  const dx = center.x - nearestX;
  const dy = center.y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

export function playerRect(player: Pick<PlayerState, "x" | "y" | "crouching">): Rect {
  return {
    x: player.x,
    y: player.y,
    width: PLAYER_WIDTH,
    height: playerHeight(player)
  };
}

// gj getCollisionRects (L1934): flatten all shape segments into one rect list.
export function getCollisionRects(shapes: SegmentedShape[]): Rect[] {
  return shapes.flatMap((shape) => shape.segments);
}

function collides(rect: Rect, collisionRects: Rect[]): boolean {
  return collisionRects.some((collisionRect) => rectsOverlap(rect, collisionRect));
}

// gj resolveHorizontal (L1921): only push out in the travel direction; uses an interior
// band (feet offset by 1px top and bottom) so brushing seams don't wall-stop the player.
function resolveHorizontal(
  player: PlayerState,
  targetX: number,
  collisionRects: Rect[]
): { x: number; hit: number } {
  const rect = playerRect(player);
  const movingRight = targetX > player.x;
  const probe = { ...rect, x: targetX };

  if (!collides(probe, collisionRects)) return { x: targetX, hit: 0 };

  let resolved = player.x;
  let hit = 0;
  for (const segment of collisionRects) {
    if (!rectsOverlap({ ...probe, y: rect.y + 1, height: Math.max(1, rect.height - 2) }, segment)) continue;
    if (movingRight) {
      resolved = Math.min(resolved, segment.x - rect.width);
      hit = 1;
    } else {
      resolved = Math.max(resolved, segment.x + segment.width);
      hit = -1;
    }
  }
  return { x: resolved, hit };
}

// gj resolveVertical (L2126): ground snap when falling and overlapping; head bump when rising.
function resolveVertical(
  player: PlayerState,
  targetY: number,
  collisionRects: Rect[]
): { y: number; onGround: boolean } {
  const rect = playerRect(player);
  const movingUp = targetY > player.y;
  const probe = { ...rect, y: targetY };

  if (probe.y <= WORLD_FLOOR_Y) {
    return { y: WORLD_FLOOR_Y, onGround: true };
  }

  if (!collides(probe, collisionRects)) return { y: targetY, onGround: false };

  let resolved = player.y;
  let onGround = false;
  for (const segment of collisionRects) {
    if (!rectsOverlap({ ...probe, x: rect.x + 2, width: Math.max(1, rect.width - 4) }, segment)) continue;
    if (movingUp) {
      resolved = Math.min(resolved, segment.y - rect.height);
    } else {
      resolved = Math.max(resolved, segment.y + segment.height);
      onGround = true;
    }
  }

  return { y: resolved, onGround };
}

// gj crouchHeadBandBlocked (L1910): when trying to un-crouch, check the 12px strip above
// the crouch hitbox (where the standing head would extend to) for collision.
export function crouchHeadBandBlocked(player: PlayerState, collisionRects: Rect[]): boolean {
  const extra = PLAYER_HEIGHT - PLAYER_CROUCH_HEIGHT;
  if (extra <= 0) return false;
  const band: Rect = {
    x: player.x,
    y: player.y + PLAYER_CROUCH_HEIGHT,
    width: PLAYER_WIDTH,
    height: extra
  };
  return collides(band, collisionRects);
}

// gj tryJump (L1875): ground or near-ground → full jump; wall-climb jump at 85% if touching
// a wall; else double-jump once if upgrade is active. Jumping cancels crouch.
function tryJump(player: PlayerState, collisionRects: Rect[]): void {
  // game.js: "onGround || playerY >= -2" (i.e. at or within 2px of floor)
  if (player.onGround || player.y <= 2) {
    player.crouching = false;
    player.vy = PLAYER_JUMP_VELOCITY;
    player.onGround = false;
    player.airJumpsUsed = 0;
    return;
  }
  if (player.activeUpgrades.wallClimb) {
    // gj: full-rect scan with 2px probes to either side of the player hitbox.
    const ph = playerHeight(player);
    const leftProbe: Rect = { x: player.x - 2, y: player.y, width: 2, height: ph };
    const rightProbe: Rect = { x: player.x + PLAYER_WIDTH, y: player.y, width: 2, height: ph };
    if (collides(leftProbe, collisionRects) || collides(rightProbe, collisionRects)) {
      player.crouching = false;
      player.vy = PLAYER_JUMP_VELOCITY * 0.85;
      return;
    }
  }
  if (player.activeUpgrades.doubleJump && player.airJumpsUsed < 1) {
    player.crouching = false;
    player.vy = PLAYER_JUMP_VELOCITY;
    player.airJumpsUsed += 1;
  }
}

// gj tryDashFromDirection (L949): start a dash if upgrade owned and off cooldown.
// dirSign < 0 / > 0 sets facing; 0 keeps the current facing.
export function tryDashFromDirection(player: PlayerState, dirSign: number): void {
  if (!player.activeUpgrades.dash || player.cooldowns.dash > 0) return;
  player.dashSeconds = PLAYER_DASH_SECONDS;
  player.cooldowns.dash = DASH_COOLDOWN_SECONDS;
  if (dirSign < 0) player.direction = "left";
  else if (dirSign > 0) player.direction = "right";
}

// Continuous-time port of gj's per-frame VY blend "vy = vy*0.3 + target*0.7".
// At dt=1/60 this returns exactly 0.7 (so behavior matches game.js at 60Hz),
// and it scales correctly for any other dt.
function grappleVyBlendFactor(dt: number): number {
  return 1 - Math.pow(1 - GRAPPLE_VY_BLEND, 60 * dt);
}

// Porting note: game.js computes a scalar horizontal offset `grappleHX` that is ADDED to
// the per-frame position delta (proposedX = playerX + dir*speed + grappleHX + portalBoostVX).
// In sim, we instead fold grappleHX into player.vx for the frame so the same dt-scaled
// integration (dx = vx*dt) produces the same total displacement.
export function movePlayer(
  player: PlayerState,
  input: FrameInputState,
  collisionRects: Rect[],
  dt: number
): void {
  // ---- crouch (game.js L2160) --------------------------------------------
  // gj: canCrouch = onGround || playerY >= -2 (at or within 2px of the floor).
  const wantsCrouch = input.crouch;
  const canCrouch = player.onGround || player.y <= 2;
  if (!canCrouch) {
    player.crouching = false;
  } else if (wantsCrouch) {
    player.crouching = true;
  } else if (player.crouching && !crouchHeadBandBlocked(player, collisionRects)) {
    player.crouching = false;
  }

  // ---- movement speed (game.js L2173) ------------------------------------
  // gj: speed = isSprintActive() ? SPRINT_SPEED : MOVE_SPEED;
  //     if (crouching) speed *= CROUCH_SPEED_MULT;
  //     if (dashActive > 0) { speed = 8; dashActive-- }   — dash overrides both.
  let horizontalSpeed = 0;
  if (player.dashSeconds > 0) {
    horizontalSpeed = player.direction === "left" ? -PLAYER_DASH_SPEED : PLAYER_DASH_SPEED;
    player.dashSeconds -= dt;
  } else {
    let base = input.sprint && !player.crouching && player.activeUpgrades.sprint
      ? PLAYER_SPRINT_SPEED
      : PLAYER_MOVE_SPEED;
    if (player.crouching) base *= PLAYER_CROUCH_MULT;
    if (input.left) horizontalSpeed -= base;
    if (input.right) horizontalSpeed += base;
  }

  // Facing follows movement (gj: `if (dir === -1) direction='left'` etc.).
  if (horizontalSpeed < 0) player.direction = "left";
  else if (horizontalSpeed > 0) player.direction = "right";

  // ---- jump (game.js L1875 tryJump, fired on rising edge) ----------------
  if (input.jumpPressed) tryJump(player, collisionRects);

  // ---- grapple pull (game.js L2184-L2194) --------------------------------
  // gj: pullSpeed = min(4.5, 1.5 + gdist*0.01) per frame; horizontal piece is ADDED
  //     to the per-frame dx and vertical is blended (vy = vy*0.3 + targetVY*0.7).
  let grappleHX = 0; // units/second
  let grappling = !!player.grapple;
  if (player.grapple) {
    const g = player.grapple;
    const pcx = player.x + PLAYER_WIDTH / 2;
    const pcy = player.y + playerHeight(player) / 2;
    const gdx = g.tx - pcx;
    const gdy = g.ty - pcy;
    const gdist = Math.hypot(gdx, gdy);
    if (gdist > PLAYER_GRAPPLE_RANGE) {
      // Outside effective range: drop the hook and apply cooldown.
      player.grapple = null;
      player.cooldowns.grapple = GRAPPLE_COOLDOWN_SECONDS;
      grappling = false;
    } else if (gdist > GRAPPLE_RELEASE_DIST) {
      const pullSpeed = Math.min(GRAPPLE_PULL_MAX, GRAPPLE_PULL_BASE + gdist * GRAPPLE_PULL_DIST_COEF);
      grappleHX = (gdx / gdist) * pullSpeed;
      const targetVY = (gdy / gdist) * pullSpeed;
      const blend = grappleVyBlendFactor(dt);
      player.vy = player.vy * (1 - blend) + targetVY * blend;
    } else {
      // Close enough: release with upward kick (gj: vy = min(vy, -2)/f → sim: vy ≥ +120).
      player.vy = Math.max(player.vy, GRAPPLE_RELEASE_VY);
      player.grapple = null;
      player.cooldowns.grapple = GRAPPLE_COOLDOWN_SECONDS;
      grappling = false;
    }
  }

  // ---- compose horizontal velocity (game.js L2197-L2199) -----------------
  // gj: proposedX = playerX + dir*speed + grappleHX + portalBoostVX; portalBoostVX *= 0.92
  //     per-frame; zeroed when abs(...) < 0.05. In sim units everything is per-second.
  if (grappling) {
    player.vx = horizontalSpeed + grappleHX + player.portalBoostX;
  } else {
    player.vx = horizontalSpeed + player.portalBoostX;
  }

  player.portalBoostX *= Math.max(0, 1 - PORTAL_BOOST_DECAY_PER_SECOND * dt);
  if (Math.abs(player.portalBoostX) < PORTAL_BOOST_CUTOFF) player.portalBoostX = 0;

  // ---- gravity & glide (game.js L2210-L2213) -----------------------------
  // gj: if (!grappling) playerVY += GRAVITY; glide caps downward speed at 1.0/f while
  //     jump is held and player is airborne and falling.
  if (!grappling) player.vy += PLAYER_GRAVITY * dt;
  player.vy = Math.max(PLAYER_TERMINAL_VELOCITY, player.vy);

  if (player.activeUpgrades.glide && input.jump && !player.onGround && player.vy < 0) {
    player.vy = Math.max(player.vy, PLAYER_GLIDE_FALL_SPEED);
  }

  // ---- integrate + resolve collisions (game.js L2200-L2216) --------------
  const dx = player.vx * dt;
  const dy = player.vy * dt;

  const horizontal = resolveHorizontal(player, player.x + dx, collisionRects);
  const horizontalBlocked = horizontal.x !== player.x + dx;
  if (horizontalBlocked) {
    player.vx = 0;
    // gj L2203: if grapple was pulling us horizontally and we collided, drop the hook.
    if (grappling && grappleHX !== 0) {
      player.grapple = null;
      player.cooldowns.grapple = GRAPPLE_COOLDOWN_SECONDS;
      grappling = false;
    }
  }
  player.x = horizontal.x;
  player.touchingWall = horizontal.hit;

  const vertical = resolveVertical(player, player.y + dy, collisionRects);
  player.y = vertical.y;
  if (vertical.onGround) {
    player.vy = 0;
    player.onGround = true;
    player.airJumpsUsed = 0;
    // gj L2218: touching ground while grappling drops the hook.
    if (grappling) {
      player.grapple = null;
      player.cooldowns.grapple = GRAPPLE_COOLDOWN_SECONDS;
    }
  } else {
    player.onGround = false;
  }
}

// gj ejectPlayerFromShape (L1110-L1143): when a shape is drawn over a player, push the
// player out along the axis of minimum overlap and report the displacement. In game.js
// the player-vs-shape overlap uses the shape's bounding box (not its segments), and the
// eject snaps grounded/vy state so landing on top of the shape feels clean.
export function ejectPlayerFromShape(
  player: PlayerState,
  shape: Rect
): { displacedDistance: number } {
  const rect = playerRect(player);
  if (!rectsOverlap(rect, shape)) return { displacedDistance: 0 };

  const oldX = player.x;
  const oldY = player.y;

  const pushLeft = rect.x + rect.width - shape.x;            // → player.x = shape.x - width
  const pushRight = shape.x + shape.width - rect.x;          // → player.x = shape.x + shape.width
  const pushDown = rect.y + rect.height - shape.y;           // → player.y = shape.y - height
  const pushUp = shape.y + shape.height - rect.y;            // → player.y = shape.y + shape.height
  const minPush = Math.min(pushLeft, pushRight, pushDown, pushUp);

  if (minPush === pushUp) {
    player.y = shape.y + shape.height;
    player.vy = 0;
    player.onGround = true;
    player.airJumpsUsed = 0;
  } else if (minPush === pushDown) {
    player.y = shape.y - rect.height;
    player.vy = 0;
  } else if (minPush === pushLeft) {
    player.x = shape.x - rect.width;
  } else {
    player.x = shape.x + shape.width;
  }

  const dx = player.x - oldX;
  const dy = player.y - oldY;
  return { displacedDistance: Math.hypot(dx, dy) };
}

export function clampInsideWorld(point: Vec2, maxX = 3200, maxY = 1200): Vec2 {
  return {
    x: Math.max(-200, Math.min(maxX, point.x)),
    y: Math.max(WORLD_FLOOR_Y, Math.min(maxY, point.y))
  };
}

export function hitShapeForGrapple(shapes: SegmentedShape[], target: Vec2): GrappleState | null {
  for (const shape of shapes) {
    for (const segment of shape.segments) {
      if (
        target.x >= segment.x &&
        target.x <= segment.x + segment.width &&
        target.y >= segment.y &&
        target.y <= segment.y + segment.height
      ) {
        return { tx: target.x, ty: target.y, shapeId: shape.id };
      }
    }
  }
  return null;
}
