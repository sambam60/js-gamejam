// Typed adapter from canonical GameState → the legacy render shape used by public/game.js.
//
// This lives in TS so the render contract is type-checked and can be tested, even
// though the consumer (game.js) is still plain JS. The output shape is exactly what
// game.js' freshState() + applyMultiplayerSnapshot() used to build by hand.
//
// game.js still owns phase-transition policy (menu/paused/gameover gating) and idleImg
// randomization because those depend on game.js-only state (idle sprite pool, pause
// clock, onGameOver). Everything else flows through here.

import {
  SWORD_COOLDOWN_SECONDS,
  GRAPPLE_COOLDOWN_SECONDS,
  BOMB_COOLDOWN_SECONDS,
  FREEZE_COOLDOWN_SECONDS,
  LASER_COOLDOWN_SECONDS,
  REFLECTOR_COOLDOWN_SECONDS,
  SWORD_SWING_SECONDS,
  SWORD_HIT_FRAME_SECONDS
} from "../sim/constants";
import type {
  BugState,
  DanglyState,
  Facing,
  FishProjectileVariant,
  GameMode,
  GameState,
  GrappleState,
  PlayerState,
  ProjectileState,
  SegmentedShape
} from "../sim/types";

type LegacyPhase = "menu" | "playing" | "paused" | "gameover";

export interface LegacyRenderState {
  phase: LegacyPhase;
  playerX: number;
  playerY: number;
  playerVY: number;
  onGround: boolean;
  direction: "left" | "right";
  crouching: boolean;
  movingLeft: boolean;
  movingRight: boolean;
  sprinting: boolean;
  health: number;
  maxHealth: number;
  score: number;
  inventory: string[];
  selectedSlot: number;
  activeUpgrades: Record<string, boolean>;
  swordCooldown: number;
  grappleCooldown: number;
  bombCooldown: number;
  freezeCooldown: number;
  laserCooldown: number;
  reflectorCooldown: number;
  dashActive: number;
  swordSwingSeconds: number;
  swordSwing: { frame: number; direction: "left" | "right"; hit: boolean } | null;
  damageFlash: number;
  kills: number;
  deaths: number;
  grapple: { tx: number; ty: number; shape: null } | null;
  portals: { x: number; y: number; slot: number }[];
  reflectors: { x: number; y: number; angle: number }[];
  bombs: { x: number; y: number; timer: number; exploding: number }[];
  squares: SegmentedShape[];
  coins: { x: number; y: number; type: number }[];
  hearts: { x: number; y: number; heal: number }[];
  upgrades: { id: string; x: number; y: number; key: string; cost: number }[];
  fish: { x: number; y: number; spawned: boolean; rotation: number };
  fishHP: number;
  fishMaxHP: number;
  fishFrozen: number;
  fishShootPulse: number;
  projectiles: {
    id: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    type: FishProjectileVariant;
    reflected: boolean;
  }[];
  iceShards: { x: number; y: number; vx: number; vy: number; life: number }[];
  laserBeams: { x: number; y: number; vx: number; vy: number; life: number }[];
  bugs: LegacyBug[];
  danglies: LegacyDangly[];
  gameStartTime: number;
  matchMode: GameMode;
  winnerId: string | null;
  cameraX: number;
}

export interface LegacyBug {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  hp: number;
  maxHp: number;
  state: number;
  stateTimer: number;
  direction: 1 | -1;
  damageCooldown: number;
  phase: number;
  jumpCooldown: number;
  hurtTimer: number;
  frozen: number;
}

export interface LegacyDangly extends LegacyBug {
  chargeProgress: number;
  armExtend: number;
  attackPulse: number;
  armDirX: number;
  armDirY: number;
}

export interface RemoteSwordSwing {
  frame: number;
  direction: Facing;
  hit: boolean;
}

/**
 * Remote-player render shape. We keep the canonical `PlayerState` fields so
 * the renderer can pull name/direction/velocity directly, plus a handful of
 * derived cosmetic fields the renderer doesn't want to recompute frame-by-frame
 * (sword-swing progress, the per-player portal slots, legacy-style damage
 * flash in frames).
 */
export interface RemotePlayerRender extends PlayerState {
  swordSwing: RemoteSwordSwing | null;
  portals: { x: number; y: number; slot: number }[];
  /** damageFlashSeconds converted into the 0..12-frame scale the renderer uses. */
  damageFlash: number;
  grapple: GrappleState | null;
}

export interface RenderAdapterResult {
  next: LegacyRenderState;
  remotePlayers: RemotePlayerRender[];
}

