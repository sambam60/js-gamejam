// Bugs — ported from public/bugs.js (IIFE window.BugSystem).
// State machine preserved verbatim: IDLE=0, WANDER=1, CHASE=2, JUMP=3, ATTACK=4, HURT=5.
// All per-frame values converted to per-second (dt-aware).
// Physics convention matches sim: y=0 ground, y+ up (see public/bugs.js L238 comment).

import {
  BUG_ATTACK_COOLDOWN_SECONDS,
  BUG_ATTACK_RANGE,
  BUG_BASE_HP,
  BUG_CHASE_SPEED,
  BUG_DAMAGE,
  BUG_DETECT_RANGE,
  BUG_GRAVITY,
  BUG_HEIGHT,
  BUG_JUMP_VELOCITY,
  BUG_MOVE_SPEED,
  BUG_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_WIDTH
} from "./constants";
import { playerRect, rectsOverlap } from "./physics";
import { isPlayerAlive, livingPlayers } from "./state";
import type { BugState, GameState, PlayerState, SegmentedShape } from "./types";

const STATES = {
  IDLE: 0,
  WANDER: 1,
  CHASE: 2,
  JUMP: 3,
  ATTACK: 4,
  HURT: 5
} as const;

function createId(): string {
  return `bug_${Math.random().toString(36).slice(2, 10)}`;
}

export function createBug(x: number, y: number): BugState {
  return {
    id: createId(),
    x,
    y,
    vx: 0,
    vy: 0,
    onGround: false,
    hp: BUG_BASE_HP,
    maxHp: BUG_BASE_HP,
    state: STATES.IDLE,
    // gj bugs.js L31: 60 + rand*60 frames → 1 + rand*1 seconds.
    stateTimer: 1 + Math.random(),
    direction: Math.random() < 0.5 ? -1 : 1,
    damageCooldown: 0,
    phase: Math.random() * Math.PI * 2,
    jumpCooldown: 0,
    hurtTimer: 0,
    frozen: 0,
    attackCooldown: 0
  };
}

function nearestPlayer(state: GameState, bug: BugState): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const player of livingPlayers(state)) {
    const distance = Math.hypot(player.x - bug.x, player.y - bug.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = player;
    }
  }
  return best;
}

// gj bugs.js updateAI (L41-L131). State machine + movement decisions only; physics is
// integrated afterwards in stepBugs.
function updateBugAI(bug: BugState, target: PlayerState | null, dt: number): void {
  // gj: centers used for distance checks (L42-L45).
  const bcx = bug.x + BUG_WIDTH / 2;
  const bcy = bug.y + BUG_HEIGHT / 2;
  const pcx = target ? target.x + PLAYER_WIDTH / 2 : bcx;
  const pcy = target ? target.y + PLAYER_HEIGHT / 2 : bcy;
  const dx = pcx - bcx;
  const dy = pcy - bcy;
  const dist = Math.hypot(dx, dy);

  if (bug.hurtTimer > 0) {
    bug.hurtTimer -= dt;
    if (bug.hurtTimer <= 0) bug.state = STATES.CHASE;
    return;
  }

  bug.stateTimer -= dt;

  switch (bug.state) {
    case STATES.IDLE:
      bug.vx = 0;
      if (target && dist < BUG_DETECT_RANGE) {
        bug.state = STATES.CHASE;
        bug.stateTimer = 2 + Math.random(); // gj 120 + rand*60f
      } else if (bug.stateTimer <= 0) {
        bug.state = STATES.WANDER;
        bug.direction = Math.random() < 0.5 ? -1 : 1;
        bug.stateTimer = 80 / 60 + Math.random() * (100 / 60); // gj 80 + rand*100f
      }
      break;

    case STATES.WANDER:
      bug.vx = bug.direction * BUG_MOVE_SPEED;
      if (target && dist < BUG_DETECT_RANGE) {
        bug.state = STATES.CHASE;
        bug.stateTimer = 2 + Math.random();
      } else if (bug.stateTimer <= 0) {
        bug.state = STATES.IDLE;
        bug.stateTimer = 40 / 60 + Math.random() * (80 / 60); // gj 40 + rand*80f
      }
      break;

    case STATES.CHASE: {
      bug.direction = dx > 0 ? 1 : -1;
      bug.vx = bug.direction * BUG_CHASE_SPEED;
      if (target && dist < BUG_ATTACK_RANGE) {
        bug.state = STATES.ATTACK;
        bug.stateTimer = 0.5; // gj 30f
        break;
      }
      if (bug.onGround && bug.jumpCooldown <= 0) {
        // gj L95: random jump chance 0.012/frame. Convert to Poisson-per-step:
        // p = 1 - (1 - 0.012)^(60*dt). At dt=1/60 this is exactly 0.012.
        const jumpChance = 1 - Math.pow(1 - 0.012, 60 * dt);
        if (dy > 30 || Math.random() < jumpChance) {
          bug.vy = BUG_JUMP_VELOCITY;
          bug.onGround = false;
          bug.jumpCooldown = 1; // gj 60f
          bug.state = STATES.JUMP;
          bug.stateTimer = 40 / 60; // gj 40f
          break;
        }
      }
      if (!target || dist > BUG_DETECT_RANGE * 2) {
        bug.state = STATES.WANDER;
        bug.stateTimer = 1; // gj 60f
      }
      break;
    }

    case STATES.JUMP:
      bug.direction = dx > 0 ? 1 : -1;
      bug.vx = bug.direction * BUG_CHASE_SPEED * 0.7;
      if (bug.onGround || bug.stateTimer <= 0) {
        bug.state = target && dist < BUG_DETECT_RANGE ? STATES.CHASE : STATES.IDLE;
        bug.stateTimer = 0.5; // gj 30f
      }
      break;

    case STATES.ATTACK:
      bug.vx = 0;
      if (bug.stateTimer <= 0) {
        bug.state = target && dist < BUG_DETECT_RANGE ? STATES.CHASE : STATES.IDLE;
        bug.stateTimer = 40 / 60; // gj 40f
      }
      break;

    case STATES.HURT:
      bug.vx = 0;
      break;
  }
}

