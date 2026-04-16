import {
  BOMB_COOLDOWN_SECONDS,
  BOMB_FUSE_SECONDS,
  BUG_SPAWN_SECONDS,
  BUG_SPAWN_SPREAD,
  COIN_MAGNET_PULL,
  COIN_MAGNET_RANGE,
  COIN_SPAWN_MIN_SECONDS,
  COIN_SPAWN_RANDOM_SECONDS,
  COIN_SPAWN_SPREAD,
  COIN_VALUES,
  DANGLY_SPAWN_SECONDS,
  DANGLY_SPAWN_SPREAD,
  DASH_COOLDOWN_SECONDS,
  FREEZE_COOLDOWN_SECONDS,
  FREEZE_LIFETIME_SECONDS,
  FREEZE_SPEED,
  HEART_SPAWN_MIN_SECONDS,
  HEART_SPAWN_RANDOM_SECONDS,
  HEART_SPAWN_SPREAD,
  LASER_COOLDOWN_SECONDS,
  LASER_DAMAGE,
  LASER_LIFETIME_SECONDS,
  LASER_SPEED,
  MAX_BUGS,
  MAX_DANGLIES,
  MAX_PORTALS_PER_PLAYER,
  MAX_REFLECTORS,
  PLAYER_DASH_SECONDS,
  PLAYER_HALF_WIDTH,
  PLAYER_SWORD_CENTER_Y,
  PLAYER_WIDTH,
  PORTAL_BOOST_VX,
  PORTAL_COOLDOWN_SECONDS,
  PORTAL_RADIUS,
  PORTAL_TELEPORT_COOLDOWN_SECONDS,
  REFLECTOR_COOLDOWN_SECONDS,
  REFLECTOR_RADIUS,
  REFLECTOR_TTL_SECONDS,
  REGEN_AMOUNT,
  REGEN_INTERVAL_SECONDS,
  SERVER_DT,
  SHAPE_DRAG_DAMAGE_MAX_PCT,
  SHAPE_DRAG_DAMAGE_MIN_DIST,
  SHAPE_DRAG_DAMAGE_SCALE,
  SWORD_COOLDOWN_SECONDS,
  SWORD_DAMAGE,
  SWORD_DEFLECT_RADIUS,
  SWORD_PUSH_DIST,
  SWORD_RANGE,
  SWORD_SWING_SECONDS,
  UPGRADE_SPAWN_MIN_SECONDS,
  UPGRADE_SPAWN_RANDOM_SECONDS,
  UPGRADE_SPAWN_SPREAD
} from "./constants";
import { applySwordHitToBugs, createBug, stepBugs } from "./bugs";
import { damageFish, damagePlayer } from "./damage";
import { applySwordHitToDanglies, createDangly, stepDanglies } from "./danglies";
import { reflectProjectile, stepFish } from "./fish";
import {
  circleIntersectsRect,
  clampInsideWorld,
  ejectPlayerFromShape,
  getCollisionRects,
  hitShapeForGrapple,
  movePlayer,
  playerRect
} from "./physics";
import { stepBombs, stepProjectiles, stepReflectors } from "./projectiles";
import { cloneState, createPlayerState, isPlayerAlive, livingPlayers, resetWorldForMatch, respawnPlayer } from "./state";
import { createShapeFromDraft, shapeContainsPoint } from "./shapes";
import type {
  ClientMessage,
  FrameInputState,
  GameState,
  InputState,
  PlayerState,
  ToolMessage
} from "./types";

const TOOL_CHEAT_MAP = {
  circle: "circle",
  triangle: "triangle",
  line: "line",
  bezier: "bezier",
  polygon: "polygon",
  eraser: "eraser",
  portal: "portal",
  sword: "sword",
  grapple: "grapple",
  reflector: "reflector",
  bomb: "bomb",
  freeze: "freeze",
  laser: "laser"
} as const;

function applyCheatsToPlayer(player: PlayerState, cheats: Record<string, boolean>) {
  player.activeUpgrades = {
    doubleJump: !!cheats.doubleJump,
    sprint: !!cheats.sprint,
    wallClimb: !!cheats.wallClimb,
    glide: !!cheats.glide,
    coinMagnet: !!cheats.coinMagnet,
    dash: !!cheats.dash,
    armor: !!cheats.armor,
    regen: !!cheats.regen,
    reinforce: !!cheats.reinforce
  };

  const inventory = new Set<PlayerState["inventory"][number]>(["square"]);
  for (const [cheatKey, tool] of Object.entries(TOOL_CHEAT_MAP)) {
    if (cheats[cheatKey]) inventory.add(tool);
  }
  player.inventory = Array.from(inventory);
  if (!player.inventory.includes(player.selectedTool)) {
    player.selectedTool = player.inventory[0];
  }
}

