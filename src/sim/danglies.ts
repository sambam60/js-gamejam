// Danglies — ported from public/danglies.js (IIFE window.DanglySystem).
// State machine preserved verbatim: IDLE=0, WANDER=1, CHASE=2, JUMP=3, CHARGE=4, ATTACK=5, HURT=6.
// Physics convention matches sim: y=0 ground, y+ up (see public/danglies.js L385 comment).
// All per-frame values converted to per-second.

import {
  DANGLY_ARM_MAX_REACH,
  DANGLY_ATTACK_COOLDOWN_SECONDS,
  DANGLY_ATTACK_RANGE,
  DANGLY_BASE_HP,
  DANGLY_CHARGE_SECONDS,
  DANGLY_CHASE_SPEED,
  DANGLY_DAMAGE,
  DANGLY_DETECT_RANGE,
  DANGLY_GRAVITY,
  DANGLY_HEIGHT,
  DANGLY_JUMP_COOLDOWN_SECONDS,
  DANGLY_JUMP_VELOCITY,
  DANGLY_MOVE_SPEED,
  DANGLY_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_WIDTH
} from "./constants";
import { playerHeight, playerRect, rectsOverlap } from "./physics";
import { isPlayerAlive, livingPlayers } from "./state";
import type { DanglyState, GameState, PlayerState, SegmentedShape } from "./types";

const STATES = {
  IDLE: 0,
  WANDER: 1,
  CHASE: 2,
  JUMP: 3,
  CHARGE: 4,
  ATTACK: 5,
  HURT: 6
} as const;

function createId(): string {
  return `dangly_${Math.random().toString(36).slice(2, 10)}`;
}

export function createDangly(x: number, y: number): DanglyState {
  return {
    id: createId(),
    x,
    y,
    vx: 0,
    vy: 0,
    onGround: false,
    hp: DANGLY_BASE_HP,
    maxHp: DANGLY_BASE_HP,
    state: STATES.IDLE,
    // gj L36: 80 + rand*60 frames → 1.33 + rand*1 seconds.
    stateTimer: 80 / 60 + Math.random(),
    direction: Math.random() < 0.5 ? -1 : 1,
    damageCooldown: 0,
    phase: Math.random() * Math.PI * 2,
    hurtTimer: 0,
    jumpCooldown: 0,
    chargeProgress: 0,
    armExtend: 0,
    attackPulse: 0,
    armDirX: 0,
    armDirY: 0,
    attackCooldown: 0,
    chargeTicks: 0,
    frozen: 0
  };
}

function nearestPlayer(state: GameState, dangly: DanglyState): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const player of livingPlayers(state)) {
    const distance = Math.hypot(player.x - dangly.x, player.y - dangly.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = player;
    }
  }
  return best;
}