function computeSwordSwing(player: PlayerState): RemoteSwordSwing | null {
  const swordSeconds = player.swordSeconds || 0;
  if (swordSeconds <= 0) return null;
  // Same math as the local-player sword swing below — kept here so remote and
  // local swings stay visually identical.
  const progress = (SWORD_SWING_SECONDS - swordSeconds) / SWORD_SWING_SECONDS;
  const frame = Math.max(0, Math.min(12, progress * 12));
  const hitFrame = (SWORD_HIT_FRAME_SECONDS / SWORD_SWING_SECONDS) * 12;
  return { frame, direction: player.direction, hit: frame >= hitFrame };
}

function flashSecondsToFrames(flashSec: number): number {
  // Values above 1 are already in frames (pre-migration snapshots); everything
  // else is seconds → *60 to reach the 0..12-frame scale the renderer expects.
  return flashSec > 1 ? flashSec : flashSec * 60;
}

function coinTypeFromValue(value: number): number {
  if (value >= 15) return 4;
  if (value >= 10) return 3;
  if (value >= 5) return 2;
  return 1;
}

/**
 * Map a per-second cooldown into the "frames remaining" units the legacy HUD
 * expects. `maxSec` is the sim's cooldown ceiling, `legacyMax` is the frame
 * count the HUD fills to. Returns 0 when the sim cooldown is ≤ 0.
 */
function cdSecondsToLegacy(sec: number, maxSec: number, legacyMax: number): number {
  if (!sec || sec <= 0) return 0;
  return Math.max(0, Math.min(legacyMax, (sec / maxSec) * legacyMax));
}

const FISH_VARIANT_KINDS: Record<string, FishProjectileVariant> = {
  fishRed: "red",
  fishBlue: "blue",
  fishYellow: "yellow",
  fish: "red"
};

function mapBug(b: BugState): LegacyBug {
  return {
    x: b.x,
    y: b.y,
    vx: b.vx,
    vy: b.vy,
    onGround: !!b.onGround,
    hp: b.hp,
    maxHp: b.maxHp,
    state: b.state,
    stateTimer: b.stateTimer,
    direction: b.direction,
    damageCooldown: b.damageCooldown,
    phase: b.phase,
    jumpCooldown: b.jumpCooldown,
    hurtTimer: b.hurtTimer,
    frozen: b.frozen
  };
}

function mapDangly(d: DanglyState): LegacyDangly {
  return {
    x: d.x,
    y: d.y,
    vx: d.vx,
    vy: d.vy,
    onGround: !!d.onGround,
    hp: d.hp,
    maxHp: d.maxHp,
    state: d.state,
    stateTimer: d.stateTimer,
    direction: d.direction,
    damageCooldown: d.damageCooldown,
    phase: d.phase,
    jumpCooldown: d.jumpCooldown,
    hurtTimer: d.hurtTimer,
    frozen: d.frozen,
    chargeProgress: d.chargeProgress,
    armExtend: d.armExtend,
    attackPulse: d.attackPulse,
    armDirX: d.armDirX,
    armDirY: d.armDirY
  };
}

function classifyProjectile(
  projectile: ProjectileState
):
  | { kind: "fish"; variant: FishProjectileVariant }
  | { kind: "ice" }
  | { kind: "laser" }
  | { kind: "other" } {
  if (projectile.kind in FISH_VARIANT_KINDS) {
    return { kind: "fish", variant: FISH_VARIANT_KINDS[projectile.kind] };
  }
  if (projectile.kind === "freeze") return { kind: "ice" };
  if (projectile.kind === "laser") return { kind: "laser" };
  return { kind: "other" };
}

/**
 * Build the next legacy render state from a canonical snapshot.
 * Returns null when the local player isn't present in the snapshot — the caller
 * should keep the previous render state in that case.
 */