// gj bugs.js updateAll (L231-L270): integrate vy with BUG_GRAVITY, integrate x/y,
// then resolve floor and platform top-landing (only when falling and above surface last frame).
function integrateBugPhysics(bug: BugState, shapes: SegmentedShape[], dt: number): void {
  if (bug.jumpCooldown > 0) bug.jumpCooldown -= dt;
  if (bug.damageCooldown > 0) bug.damageCooldown -= dt;

  // gj: b.vy -= BUG_GRAVITY per-frame (Y-up convention).
  bug.vy -= BUG_GRAVITY * dt;

  const prevY = bug.y;
  bug.x += bug.vx * dt;
  bug.y += bug.vy * dt;
  bug.onGround = false;

  if (bug.y <= 0) {
    bug.y = 0;
    bug.vy = 0;
    bug.onGround = true;
  }

  if (bug.vy <= 0) {
    for (const shape of shapes) {
      for (const segment of shape.segments) {
        if (bug.x + BUG_WIDTH <= segment.x || bug.x >= segment.x + segment.width) continue;
        const surfTop = segment.y + segment.height;
        // gj L257: b.y <= surfTop && b.y >= s.y && b.y - b.vy >= surfTop - 1
        // In dt-form, "b.y - b.vy per-frame" becomes prevY; the "-1" tolerance is preserved.
        if (bug.y <= surfTop && bug.y >= segment.y && prevY >= surfTop - 1) {
          bug.y = surfTop;
          bug.vy = 0;
          bug.onGround = true;
        }
      }
    }
  }
}

export function stepBugs(state: GameState, dt: number): void {
  // gj L232-L234: drop dead bugs and bugs too far from the player.
  const anyPlayerX = livingPlayers(state)[0]?.x;

  state.bugs = state.bugs.filter((bug) => {
    if (bug.hp <= 0) return false;
    if (anyPlayerX !== undefined && Math.abs(bug.x - anyPlayerX) > 900) return false;
    return true;
  });

  for (const bug of state.bugs) {
    if (bug.frozen > 0) {
      bug.frozen -= dt;
      continue;
    }
    if (bug.attackCooldown > 0) bug.attackCooldown -= dt;
    if (bug.hurtTimer > 0) bug.hurtTimer -= dt;

    const target = nearestPlayer(state, bug);
    updateBugAI(bug, target, dt);
    integrateBugPhysics(bug, state.shapes, dt);

    // gj checkPlayerCollision (L278-L291): per-frame overlap applies BUG_DAMAGE once per
    // damageCooldown window to any overlapping player, and slams the bug into ATTACK state.
    for (const player of Object.values(state.players)) {
      if (!isPlayerAlive(player)) continue;
      if (bug.damageCooldown > 0) continue;
      const bugRect = { x: bug.x, y: bug.y, width: BUG_WIDTH, height: BUG_HEIGHT };
      if (!rectsOverlap(bugRect, playerRect(player))) continue;
      player.health = Math.max(0, player.health - BUG_DAMAGE);
      player.damageFlashSeconds = 0.2;
      bug.damageCooldown = BUG_ATTACK_COOLDOWN_SECONDS;
      bug.attackCooldown = BUG_ATTACK_COOLDOWN_SECONDS;
      bug.state = STATES.ATTACK;
      bug.stateTimer = 20 / 60; // gj L287: stateTimer = 20f
    }
  }
}

// gj bugs.js swordHitBugs (L293-L312): 10 dmg, hurtTimer=15f (0.25s), pushback 30px, vy=3 (per-frame bump → 180/s).
export function applySwordHitToBugs(
  state: GameState,
  pcx: number,
  pcy: number,
  range: number,
  attackerId: string
): number {
  let killCount = 0;
  for (const bug of state.bugs) {
    const bcx = bug.x + BUG_WIDTH / 2;
    const bcy = bug.y + BUG_HEIGHT / 2;
    const ddx = bcx - pcx;
    const ddy = bcy - pcy;
    const d = Math.hypot(ddx, ddy);
    if (d >= range) continue;
    bug.hp -= 10;
    bug.hurtTimer = 15 / 60;
    bug.state = STATES.HURT;
    if (d > 1) {
      bug.x += (ddx / d) * 30;
      bug.vy = 180; // gj 3/f → 180/s upward pop
    }
    if (bug.hp <= 0) {
      killCount += 1;
      if (state.players[attackerId]) state.players[attackerId].score += 10;
    }
  }
  return killCount;
}