// gj danglies.js updateAI (L50-L179): state machine + movement only.
function updateDanglyAI(d: DanglyState, target: PlayerState | null, dt: number): void {
  const dcx = d.x + DANGLY_WIDTH / 2;
  const dcy = d.y + DANGLY_HEIGHT / 2;
  const pcx = target ? target.x + PLAYER_WIDTH / 2 : dcx;
  const pcy = target ? target.y + PLAYER_HEIGHT / 2 : dcy;
  const dx = pcx - dcx;
  const dy = pcy - dcy;
  const dist = Math.hypot(dx, dy);

  if (d.hurtTimer > 0) {
    d.hurtTimer -= dt;
    d.chargeProgress = 0;
    d.armExtend = 0;
    if (d.hurtTimer <= 0) d.state = STATES.CHASE;
    return;
  }

  d.stateTimer -= dt;

  switch (d.state) {
    case STATES.IDLE:
      d.vx = 0;
      d.chargeProgress = 0;
      d.armExtend = 0;
      if (target && dist < DANGLY_DETECT_RANGE) {
        d.state = STATES.CHASE;
        d.stateTimer = 2 + Math.random(); // gj 120 + rand*60f
      } else if (d.stateTimer <= 0) {
        d.state = STATES.WANDER;
        d.direction = Math.random() < 0.5 ? -1 : 1;
        d.stateTimer = 100 / 60 + Math.random() * (120 / 60); // gj 100 + rand*120f
      }
      break;

    case STATES.WANDER:
      d.vx = d.direction * DANGLY_MOVE_SPEED;
      d.chargeProgress = 0;
      d.armExtend = 0;
      if (target && dist < DANGLY_DETECT_RANGE) {
        d.state = STATES.CHASE;
        d.stateTimer = 2 + Math.random();
      } else if (d.stateTimer <= 0) {
        d.state = STATES.IDLE;
        d.stateTimer = 50 / 60 + Math.random() * (80 / 60); // gj 50 + rand*80f
      }
      break;

    case STATES.CHASE: {
      d.direction = dx > 0 ? 1 : -1;
      d.vx = d.direction * DANGLY_CHASE_SPEED;
      d.chargeProgress = 0;
      d.armExtend = 0;
      if (target && dist < DANGLY_ATTACK_RANGE) {
        d.state = STATES.CHARGE;
        d.stateTimer = DANGLY_CHARGE_SECONDS;
        d.chargeProgress = 0;
        d.vx = 0;
        break;
      }
      if (d.onGround && d.jumpCooldown <= 0) {
        // gj L114: Math.random() < 0.006 per-frame.
        const jumpChance = 1 - Math.pow(1 - 0.006, 60 * dt);
        if (dy > 25 || Math.random() < jumpChance) {
          d.vy = DANGLY_JUMP_VELOCITY;
          d.onGround = false;
          d.jumpCooldown = DANGLY_JUMP_COOLDOWN_SECONDS;
          d.state = STATES.JUMP;
          d.stateTimer = 50 / 60; // gj 50f
          break;
        }
      }
      if (!target || dist > DANGLY_DETECT_RANGE * 2.5) {
        d.state = STATES.WANDER;
        d.stateTimer = 1; // gj 60f
      }
      break;
    }

    case STATES.JUMP:
      d.direction = dx > 0 ? 1 : -1;
      d.vx = d.direction * DANGLY_CHASE_SPEED * 0.5;
      d.chargeProgress = 0;
      d.armExtend = 0;
      if (d.onGround || d.stateTimer <= 0) {
        d.state = target && dist < DANGLY_DETECT_RANGE ? STATES.CHASE : STATES.IDLE;
        d.stateTimer = 0.5; // gj 30f
      }
      break;

    case STATES.CHARGE:
      d.vx = 0;
      d.direction = dx > 0 ? 1 : -1;
      // gj L143: chargeProgress += 1/DANGLY_CHARGE_FRAMES per-frame → dt/DANGLY_CHARGE_SECONDS/s.
      d.chargeProgress = Math.min(1, d.chargeProgress + dt / DANGLY_CHARGE_SECONDS);
      d.armExtend = d.chargeProgress * DANGLY_ARM_MAX_REACH;
      // gj L145: attackPulse += (0.15 + chargeProgress*0.25)/f → per-sec *60.
      d.attackPulse += (0.15 + d.chargeProgress * 0.25) * 60 * dt;
      if (dist > 0.1) {
        d.armDirX = dx / dist;
        d.armDirY = dy / dist;
      }
      if (d.stateTimer <= 0) {
        d.state = STATES.ATTACK;
        d.stateTimer = 0.5; // gj 30f
        d.armExtend = DANGLY_ARM_MAX_REACH;
      }
      break;

    case STATES.ATTACK:
      d.vx = 0;
      d.armExtend = DANGLY_ARM_MAX_REACH * (0.7 + 0.3 * Math.sin(d.attackPulse));
      d.attackPulse += 0.35 * 60 * dt; // gj L160: 0.35/f
      if (dist > 0.1) {
        d.armDirX = dx / dist;
        d.armDirY = dy / dist;
      }
      if (d.stateTimer <= 0) {
        d.armExtend = 0;
        d.chargeProgress = 0;
        d.state = target && dist < DANGLY_DETECT_RANGE ? STATES.CHASE : STATES.IDLE;
        d.stateTimer = 40 / 60; // gj 40f
      }
      break;

    case STATES.HURT:
      d.vx = 0;
      d.armExtend = 0;
      d.chargeProgress = 0;
      break;
  }
}