function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function sanitizeName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim().slice(0, 16);
  return trimmed || "Player";
}

export function emptyInput(): InputState {
  return {
    left: false,
    right: false,
    jump: false,
    sprint: false,
    crouch: false,
    dash: false
  };
}

export function addPlayerToState(state: GameState, playerId: string, name: string): void {
  if (!state.players[playerId]) {
    state.players[playerId] = createPlayerState(playerId, sanitizeName(name));
  } else {
    state.players[playerId].name = sanitizeName(name);
    state.players[playerId].connected = true;
  }
  if (!state.hostId) state.hostId = playerId;
}

export function removePlayerFromState(state: GameState, playerId: string): void {
  delete state.players[playerId];
  delete state.portals[playerId];
  if (state.hostId === playerId) {
    const [nextHost] = Object.keys(state.players);
    state.hostId = nextHost ?? null;
  }
}

function averageSpawnX(state: GameState): number {
  const alive = livingPlayers(state);
  if (alive.length === 0) return 280;
  return alive.reduce((sum, player) => sum + player.x, 0) / alive.length;
}

function spawnCoin(state: GameState): void {
  const anchor = averageSpawnX(state);
  state.coins.push({
    id: createId("coin"),
    x: anchor + (Math.random() - 0.5) * COIN_SPAWN_SPREAD,
    y: 70 + Math.random() * 180,
    value: COIN_VALUES[Math.floor(Math.random() * COIN_VALUES.length)]
  });
}

function spawnHeart(state: GameState): void {
  const anchor = averageSpawnX(state);
  state.hearts.push({
    id: createId("heart"),
    x: anchor + (Math.random() - 0.5) * HEART_SPAWN_SPREAD,
    y: 90 + Math.random() * 140,
    value: 20
  });
}

const UPGRADE_CATALOG: { key: string; cost: number; tool?: string }[] = [
  { key: "doubleJump", cost: 30 },
  { key: "sprint", cost: 20 },
  { key: "wallClimb", cost: 35 },
  { key: "glide", cost: 25 },
  { key: "coinMagnet", cost: 30 },
  { key: "dash", cost: 35 },
  { key: "armor", cost: 45 },
  { key: "regen", cost: 40 },
  { key: "reinforce", cost: 50 },
  { key: "circle", cost: 25, tool: "circle" },
  { key: "triangle", cost: 20, tool: "triangle" },
  { key: "line", cost: 30, tool: "line" },
  { key: "bezier", cost: 60, tool: "bezier" },
  { key: "polygon", cost: 80, tool: "polygon" },
  { key: "eraser", cost: 15, tool: "eraser" },
  { key: "portal", cost: 50, tool: "portal" },
  { key: "sword", cost: 40, tool: "sword" },
  { key: "grapple", cost: 55, tool: "grapple" },
  { key: "reflector", cost: 45, tool: "reflector" },
  { key: "bomb", cost: 35, tool: "bomb" },
  { key: "freeze", cost: 65, tool: "freeze" },
  { key: "laser", cost: 50, tool: "laser" }
];

function spawnUpgradePickup(state: GameState): void {
  const anchor = averageSpawnX(state);
  const players = Object.values(state.players);
  const owned = new Set<string>();
  for (const p of players) {
    for (const [key, active] of Object.entries(p.activeUpgrades)) {
      if (active) owned.add(key);
    }
    for (const tool of p.inventory) owned.add(tool as string);
  }
  const available = UPGRADE_CATALOG.filter((u) => !owned.has(u.key));
  if (available.length === 0) return;
  const pick = available[Math.floor(Math.random() * available.length)];
  state.upgrades.push({
    id: createId("upg"),
    x: anchor + (Math.random() - 0.5) * UPGRADE_SPAWN_SPREAD,
    y: 80 + Math.random() * 160,
    key: pick.key,
    cost: pick.cost
  });
}

function spawnBugWave(state: GameState): void {
  const anchor = averageSpawnX(state);
  state.bugs.push(createBug(anchor + (Math.random() - 0.5) * BUG_SPAWN_SPREAD, 0));
}

function spawnDangly(state: GameState): void {
  const anchor = averageSpawnX(state);
  state.danglies.push(createDangly(anchor + (Math.random() - 0.5) * DANGLY_SPAWN_SPREAD, 0));
}

