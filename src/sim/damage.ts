// Damage helpers used by projectiles, bombs, sword, and mobs.
// Split out of update.ts so stepProjectiles/stepBombs can live in projectiles.ts
// without tangling tool-action / simulation-orchestration code.
import { FISH_KILL_SCORE, PLAYER_HALF_WIDTH, PLAYER_INVULNERABLE_SECONDS, PLAYER_PVP_RESPAWN_SECONDS, PLAYER_SWORD_CENTER_Y } from "./constants";
import { circleIntersectsRect, playerRect } from "./physics";
import { isPlayerAlive, livingPlayers } from "./state";
import type { GameState, PlayerState } from "./types";

/** Same radius as coin pickup in applyPickups. */
const PVP_DROP_COIN_RADIUS = 8;

function pvpDeathDropClearOfLiving(state: GameState, x: number, y: number): boolean {
  for (const p of livingPlayers(state)) {
    if (circleIntersectsRect({ x, y }, PVP_DROP_COIN_RADIUS, playerRect(p))) return false;
  }
  return true;
}

/** Drop a fraction of the dying player's score as coins other players can pick up. */
function dropCoinsOnPvPDeath(state: GameState, player: PlayerState): void {
  const dropped = Math.floor(player.score * 0.4);
  if (dropped <= 0) return;
  player.score = Math.max(0, player.score - dropped);
  // Break the drop into chunks (1/5/10/15) matching COIN_VALUES so the death
  // pile looks like a normal coin shower rather than one giant coin.
  const denominations = [15, 10, 5, 1] as const;
  const originX = player.x + PLAYER_HALF_WIDTH;
  const originY = player.y + PLAYER_SWORD_CENTER_Y;
  let remaining = dropped;
  let idx = 0;
  while (remaining > 0) {
    const denom = denominations.find((d) => d <= remaining) ?? 1;
    let angle = Math.random() * Math.PI * 2;
    let dist = 6 + Math.random() * 24;
    let cx = originX + Math.cos(angle) * dist;
    let cy = originY + Math.sin(angle) * dist;
    for (let tries = 0; tries < 12 && !pvpDeathDropClearOfLiving(state, cx, cy); tries++) {
      angle = Math.random() * Math.PI * 2;
      dist = 10 + Math.random() * 36;
      cx = originX + Math.cos(angle) * dist;
      cy = originY + Math.sin(angle) * dist;
    }
    state.coins.push({
      id: `drop_${state.tick}_${player.id.slice(-4)}_${idx++}_${Math.floor(Math.random() * 1e4)}`,
      x: cx,
      y: cy,
      value: denom
    });
    remaining -= denom;
  }
}

export function damagePlayer(
  state: GameState,
  player: PlayerState,
  amount: number,
  sourceId?: string
): void {
  if (!isPlayerAlive(player) || player.invulnerableSeconds > 0) return;
  if (player.activeUpgrades.armor) amount = Math.ceil(amount * 0.6);
  player.health = Math.max(0, player.health - amount);
  player.invulnerableSeconds = PLAYER_INVULNERABLE_SECONDS;
  player.damageFlashSeconds = 0.15;
  if (player.health <= 0) {
    player.deaths += 1;
    player.respawnSeconds = state.mode === "pvp" ? PLAYER_PVP_RESPAWN_SECONDS : 0;
    player.vx = 0;
    player.vy = 0;
    player.grapple = null;
    if (sourceId && sourceId !== player.id && state.players[sourceId]) {
      state.players[sourceId].kills += 1;
      state.players[sourceId].score += 25;
    }
    if (state.mode === "pvp") {
      dropCoinsOnPvPDeath(state, player);
    }
  }
}

export function damageFish(state: GameState, amount: number, sourceId?: string): void {
  if (!state.fish.spawned) return;
  state.fish.hp = Math.max(0, state.fish.hp - amount);
  if (state.fish.hp <= 0 && sourceId && state.players[sourceId]) {
    state.players[sourceId].score += FISH_KILL_SCORE;
  }
}

export function damageMob(
  state: GameState,
  mobId: string,
  kind: "bug" | "dangly",
  amount: number,
  sourceId?: string
): void {
  const list = kind === "bug" ? state.bugs : state.danglies;
  const target = list.find((entity) => entity.id === mobId);
  if (!target) return;
  target.hp -= amount;
  if (target.hp <= 0 && sourceId && state.players[sourceId]) {
    state.players[sourceId].score += kind === "bug" ? 10 : 15;
  }
}
