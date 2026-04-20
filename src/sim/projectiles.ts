// Projectile / bomb / reflector physics. Extracted from update.ts so the per-variant
// collision rules (fishRed blocked, fishYellow erases, reflected fish vs fish, freeze
// on mobs, laser per-target damage) live in one place.
//
// Notable bugfix during extraction: freeze projectiles that hit fish/bug/dangly used
// to be consumed by the player-owned damage branch (setting keep=false with damage=0),
// which then ran BEFORE the follow-up "freeze-on-hit" loop in stepGame — meaning
// freeze never actually froze anything. That post-loop is gone; stepProjectiles now
// handles freeze-on-hit inline for fish/bugs/danglies.
import {
  BOMB_DAMAGE,
  BOMB_EXPLOSION_RADIUS,
  BOMB_EXPLOSION_SECONDS,
  BUG_HEIGHT,
  BUG_WIDTH,
  DANGLY_HEIGHT,
  DANGLY_WIDTH,
  FISH_BOMB_HITBOX_HALF,
  FISH_PROJECTILE_HITBOX_HALF,
  FISH_PROJECTILE_MAX_DIST_SQ,
  FISH_REFLECTED_DAMAGE,
  FISH_REFLECTED_HIT_RADIUS,
  FREEZE_DURATION_SECONDS,
  GRAPPLE_COOLDOWN_SECONDS,
  LASER_DAMAGE_BUG,
  LASER_DAMAGE_DANGLY
} from "./constants";
import { damageFish, damageMob, damagePlayer } from "./damage";
import { reflectProjectile } from "./fish";
import { circleIntersectsRect, playerRect } from "./physics";
import { isPlayerAlive, livingPlayers } from "./state";
import type { BombState, GameState, ProjectileState } from "./types";

const fishBombRect = (state: GameState) => ({
  x: state.fish.x - FISH_BOMB_HITBOX_HALF,
  y: state.fish.y - FISH_BOMB_HITBOX_HALF,
  width: FISH_BOMB_HITBOX_HALF * 2,
  height: FISH_BOMB_HITBOX_HALF * 2
});

const fishProjectileRect = (state: GameState) => ({
  x: state.fish.x - FISH_PROJECTILE_HITBOX_HALF,
  y: state.fish.y - FISH_PROJECTILE_HITBOX_HALF,
  width: FISH_PROJECTILE_HITBOX_HALF * 2,
  height: FISH_PROJECTILE_HITBOX_HALF * 2
});

const bugRect = (bug: GameState["bugs"][number]) => ({ x: bug.x, y: bug.y, width: BUG_WIDTH, height: BUG_HEIGHT });
const danglyRect = (d: GameState["danglies"][number]) => ({ x: d.x, y: d.y, width: DANGLY_WIDTH, height: DANGLY_HEIGHT });

const isFishVariant = (kind: ProjectileState["kind"]): boolean =>
  kind === "fishRed" || kind === "fishBlue" || kind === "fishYellow";

export function stepBombs(state: GameState, dt: number): void {
  const next: BombState[] = [];

  for (const bomb of state.bombs) {
    if (bomb.fuse > 0) {
      bomb.fuse -= dt;
      if (bomb.fuse <= 0) {
        bomb.fuse = 0;
        bomb.explosionSeconds = BOMB_EXPLOSION_SECONDS;
      }
      next.push(bomb);
      continue;
    }

    if (bomb.explosionSeconds > 0) {
      const center = { x: bomb.x, y: bomb.y };
      for (const player of Object.values(state.players)) {
        if (!isPlayerAlive(player)) continue;
        if (state.mode !== "pvp" && player.id === bomb.ownerId) continue;
        if (circleIntersectsRect(center, BOMB_EXPLOSION_RADIUS, playerRect(player))) {
          damagePlayer(state, player, BOMB_DAMAGE, bomb.ownerId);
        }
      }

      if (circleIntersectsRect(center, BOMB_EXPLOSION_RADIUS, fishBombRect(state))) {
        damageFish(state, BOMB_DAMAGE, bomb.ownerId);
      }

      for (const bug of state.bugs) {
        if (circleIntersectsRect(center, BOMB_EXPLOSION_RADIUS, bugRect(bug))) {
          damageMob(state, bug.id, "bug", BOMB_DAMAGE, bomb.ownerId);
        }
      }

      for (const dangly of state.danglies) {
        if (circleIntersectsRect(center, BOMB_EXPLOSION_RADIUS, danglyRect(dangly))) {
          damageMob(state, dangly.id, "dangly", BOMB_DAMAGE, bomb.ownerId);
        }
      }

      bomb.explosionSeconds -= dt;
      if (bomb.explosionSeconds > 0) next.push(bomb);
    }
  }

  state.bombs = next;
}