// gj spawn gating (L2291-L2325): each timer counts DOWN, and when it hits ≤0 we
// spawn and reseed. coin/heart/upgrade use a "min + random window" reseed; bug
// and dangly use a fixed reseed and are additionally gated by their cap.
type SpawnerKind = keyof GameState["spawnTimers"];
interface Spawner {
  minSeconds: number;
  randomSeconds: number;
  spawn: (state: GameState) => void;
  /** Optional gate (e.g. mob cap). Timer still counts down when gated. */
  canSpawn?: (state: GameState) => boolean;
}

const SPAWNERS: Record<SpawnerKind, Spawner> = {
  coin: { minSeconds: COIN_SPAWN_MIN_SECONDS, randomSeconds: COIN_SPAWN_RANDOM_SECONDS, spawn: spawnCoin },
  heart: { minSeconds: HEART_SPAWN_MIN_SECONDS, randomSeconds: HEART_SPAWN_RANDOM_SECONDS, spawn: spawnHeart },
  upgrade: { minSeconds: UPGRADE_SPAWN_MIN_SECONDS, randomSeconds: UPGRADE_SPAWN_RANDOM_SECONDS, spawn: spawnUpgradePickup },
  bug: {
    minSeconds: BUG_SPAWN_SECONDS,
    randomSeconds: 0,
    spawn: spawnBugWave,
    canSpawn: (s) => s.bugs.length < MAX_BUGS
  },
  dangly: {
    minSeconds: DANGLY_SPAWN_SECONDS,
    randomSeconds: 0,
    spawn: spawnDangly,
    canSpawn: (s) => s.danglies.length < MAX_DANGLIES
  }
};

function stepSpawners(state: GameState, dt: number): void {
  for (const [kind, spawner] of Object.entries(SPAWNERS) as [SpawnerKind, Spawner][]) {
    state.spawnTimers[kind] -= dt;
    if (state.spawnTimers[kind] > 0) continue;
    if (spawner.canSpawn && !spawner.canSpawn(state)) continue;
    state.spawnTimers[kind] = spawner.minSeconds + Math.random() * spawner.randomSeconds;
    spawner.spawn(state);
  }
}

function stepPortals(state: GameState): void {
  for (const player of Object.values(state.players)) {
    const playerPortals = state.portals[player.id] || [];
    if (playerPortals.length !== 2 || player.portalTeleportCooldown > 0 || !isPlayerAlive(player)) continue;
    const [portalA, portalB] = playerPortals;
    const center = { x: player.x + PLAYER_WIDTH / 2, y: player.y + 12 };
    const useA = Math.hypot(center.x - portalA.x, center.y - portalA.y) <= PORTAL_RADIUS;
    const useB = Math.hypot(center.x - portalB.x, center.y - portalB.y) <= PORTAL_RADIUS;
    if (useA || useB) {
      const destination = useA ? portalB : portalA;
      player.x = destination.x - PLAYER_WIDTH / 2;
      player.y = destination.y + 12;
      player.portalBoostX = useA ? PORTAL_BOOST_VX : -PORTAL_BOOST_VX;
      player.portalTeleportCooldown = PORTAL_TELEPORT_COOLDOWN_SECONDS;
    }
  }
}

function applyPickups(state: GameState): void {
  for (const player of Object.values(state.players)) {
    if (!isPlayerAlive(player)) continue;
    const rect = playerRect(player);
    state.coins = state.coins.filter((coin) => {
      if (!circleIntersectsRect({ x: coin.x, y: coin.y }, 8, rect)) return true;
      player.score += coin.value;
      return false;
    });
    state.hearts = state.hearts.filter((heart) => {
      if (!circleIntersectsRect({ x: heart.x, y: heart.y }, 10, rect)) return true;
      player.health = Math.min(player.maxHealth, player.health + heart.value);
      return false;
    });
    state.upgrades = state.upgrades.filter((pickup) => {
      if (!circleIntersectsRect({ x: pickup.x, y: pickup.y }, 10, rect)) return true;
      if (player.score < pickup.cost) return true;
      player.score -= pickup.cost;
      const catalog = UPGRADE_CATALOG.find((u) => u.key === pickup.key);
      if (catalog && catalog.tool) {
        if (!player.inventory.includes(catalog.tool as PlayerState["inventory"][number])) {
          player.inventory.push(catalog.tool as PlayerState["inventory"][number]);
        }
      } else {
        (player.activeUpgrades as Record<string, boolean>)[pickup.key] = true;
      }
      return false;
    });
  }
}

