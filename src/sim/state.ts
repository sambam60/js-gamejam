import {
  BUG_SPAWN_SECONDS,
  COIN_SPAWN_MIN_SECONDS,
  COIN_SPAWN_RANDOM_SECONDS,
  DANGLY_SPAWN_SECONDS,
  FISH_BASE_HP,
  FISH_BASE_SPEED,
  HEART_SPAWN_MIN_SECONDS,
  HEART_SPAWN_RANDOM_SECONDS,
  PLAYER_INVULNERABLE_SECONDS,
  PLAYER_MAX_HEALTH,
  PLAYER_WIDTH,
  TOOL_ORDER,
  UPGRADE_SPAWN_MIN_SECONDS,
  UPGRADE_SPAWN_RANDOM_SECONDS
} from "./constants";
import type { Cooldowns, GameMode, GameState, PlayerState, ToolName } from "./types";

function freshCooldowns(): Cooldowns {
  return {
    dash: 0,
    sword: 0,
    grapple: 0,
    reflector: 0,
    bomb: 0,
    freeze: 0,
    laser: 0,
    portal: 0
  };
}

export function createPlayerState(id: string, name = "Player"): PlayerState {
  const inventory: ToolName[] = ["square"];
  return {
    id,
    name,
    connected: true,
    ready: false,
    x: 60,
    y: 0,
    vx: 0,
    vy: 0,
    onGround: true,
    touchingWall: 0,
    airJumpsUsed: 0,
    direction: "right",
    crouching: false,
    health: PLAYER_MAX_HEALTH,
    maxHealth: PLAYER_MAX_HEALTH,
    score: 0,
    selectedTool: inventory[0],
    inventory,
    activeUpgrades: {},
    cooldowns: freshCooldowns(),
    dashSeconds: 0,
    swordSeconds: 0,
    damageFlashSeconds: 0,
    invulnerableSeconds: 0,
    respawnSeconds: 0,
    regenAccum: 0,
    portalBoostX: 0,
    portalTeleportCooldown: 0,
    grapple: null,
    kills: 0,
    deaths: 0,
    drawDraft: null
  };
}

export function createFishState() {
  return {
    spawned: false,
    x: -200,
    y: 140,
    vx: 0,
    vy: 0,
    speed: FISH_BASE_SPEED,
    hp: FISH_BASE_HP,
    maxHp: FISH_BASE_HP,
    shootCooldown: 0,
    shootPulseSeconds: 0,
    touchCooldown: 0,
    respawnSeconds: 0,
    frozenSeconds: 0,
    phase: 0,
    rotation: 0
  };
}

export function createGameState(roomId: string, mode: GameMode = "coop"): GameState {
  return {
    roomId,
    hostId: null,
    mode,
    phase: "lobby",
    tick: 0,
    elapsedMs: 0,
    winnerId: null,
    cheats: {},
    players: {},
    shapes: [],
    coins: [],
    hearts: [],
    upgrades: [],
    fish: createFishState(),
    bugs: [],
    danglies: [],
    projectiles: [],
    portals: {},
    reflectors: [],
    bombs: [],
    spawnTimers: {
      // gj: each spawn checks "now - lastSpawn > min + rand(random)" → first spawn after
      // a full min+random window. Seed each timer with that window to match.
      coin: COIN_SPAWN_MIN_SECONDS + Math.random() * COIN_SPAWN_RANDOM_SECONDS,
      heart: HEART_SPAWN_MIN_SECONDS + Math.random() * HEART_SPAWN_RANDOM_SECONDS,
      bug: BUG_SPAWN_SECONDS,
      dangly: DANGLY_SPAWN_SECONDS,
      upgrade: UPGRADE_SPAWN_MIN_SECONDS + Math.random() * UPGRADE_SPAWN_RANDOM_SECONDS
    }
  };
}

export function resetPlayerForMatch(player: PlayerState, offsetIndex: number): PlayerState {
  return {
    ...createPlayerState(player.id, player.name),
    selectedTool: player.selectedTool,
    inventory: [...player.inventory],
    activeUpgrades: { ...player.activeUpgrades },
    x: 60 + offsetIndex * (PLAYER_WIDTH + 18),
    y: 0,
    connected: player.connected,
    kills: player.kills,
    deaths: player.deaths
  };
}

export function resetWorldForMatch(state: GameState): GameState {
  const players = Object.values(state.players);
  const nextPlayers: GameState["players"] = {};
  players.forEach((player, index) => {
    nextPlayers[player.id] = resetPlayerForMatch(player, index);
  });

  return {
    ...createGameState(state.roomId, state.mode),
    hostId: state.hostId,
    phase: "playing",
    cheats: { ...state.cheats },
    players: nextPlayers
  };
}

export function cloneState<T>(value: T): T {
  return structuredClone(value);
}

export function defaultInputTool(player: PlayerState): ToolName {
  return player.selectedTool || player.inventory[0] || TOOL_ORDER[0];
}

export function isPlayerAlive(player: PlayerState): boolean {
  return player.health > 0 && player.respawnSeconds <= 0;
}

export function respawnPlayer(player: PlayerState, index: number) {
  const fresh = resetPlayerForMatch(player, index);
  player.x = fresh.x;
  player.y = fresh.y;
  player.vx = 0;
  player.vy = 0;
  player.onGround = true;
  player.airJumpsUsed = 0;
  player.crouching = false;
  player.health = player.maxHealth;
  player.respawnSeconds = 0;
  player.invulnerableSeconds = PLAYER_INVULNERABLE_SECONDS;
  player.cooldowns = freshCooldowns();
  player.dashSeconds = 0;
  player.swordSeconds = 0;
  player.portalBoostX = 0;
  player.portalTeleportCooldown = 0;
  player.grapple = null;
  player.drawDraft = null;
}

export function livingPlayers(state: GameState): PlayerState[] {
  return Object.values(state.players).filter(isPlayerAlive);
}