export function stepReflectors(state: GameState, dt: number): void {
  state.reflectors = state.reflectors.filter((reflector) => {
    reflector.ttl -= dt;
    return reflector.ttl > 0;
  });
}

// gj stepProjectiles — ported from public/game.js L2536-L2565.
// Per-variant behavior:
//   fishRed        → blocked by shapes; 12 dmg to player
//   fishBlue       → passes through shapes; 6 dmg to player
//   fishYellow     → erases shapes (unless any player has reinforce); 6 dmg to player
//   reflected fish → blocked by shapes; can hit fish (15 dmg @ r=20)
//   laser          → damages fish/bug/dangly (per-target); (pvp) hits other players
//   freeze         → freezes fish/bug/dangly for FREEZE_DURATION_SECONDS; no damage
export function stepProjectiles(state: GameState, dt: number): void {
  const reinforced = Object.values(state.players).some((p) => p.activeUpgrades.reinforce);
  const next: ProjectileState[] = [];

  for (const projectile of state.projectiles) {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.lifetime -= dt;
    if (projectile.lifetime <= 0) continue;

    let keep = true;
    const center = { x: projectile.x, y: projectile.y };

    // gj L2539: fish projectiles die if they drift >800 from the nearest alive player.
    // (Player-owned projectiles use pure lifetime, matching gj laser/freeze behavior.)
    if (isFishVariant(projectile.kind)) {
      let closest = Number.POSITIVE_INFINITY;
      for (const player of livingPlayers(state)) {
        const distSq = (projectile.x - player.x) ** 2 + (projectile.y - player.y) ** 2;
        if (distSq < closest) closest = distSq;
      }
      if (closest > FISH_PROJECTILE_MAX_DIST_SQ) continue;
      // gj L2542: fish projectiles die on the floor.
      if (projectile.y <= 0) continue;

      // Reflectors only bend fish projectiles; player-owned projectiles pass through.
      for (const reflector of state.reflectors) {
        const dx = projectile.x - reflector.x;
        const dy = projectile.y - reflector.y;
        if (Math.hypot(dx, dy) <= reflector.radius + projectile.radius) {
          reflectProjectile(projectile, reflector.ownerId);
        }
      }

      // gj L2547-L2549: reflected fish projectiles can hit the fish.
      if (
        projectile.reflected &&
        state.fish.spawned &&
        Math.hypot(projectile.x - state.fish.x, projectile.y - state.fish.y) < FISH_REFLECTED_HIT_RADIUS
      ) {
        damageFish(state, FISH_REFLECTED_DAMAGE, projectile.ownerId);
        continue;
      }

      // Shape collision: red / reflected are blocked; yellow (non-reflected) erases;
      // blue passes through.
      const blockedByShapes = projectile.kind === "fishRed" || projectile.reflected;
      const erasesShapes =
        projectile.kind === "fishYellow" && !projectile.reflected && !reinforced;

      if (blockedByShapes) {
        let hit = false;
        for (const shape of state.shapes) {
          if (shape.segments.some((segment) => circleIntersectsRect(center, projectile.radius, segment))) {
            hit = true;
            break;
          }
        }
        if (hit) continue;
      } else if (erasesShapes) {
        const before = state.shapes.length;
        state.shapes = state.shapes.filter(
          (shape) => !shape.segments.some((segment) => circleIntersectsRect(center, projectile.radius, segment))
        );
        if (state.shapes.length !== before) {
          // gj L1596-L1600: if the grapple target's shape vanished, drop the hook.
          for (const player of Object.values(state.players)) {
            if (!player.grapple) continue;
            if (!state.shapes.some((s) => s.id === player.grapple!.shapeId)) {
              player.grapple = null;
              player.cooldowns.grapple = GRAPPLE_COOLDOWN_SECONDS;
            }
          }
        }
      }

      // Damage alive players (reflected ones have already hit the fish and continued).
      for (const player of Object.values(state.players)) {
        if (!keep || !isPlayerAlive(player)) continue;
        if (circleIntersectsRect(center, projectile.radius, playerRect(player))) {
          damagePlayer(state, player, projectile.damage);
          keep = false;
        }
      }

      if (keep) next.push(projectile);
      continue;
    }

    // Player-owned (laser / freeze). Both are stopped by the first shape hit.
    let hitShape = false;
    for (const shape of state.shapes) {
      if (shape.segments.some((segment) => circleIntersectsRect(center, projectile.radius, segment))) {
        hitShape = true;
        break;
      }
    }
    if (hitShape) continue;

    if (projectile.kind === "freeze") {
      // Freeze: no damage; apply FREEZE_DURATION_SECONDS stun to the first hit target.
      if (
        state.fish.spawned &&
        circleIntersectsRect(center, projectile.radius, fishProjectileRect(state))
      ) {
        state.fish.frozenSeconds = FREEZE_DURATION_SECONDS;
        continue;
      }
      let frozenHit = false;
      for (const bug of state.bugs) {
        if (circleIntersectsRect(center, projectile.radius, bugRect(bug))) {
          bug.frozen = FREEZE_DURATION_SECONDS;
          frozenHit = true;
          break;
        }
      }
      if (frozenHit) continue;
      for (const dangly of state.danglies) {
        if (circleIntersectsRect(center, projectile.radius, danglyRect(dangly))) {
          dangly.frozen = FREEZE_DURATION_SECONDS;
          frozenHit = true;
          break;
        }
      }
      if (frozenHit) continue;
      if (state.mode === "pvp") {
        for (const player of Object.values(state.players)) {
          if (player.id === projectile.ownerId || !isPlayerAlive(player)) continue;
          if (circleIntersectsRect(center, projectile.radius, playerRect(player))) {
            damagePlayer(state, player, projectile.damage, projectile.ownerId);
            keep = false;
            break;
          }
        }
      }
      if (keep) next.push(projectile);
      continue;
    }

    // Laser: per-target damage (fish=stored damage, bug=12, dangly=15) and PvP players.
    const bugDamage = projectile.kind === "laser" ? LASER_DAMAGE_BUG : projectile.damage;
    const danglyDamage = projectile.kind === "laser" ? LASER_DAMAGE_DANGLY : projectile.damage;

    if (
      state.fish.spawned &&
      circleIntersectsRect(center, projectile.radius, fishProjectileRect(state))
    ) {
      damageFish(state, projectile.damage, projectile.ownerId);
      keep = false;
    }

    for (const bug of state.bugs) {
      if (!keep) break;
      if (circleIntersectsRect(center, projectile.radius, bugRect(bug))) {
        damageMob(state, bug.id, "bug", bugDamage, projectile.ownerId);
        keep = false;
      }
    }

    for (const dangly of state.danglies) {
      if (!keep) break;
      if (circleIntersectsRect(center, projectile.radius, danglyRect(dangly))) {
        damageMob(state, dangly.id, "dangly", danglyDamage, projectile.ownerId);
        keep = false;
      }
    }

    if (state.mode === "pvp") {
      for (const player of Object.values(state.players)) {
        if (!keep || player.id === projectile.ownerId || !isPlayerAlive(player)) continue;
        if (circleIntersectsRect(center, projectile.radius, playerRect(player))) {
          damagePlayer(state, player, projectile.damage, projectile.ownerId);
          keep = false;
        }
      }
    }

    if (keep) next.push(projectile);
  }

  state.projectiles = next;
}