// gj sword tick (L2254-L2287): uses player-center (not a forward-offset box) against
// mobs/fish, knocks the fish back 50px, reflects fish projectiles in range.
// Bug/dangly damage is 10 per hit (see applySwordHitToBugs/Danglies).
function applySword(state: GameState, player: PlayerState): void {
  const pcx = player.x + PLAYER_HALF_WIDTH;
  const pcy = player.y + PLAYER_SWORD_CENTER_Y;

  // gj L2261-L2266: swordHitBugs / swordHitDanglies apply per-target 10 dmg + pushback.
  applySwordHitToBugs(state, pcx, pcy, SWORD_RANGE, player.id);
  applySwordHitToDanglies(state, pcx, pcy, SWORD_RANGE, player.id);

  // gj L2267-L2275: fish take 25 dmg and get pushed 50px away from player.
  if (state.fish.spawned) {
    const fdx = state.fish.x - pcx;
    const fdy = state.fish.y - pcy;
    const fdist = Math.hypot(fdx, fdy);
    if (fdist < SWORD_RANGE) {
      damageFish(state, SWORD_DAMAGE, player.id);
      if (fdist > 1) {
        state.fish.x += (fdx / fdist) * SWORD_PUSH_DIST;
      }
    }
  }

  // PvP extension (sim-authored, game.js has no PvP): sword does SWORD_DAMAGE (25).
  if (state.mode === "pvp") {
    for (const other of Object.values(state.players)) {
      if (other.id === player.id || !isPlayerAlive(other)) continue;
      if (circleIntersectsRect({ x: pcx, y: pcy }, SWORD_RANGE, playerRect(other))) {
        damagePlayer(state, other, SWORD_DAMAGE, player.id);
      }
    }
  }

  // gj L2278-L2286: reflect fish projectiles within SWORD_DEFLECT_RADIUS of player.
  for (const projectile of state.projectiles) {
    if (projectile.ownerKind !== "fish") continue;
    if (Math.hypot(projectile.x - pcx, projectile.y - pcy) <= SWORD_DEFLECT_RADIUS) {
      reflectProjectile(projectile, player.id);
    }
  }
}

function applyToolAction(state: GameState, playerId: string, message: ToolMessage): void {
  const player = state.players[playerId];
  if (!player || !isPlayerAlive(player) || state.phase !== "playing") return;

  if (message.action === "portal" && message.target && player.cooldowns.portal <= 0 && player.inventory.includes("portal")) {
    const portal = {
      id: createId("portal"),
      ownerId: player.id,
      ...clampInsideWorld(message.target),
      slot: (state.portals[player.id] || []).length
    };
    const current = state.portals[player.id] || [];
    current.push(portal);
    if (current.length > MAX_PORTALS_PER_PLAYER) current.shift();
    state.portals[player.id] = current;
    player.cooldowns.portal = PORTAL_COOLDOWN_SECONDS;
  }

  if (message.action === "sword" && player.cooldowns.sword <= 0 && player.inventory.includes("sword")) {
    player.cooldowns.sword = SWORD_COOLDOWN_SECONDS;
    player.swordSeconds = SWORD_SWING_SECONDS;
    applySword(state, player);
  }

  if (message.action === "grapple" && message.target && player.cooldowns.grapple <= 0 && player.inventory.includes("grapple")) {
    // gj activateGrapple (L1613): fires if the target point hits a shape within range.
    // Cooldown is NOT applied on fire — only on release (see sim/physics.ts).
    const grapple = hitShapeForGrapple(state.shapes, message.target);
    if (grapple) player.grapple = grapple;
  }

  if (message.action === "reflector" && message.target && player.cooldowns.reflector <= 0 && player.inventory.includes("reflector")) {
    const angle = Math.atan2(
      message.target.y - (player.y + PLAYER_SWORD_CENTER_Y),
      message.target.x - (player.x + PLAYER_HALF_WIDTH)
    );
    state.reflectors.push({
      id: createId("reflector"),
      ownerId: player.id,
      x: message.target.x,
      y: message.target.y,
      angle,
      radius: REFLECTOR_RADIUS,
      ttl: REFLECTOR_TTL_SECONDS
    });
    if (state.reflectors.length > MAX_REFLECTORS * Math.max(1, Object.keys(state.players).length)) {
      state.reflectors.shift();
    }
    player.cooldowns.reflector = REFLECTOR_COOLDOWN_SECONDS;
  }

  if (message.action === "bomb" && message.target && player.cooldowns.bomb <= 0 && player.inventory.includes("bomb")) {
    state.bombs.push({
      id: createId("bomb"),
      ownerId: player.id,
      x: message.target.x,
      y: message.target.y,
      fuse: BOMB_FUSE_SECONDS,
      explosionSeconds: 0
    });
    player.cooldowns.bomb = BOMB_COOLDOWN_SECONDS;
  }

  if ((message.action === "freeze" || message.action === "laser") && message.target) {
    const originX = player.x + PLAYER_HALF_WIDTH;
    const originY = player.y + PLAYER_SWORD_CENTER_Y;
    const dx = message.target.x - originX;
    const dy = message.target.y - originY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    if (message.action === "freeze" && player.cooldowns.freeze <= 0 && player.inventory.includes("freeze")) {
      state.projectiles.push({
        id: createId("freeze"),
        ownerId: player.id,
        ownerKind: "player",
        kind: "freeze",
        x: originX,
        y: originY,
        vx: (dx / distance) * FREEZE_SPEED,
        vy: (dy / distance) * FREEZE_SPEED,
        radius: 6,
        damage: 0,
        lifetime: FREEZE_LIFETIME_SECONDS,
        reflected: false
      });
      player.cooldowns.freeze = FREEZE_COOLDOWN_SECONDS;
    }
    if (message.action === "laser" && player.cooldowns.laser <= 0 && player.inventory.includes("laser")) {
      state.projectiles.push({
        id: createId("laser"),
        ownerId: player.id,
        ownerKind: "player",
        kind: "laser",
        x: originX,
        y: originY,
        vx: (dx / distance) * LASER_SPEED,
        vy: (dy / distance) * LASER_SPEED,
        radius: 5,
        damage: LASER_DAMAGE,
        lifetime: LASER_LIFETIME_SECONDS,
        reflected: false
      });
      player.cooldowns.laser = LASER_COOLDOWN_SECONDS;
    }
  }
}