function integrateDanglyPhysics(d: DanglyState, shapes: SegmentedShape[], dt: number): void {
  if (d.damageCooldown > 0) d.damageCooldown -= dt;
  if (d.jumpCooldown > 0) d.jumpCooldown -= dt;

  d.vy -= DANGLY_GRAVITY * dt; // gj L384

  const prevY = d.y;
  d.x += d.vx * dt;
  d.y += d.vy * dt;
  d.onGround = false;

  if (d.y <= 0) {
    d.y = 0;
    d.vy = 0;
    d.onGround = true;
  }

  if (d.vy <= 0) {
    for (const shape of shapes) {
      for (const segment of shape.segments) {
        if (d.x + DANGLY_WIDTH <= segment.x || d.x >= segment.x + segment.width) continue;
        const surfTop = segment.y + segment.height;
        if (d.y <= surfTop && d.y >= segment.y && prevY >= surfTop - 1) {
          d.y = surfTop;
          d.vy = 0;
          d.onGround = true;
        }
      }
    }
  }
}

export function stepDanglies(state: GameState, dt: number): void {
  const anchorX = livingPlayers(state)[0]?.x;
  state.danglies = state.danglies.filter((d) => {
    if (d.hp <= 0) return false;
    if (anchorX !== undefined && Math.abs(d.x - anchorX) > 1000) return false;
    return true;
  });

  for (const d of state.danglies) {
    if (d.frozen > 0) {
      d.frozen -= dt;
      continue;
    }
    if (d.attackCooldown > 0) d.attackCooldown -= dt;

    const target = nearestPlayer(state, d);
    updateDanglyAI(d, target, dt);
    integrateDanglyPhysics(d, state.shapes, dt);

    // gj checkPlayerCollision (L422-L453): only CHARGE/ATTACK deal damage; body OR arm-tip
    // overlap applies DANGLY_DAMAGE once per damageCooldown window.
    if (d.damageCooldown > 0) continue;
    if (d.state !== STATES.ATTACK && d.state !== STATES.CHARGE) continue;

    for (const player of Object.values(state.players)) {
      if (!isPlayerAlive(player)) continue;
      const ph = playerHeight(player);
      const playerBody = playerRect(player);
      const bodyHit = rectsOverlap(
        { x: d.x, y: d.y, width: DANGLY_WIDTH, height: DANGLY_HEIGHT },
        playerBody
      );

      let armHit = false;
      if (d.armExtend > 10) {
        const dcx = d.x + DANGLY_WIDTH / 2;
        const dShoulderY = d.y + DANGLY_HEIGHT * 0.65;
        const tipX = dcx + d.armDirX * d.armExtend;
        const tipY = dShoulderY + d.armDirY * d.armExtend;
        const pCenterX = player.x + PLAYER_WIDTH / 2;
        const pCenterY = player.y + ph / 2;
        const adx = pCenterX - tipX;
        const ady = pCenterY - tipY;
        const tipDist = Math.hypot(adx, ady);
        if (tipDist < PLAYER_WIDTH * 0.7 + 8) armHit = true;
      }

      if (bodyHit || armHit) {
        player.health = Math.max(0, player.health - DANGLY_DAMAGE);
        player.damageFlashSeconds = 0.2;
        d.damageCooldown = DANGLY_ATTACK_COOLDOWN_SECONDS;
      }
    }
  }
}

// gj swordHitDanglies (L455-L476): 10 dmg, hurtTimer=15f, 20px pushback, vy=2/f (→ 120/s).
export function applySwordHitToDanglies(
  state: GameState,
  pcx: number,
  pcy: number,
  range: number,
  attackerId: string
): number {
  let killCount = 0;
  for (const d of state.danglies) {
    const dcx = d.x + DANGLY_WIDTH / 2;
    const dcy = d.y + DANGLY_HEIGHT / 2;
    const ddx = dcx - pcx;
    const ddy = dcy - pcy;
    const dist = Math.hypot(ddx, ddy);
    if (dist >= range) continue;
    d.hp -= 10;
    d.hurtTimer = 15 / 60;
    d.state = STATES.HURT;
    d.chargeProgress = 0;
    d.armExtend = 0;
    if (dist > 1) {
      d.x += (ddx / dist) * 20;
      d.vy = 120; // gj 2/f → 120/s
    }
    if (d.hp <= 0) {
      killCount += 1;
      if (state.players[attackerId]) state.players[attackerId].score += 15;
    }
  }
  return killCount;
}