export function toRenderState(
  snapshot: GameState,
  localId: string,
  screenWidth: number
): RenderAdapterResult | null {
  const local: PlayerState | undefined =
    snapshot.players[localId] || (Object.values(snapshot.players)[0] as PlayerState | undefined);
  if (!local) return null;

  const swordSwing = computeSwordSwing(local);
  const swordSeconds = local.swordSeconds || 0;
  const damageFlash = flashSecondsToFrames(local.damageFlashSeconds ?? 0);

  const cds = local.cooldowns;
  const projectiles: LegacyRenderState["projectiles"] = [];
  const iceShards: LegacyRenderState["iceShards"] = [];
  const laserBeams: LegacyRenderState["laserBeams"] = [];
  for (const p of snapshot.projectiles || []) {
    const classified = classifyProjectile(p);
    if (classified.kind === "fish") {
      projectiles.push({
        id: p.id,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        type: classified.variant,
        reflected: !!p.reflected
      });
    } else if (classified.kind === "ice") {
      iceShards.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: p.lifetime });
    } else if (classified.kind === "laser") {
      laserBeams.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: p.lifetime });
    }
  }

  const elapsedMs =
    typeof snapshot.elapsedMs === "number" ? snapshot.elapsedMs : snapshot.tick * 50;

  const next: LegacyRenderState = {
    phase: snapshot.phase === "gameover" ? "gameover" : "playing",
    // Render state is Y-up throughout (matching the sim). The renderer flips to
    // canvas space at draw time with `H - y - height`, the same way it already
    // handles every other entity (bugs, fish, coins, reflectors, …).
    playerX: local.x,
    playerY: local.y,
    playerVY: local.vy || 0,
    onGround: !!local.onGround,
    direction: local.direction,
    crouching: !!local.crouching,
    movingLeft: (local.vx || 0) < -0.15,
    movingRight: (local.vx || 0) > 0.15,
    sprinting: !!(local.activeUpgrades?.sprint && Math.abs(local.vx || 0) > 2.8),
    health: local.health,
    maxHealth: local.maxHealth || 100,
    score: local.score,
    inventory: local.inventory && local.inventory.length ? local.inventory.slice() : ["square"],
    selectedSlot: 0, // set below
    activeUpgrades: { ...(local.activeUpgrades || {}) } as Record<string, boolean>,
    swordCooldown: cdSecondsToLegacy(cds.sword, SWORD_COOLDOWN_SECONDS, 50),
    grappleCooldown: cdSecondsToLegacy(cds.grapple, GRAPPLE_COOLDOWN_SECONDS, 90),
    bombCooldown: cdSecondsToLegacy(cds.bomb, BOMB_COOLDOWN_SECONDS, 120),
    freezeCooldown: cdSecondsToLegacy(cds.freeze, FREEZE_COOLDOWN_SECONDS, 600),
    laserCooldown: cdSecondsToLegacy(cds.laser, LASER_COOLDOWN_SECONDS, 45),
    reflectorCooldown: cdSecondsToLegacy(cds.reflector, REFLECTOR_COOLDOWN_SECONDS, 30),
    dashActive: local.dashSeconds || 0,
    swordSwingSeconds: swordSeconds,
    swordSwing,
    damageFlash,
    kills: local.kills || 0,
    deaths: local.deaths || 0,
    grapple: local.grapple
      ? { tx: local.grapple.tx, ty: local.grapple.ty, shape: null }
      : null,
    portals: (snapshot.portals[local.id] || []).map((p) => ({
      x: p.x,
      y: p.y,
      slot: typeof p.slot === "number" ? p.slot : 0
    })),
    reflectors: (snapshot.reflectors || []).map((r) => ({ x: r.x, y: r.y, angle: r.angle || 0 })),
    bombs: (snapshot.bombs || []).map((b) => ({
      x: b.x,
      y: b.y,
      timer: b.fuse || 0,
      exploding: b.explosionSeconds || 0
    })),
    squares: (snapshot.shapes || []).slice(),
    coins: (snapshot.coins || []).map((c) => ({ x: c.x, y: c.y, type: coinTypeFromValue(c.value) })),
    hearts: (snapshot.hearts || []).map((h) => ({ x: h.x, y: h.y, heal: h.value })),
    upgrades: (snapshot.upgrades || []).map((u) => ({
      id: u.id,
      x: u.x,
      y: u.y,
      key: u.key,
      cost: u.cost
    })),
    fish: {
      x: snapshot.fish.x,
      y: snapshot.fish.y,
      spawned: !!snapshot.fish.spawned,
      rotation: snapshot.fish.rotation || 0
    },
    fishHP: snapshot.fish.hp,
    fishMaxHP: snapshot.fish.maxHp,
    fishFrozen: snapshot.fish.frozenSeconds || 0,
    // Legacy HUD draws the bulge pulse in 0..18 frames; sim tracks seconds.
    fishShootPulse: Math.round((snapshot.fish.shootPulseSeconds || 0) * 60),
    projectiles,
    iceShards,
    laserBeams,
    bugs: (snapshot.bugs || []).map(mapBug),
    danglies: (snapshot.danglies || []).map(mapDangly),
    gameStartTime: Date.now() - elapsedMs,
    matchMode: snapshot.mode || "coop",
    winnerId: snapshot.winnerId || null,
    cameraX: Math.max(0, local.x - screenWidth * 0.35)
  };
  next.selectedSlot = Math.max(0, next.inventory.indexOf(local.selectedTool || next.inventory[0]));

  const remotePlayers: RemotePlayerRender[] = Object.values(snapshot.players)
    .filter((p) => p.id !== local.id)
    .map((p) => ({
      ...p,
      swordSwing: computeSwordSwing(p),
      portals: (snapshot.portals[p.id] || []).map((portal) => ({
        x: portal.x,
        y: portal.y,
        slot: typeof portal.slot === "number" ? portal.slot : 0
      })),
      damageFlash: flashSecondsToFrames(p.damageFlashSeconds ?? 0),
      grapple: p.grapple || null
    }));
  return { next, remotePlayers };
}