export function applyClientMessage(state: GameState, playerId: string, message: ClientMessage): GameState {
  if (message.type === "join") {
    addPlayerToState(state, playerId, message.name);
    return state;
  }

  const player = state.players[playerId];
  if (!player) return state;

  if (message.type === "setMode" && state.hostId === playerId && state.phase === "lobby") {
    state.mode = message.mode;
    return state;
  }

  if (message.type === "startGame" && state.hostId === playerId && Object.keys(state.players).length > 0) {
    state.cheats = { ...(message.cheats || {}) };
    const next = resetWorldForMatch(state);
    for (const nextPlayer of Object.values(next.players)) {
      applyCheatsToPlayer(nextPlayer, state.cheats);
    }
    Object.assign(state, next);
    return state;
  }

  if (message.type === "selectTool") {
    if (player.inventory.includes(message.tool)) {
      player.selectedTool = message.tool;
      // Switching tools abandons any in-progress preview so other players
      // don't see a stale draft pinned to the old tool.
      player.drawDraft = null;
    }
    return state;
  }

  if (message.type === "drawUpdate") {
    // The draft is purely cosmetic — clamp to the fields `DrawShapeDraft`
    // declares so a malformed client can't stuff arbitrary data into the
    // snapshot.
    if (!message.draft) {
      player.drawDraft = null;
    } else {
      const d = message.draft;
      player.drawDraft = {
        tool: d.tool,
        start: d.start,
        end: d.end,
        points: d.points ? d.points.slice() : undefined,
        cursor: d.cursor
      };
    }
    return state;
  }

  if (message.type === "draw" && state.phase === "playing") {
    const shape = createShapeFromDraft(playerId, state.tick, message.draft);
    // Committing the shape (or a rejected attempt) ends the live preview.
    player.drawDraft = null;
    if (shape) {
      state.shapes.push(shape);
      // gj L1110: each newly drawn shape ejects any overlapping player out of its
      // bounding box and damages them based on how far they were shifted.
      for (const other of Object.values(state.players)) {
        if (!isPlayerAlive(other)) continue;
        const { displacedDistance } = ejectPlayerFromShape(other, shape);
        if (displacedDistance < SHAPE_DRAG_DAMAGE_MIN_DIST) continue;
        const pct = Math.min(displacedDistance / SHAPE_DRAG_DAMAGE_SCALE, SHAPE_DRAG_DAMAGE_MAX_PCT);
        const amount = Math.max(1, Math.floor(other.health * pct));
        damagePlayer(state, other, amount, playerId);
      }
    }
    return state;
  }

  if (message.type === "erase" && state.phase === "playing") {
    const target = state.shapes.findIndex((shape) => shapeContainsPoint(shape, message.point));
    if (target >= 0) state.shapes.splice(target, 1);
    return state;
  }

  if (message.type === "tool") {
    applyToolAction(state, playerId, message);
    return state;
  }

  return state;
}

