// Fish boss — ported from public/game.js update() fish block (~L2475-L2520)
// and the fish-projectile branch of stepProjectiles (L2536-L2565, see update.ts).

import {
  FISH_BASE_HP,
  FISH_BASE_SPEED,
  FISH_CHASE_DIST_DENOM,
  FISH_CHASE_DIST_THRESHOLD,
  FISH_CONTACT_DAMAGE,
  FISH_CONTACT_RADIUS,
  FISH_HP_SCALE_ON_KILL,
  FISH_MAX_SPEED,
  FISH_PROJECTILE_BLUE_CHANCE,
  FISH_PROJECTILE_OTHER_DAMAGE,
  FISH_PROJECTILE_RED_DAMAGE,
  FISH_PROJECTILE_SIZE,
  FISH_PROJECTILE_SPEED,
  FISH_PROJECTILE_YELLOW_CHANCE,
  FISH_RESPAWN_SECONDS,
  FISH_SHOOT_INTERVAL_SECONDS,
  FISH_SHOOT_MIN_DIST,
  FISH_SHOOT_PULSE_SECONDS,
  FISH_SPAWN_DELAY_MS,
  FISH_SPEED_RAMP_PER_SECOND,
  FISH_TOUCH_COOLDOWN_SECONDS,
  PLAYER_WIDTH
} from "./constants";
import { rectsOverlap } from "./physics";
import { playerHeight, playerRect } from "./physics";
import { isPlayerAlive, livingPlayers } from "./state";
import type {
  FishProjectileVariant,
  GameState,
  PlayerState,
  ProjectileKind,
  ProjectileState
} from "./types";

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nearestTarget(state: GameState): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const player of livingPlayers(state)) {
    const distance = Math.hypot(player.x - state.fish.x, player.y - state.fish.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = player;
    }
  }
  return best;
}

// gj L2509-L2510: roll > 0.92 → blue, > 0.82 → yellow, else red.
// ⇒ 8% blue, 10% yellow, 82% red.
function pickVariant(): FishProjectileVariant {
  const roll = Math.random();
  if (roll > 1 - FISH_PROJECTILE_BLUE_CHANCE) return "blue";
  if (roll > 1 - FISH_PROJECTILE_BLUE_CHANCE - FISH_PROJECTILE_YELLOW_CHANCE) return "yellow";
  return "red";
}

function variantToKind(variant: FishProjectileVariant): ProjectileKind {
  switch (variant) {
    case "red":
      return "fishRed";
    case "blue":
      return "fishBlue";
    case "yellow":
      return "fishYellow";
  }
}

function projectileDamageForVariant(variant: FishProjectileVariant): number {
  // gj L2560: applyDamage(p.type === 'red' ? 12 : 6)
  return variant === "red" ? FISH_PROJECTILE_RED_DAMAGE : FISH_PROJECTILE_OTHER_DAMAGE;
}

function playerCenter(player: PlayerState): { x: number; y: number } {
  return { x: player.x + PLAYER_WIDTH / 2, y: player.y + playerHeight(player) / 2 };
}

// gj L2508-L2513: fires when off-cooldown, ≥60px from target; dir computed from
// fish→target vector; velocity is 2.5/frame (=150/sec) along that direction.
function spawnFishProjectile(state: GameState, target: PlayerState): void {
  const fish = state.fish;
  const pc = playerCenter(target);
  const dx = pc.x - fish.x;
  const dy = pc.y - fish.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const variant = pickVariant();
  fish.shootPulseSeconds = FISH_SHOOT_PULSE_SECONDS;
  state.projectiles.push({
    id: createId("fishshot"),
    ownerId: "fish",
    ownerKind: "fish",
    kind: variantToKind(variant),
    x: fish.x,
    y: fish.y,
    vx: (dx / distance) * FISH_PROJECTILE_SPEED,
    vy: (dy / distance) * FISH_PROJECTILE_SPEED,
    radius: FISH_PROJECTILE_SIZE / 2,
    damage: projectileDamageForVariant(variant),
    // gj doesn't use lifetime; it kills projectiles by distance (>800) from player.
    // stepProjectiles still uses lifetime as a fallback, so seed it generously.
    lifetime: 10,
    reflected: false
  });
}

// gj freshState (L692-L693): fishMaxHP=100; gj L2497: fish.x=playerX+400, fish.y=H*0.5 (=240).
export function resetFishForSpawn(state: GameState): void {
  const alivePlayers = livingPlayers(state);
  const anchor = alivePlayers[0];
  state.fish.spawned = true;
  state.fish.hp = state.fish.maxHp || FISH_BASE_HP;
  state.fish.maxHp = Math.max(state.fish.maxHp || FISH_BASE_HP, FISH_BASE_HP);
  state.fish.speed = FISH_BASE_SPEED;
  state.fish.x = anchor ? anchor.x + 400 : 460;
  state.fish.y = 240; // gj H*0.5 where H=480
  state.fish.vx = 0;
  state.fish.vy = 0;
  // gj L2497: fish.lastShot = now (so first shot respects the 2500ms cadence).
  state.fish.shootCooldown = FISH_SHOOT_INTERVAL_SECONDS;
  state.fish.shootPulseSeconds = 0;
  state.fish.touchCooldown = 0;
  state.fish.frozenSeconds = 0;
}

