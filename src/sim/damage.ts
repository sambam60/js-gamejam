// Damage helpers used by projectiles, bombs, sword, and mobs.
// Split out of update.ts so stepProjectiles/stepBombs can live in projectiles.ts
// without tangling tool-action / simulation-orchestration code.
import { FISH_KILL_SCORE, PLAYER_INVULNERABLE_SECONDS, PLAYER_PVP_RESPAWN_SECONDS } from "./constants";
import { isPlayerAlive } from "./state";
import type { GameState, PlayerState } from "./types";

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