function decayCooldowns(player: PlayerState, dt: number): void {
  if (player.invulnerableSeconds > 0) player.invulnerableSeconds -= dt;
  if (player.damageFlashSeconds > 0) player.damageFlashSeconds -= dt;
  if (player.swordSeconds > 0) player.swordSeconds -= dt;
  if (player.portalTeleportCooldown > 0) player.portalTeleportCooldown -= dt;
  for (const key of Object.keys(player.cooldowns) as (keyof PlayerState["cooldowns"])[]) {
    if (player.cooldowns[key] > 0) player.cooldowns[key] -= dt;
  }
}

export function stepGame(
  state: GameState,
  inputs: Record<string, FrameInputState>,
  dt: number = SERVER_DT
): GameState {
  state.tick += 1;
  if (state.phase === "playing") {
    state.elapsedMs += dt * 1000;
  }

  for (const [index, player] of Object.values(state.players).entries()) {
    decayCooldowns(player, dt);

    if (player.respawnSeconds > 0) {
      player.respawnSeconds -= dt;
      if (player.respawnSeconds <= 0) respawnPlayer(player, index);
      continue;
    }

    const input = inputs[player.id] ?? { ...emptyInput(), jumpPressed: false };
    if (input.dash && player.activeUpgrades.dash && player.cooldowns.dash <= 0) {
      if (input.left) player.direction = "left";
      else if (input.right) player.direction = "right";
      player.dashSeconds = PLAYER_DASH_SECONDS;
      player.cooldowns.dash = DASH_COOLDOWN_SECONDS;
    }
  }

  if (state.phase !== "playing") return state;

  const collisionRects = getCollisionRects(state.shapes);
  for (const player of Object.values(state.players)) {
    if (!isPlayerAlive(player)) continue;
    const input = inputs[player.id] ?? { ...emptyInput(), jumpPressed: false };
    movePlayer(player, input, collisionRects, dt);
  }

  stepSpawners(state, dt);

  applyPickups(state);

  for (const player of Object.values(state.players)) {
    if (!isPlayerAlive(player)) continue;
    if (player.activeUpgrades.regen && player.health > 0 && player.health < player.maxHealth) {
      player.regenAccum += dt;
      while (player.regenAccum >= REGEN_INTERVAL_SECONDS) {
        player.regenAccum -= REGEN_INTERVAL_SECONDS;
        player.health = Math.min(player.maxHealth, player.health + REGEN_AMOUNT);
      }
    } else {
      player.regenAccum = 0;
    }
    if (player.activeUpgrades.coinMagnet) {
      const pcx = player.x + PLAYER_HALF_WIDTH;
      const pcy = player.y + PLAYER_SWORD_CENTER_Y;
      for (const coin of state.coins) {
        const dx = pcx - coin.x;
        const dy = pcy - coin.y;
        const distance = Math.hypot(dx, dy);
        if (distance < COIN_MAGNET_RANGE && distance > 1) {
          coin.x += (dx / distance) * COIN_MAGNET_PULL * dt;
          coin.y += (dy / distance) * COIN_MAGNET_PULL * dt;
        }
      }
    }
  }
  stepBombs(state, dt);
  stepReflectors(state, dt);
  stepPortals(state);
  stepFish(state, dt);
  // stepProjectiles handles fish / player-owned (laser) damage + freeze-on-hit inline.
  stepProjectiles(state, dt);

  stepBugs(state, dt);
  stepDanglies(state, dt);

  const living = livingPlayers(state);
  const mode = state.mode;
  if (mode === "coop" && living.length === 0 && Object.keys(state.players).length > 0) {
    state.phase = "gameover";
    state.winnerId = null;
  }
  if (mode === "pvp" && Object.keys(state.players).length >= 2 && living.length === 1) {
    state.phase = "gameover";
    state.winnerId = living[0]?.id ?? null;
  }

  return state;
}

export function snapshotState(state: GameState): GameState {
  return cloneState(state);
}

export const TICK_MS = 50;