// gj L2486: respawn after 90s with HP scaled 1.3x — implemented by bumping fish.maxHp
// at kill time (see below) and then re-seeding with that bigger maxHp here.
export function stepFish(state: GameState, dt: number): void {
  const fish = state.fish;

  // Not-yet-spawned: wait for the initial 120s gate, then for any active respawn timer,
  // then spawn. gj applies a per-frame 0.002 stochastic spawn check (see
  // FISH_SPAWN_CHANCE_PER_SECOND) which we simulate via random gate.
  if (!fish.spawned) {
    if (state.elapsedMs < FISH_SPAWN_DELAY_MS) return;
    if (fish.respawnSeconds > 0) {
      fish.respawnSeconds -= dt;
      return;
    }
    if (state.phase === "playing" && livingPlayers(state).length > 0) {
      resetFishForSpawn(state);
    }
    return;
  }

  // gj L2479-L2484: on kill, despawn, bump maxHp by 1.3x, schedule 90s respawn.
  if (fish.hp <= 0) {
    fish.spawned = false;
    fish.respawnSeconds = FISH_RESPAWN_SECONDS;
    fish.maxHp = Math.round(fish.maxHp * FISH_HP_SCALE_ON_KILL);
    fish.vx = 0;
    fish.vy = 0;
    return;
  }

  if (fish.touchCooldown > 0) fish.touchCooldown -= dt;
  if (fish.shootCooldown > 0) fish.shootCooldown -= dt;
  if (fish.shootPulseSeconds > 0) fish.shootPulseSeconds = Math.max(0, fish.shootPulseSeconds - dt);

  // gj L2501: speed = min(0.4 + (elapsed-120000)/1000 * 0.012, 1.8) per-frame.
  // Per-second: min(24 + max(0, elapsedSec-120)*0.72, 108).
  fish.speed = Math.min(
    FISH_MAX_SPEED,
    FISH_BASE_SPEED +
      Math.max(0, (state.elapsedMs - FISH_SPAWN_DELAY_MS) / 1000) * FISH_SPEED_RAMP_PER_SECOND
  );

  const target = nearestTarget(state);
  if (!target) return;

  const pc = playerCenter(target);
  const dx = pc.x - fish.x;
  const dy = pc.y - fish.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  fish.rotation = Math.atan2(dy, dx);

  // gj L2504-L2507: chase boost when far. eff = speed * (1 + (dist-300)/200).
  if (fish.frozenSeconds > 0) {
    fish.frozenSeconds -= dt;
  } else {
    let eff = fish.speed;
    if (distance > FISH_CHASE_DIST_THRESHOLD) {
      eff *= 1 + (distance - FISH_CHASE_DIST_THRESHOLD) / FISH_CHASE_DIST_DENOM;
    }
    fish.vx = (dx / distance) * eff;
    fish.vy = (dy / distance) * eff;
    fish.x += fish.vx * dt;
    fish.y += fish.vy * dt;
    fish.phase += 3 * dt;
  }

  // gj L2508: shoots only when off-cooldown AND dist>60; cadence 2500ms + rand*100.
  if (fish.shootCooldown <= 0 && distance > FISH_SHOOT_MIN_DIST) {
    spawnFishProjectile(state, target);
    fish.shootCooldown = FISH_SHOOT_INTERVAL_SECONDS + Math.random() * 0.1;
  }

  // gj L2516-L2519: touch-damage via 36x36 box overlap around fish, not a circle.
  // Applies FISH_CONTACT_DAMAGE and sets a 1s touch cooldown on the fish (not on player).
  if (fish.touchCooldown <= 0) {
    const fishBox = {
      x: fish.x - FISH_CONTACT_RADIUS,
      y: fish.y - FISH_CONTACT_RADIUS,
      width: FISH_CONTACT_RADIUS * 2,
      height: FISH_CONTACT_RADIUS * 2
    };
    for (const player of Object.values(state.players)) {
      if (!isPlayerAlive(player)) continue;
      if (rectsOverlap(fishBox, playerRect(player))) {
        player.health = Math.max(0, player.health - FISH_CONTACT_DAMAGE);
        player.damageFlashSeconds = 0.2;
        fish.touchCooldown = FISH_TOUCH_COOLDOWN_SECONDS;
        break; // gj sets the cooldown after a single hit, then stops checking.
      }
    }
  }
}

export function reflectProjectile(projectile: ProjectileState, ownerId: string): void {
  projectile.ownerKind = "player";
  projectile.ownerId = ownerId;
  projectile.reflected = true;
  projectile.vx *= -1;
  projectile.vy *= -1;
}
