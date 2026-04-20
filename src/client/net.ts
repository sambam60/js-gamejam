import PartySocket from "partysocket";
import { SERVER_DT } from "../sim/constants";
import { createGameState, cloneState } from "../sim/state";
import { addPlayerToState, applyClientMessage, emptyInput, sanitizeName, snapshotState, stepGame, TICK_MS } from "../sim/update";
import type { ClientMessage, FrameInputState, GameState, InputState, PlayerState, ServerMessage } from "../sim/types";

declare const __PARTYKIT_HOST__: string;
declare const __PARTYKIT_PARTY__: string;

type Listener = (state: GameState) => void;
type StatusListener = (status: string) => void;

function createClientId(): string {
  return `client_${Math.random().toString(36).slice(2, 10)}`;
}

function lerp(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

function interpolatePlayer(target: PlayerState, previous: PlayerState, current: PlayerState, alpha: number) {
  target.x = lerp(previous.x, current.x, alpha);
  target.y = lerp(previous.y, current.y, alpha);
  target.vx = lerp(previous.vx, current.vx, alpha);
  target.vy = lerp(previous.vy, current.vy, alpha);
}

// Interpolate between two authoritative snapshots `a` → `b` by `alpha` in [0,1].
// Only kinematic fields (positions / velocities) are blended — everything else
// is taken from `b` so HP, timers, etc. stay on the latest authoritative value.
function interpolateBetween(a: GameState, b: GameState, alpha: number): GameState {
  const result = cloneState(b);

  for (const [playerId, player] of Object.entries(result.players)) {
    const prev = a.players[playerId];
    const curr = b.players[playerId];
    if (prev && curr) interpolatePlayer(player, prev, curr, alpha);
  }

  for (const bug of result.bugs) {
    const prev = a.bugs.find((candidate) => candidate.id === bug.id);
    if (prev) {
      bug.x = lerp(prev.x, bug.x, alpha);
      bug.y = lerp(prev.y, bug.y, alpha);
    }
  }

  for (const dangly of result.danglies) {
    const prev = a.danglies.find((candidate) => candidate.id === dangly.id);
    if (prev) {
      dangly.x = lerp(prev.x, dangly.x, alpha);
      dangly.y = lerp(prev.y, dangly.y, alpha);
    }
  }

  for (const projectile of result.projectiles) {
    const prev = a.projectiles.find((candidate) => candidate.id === projectile.id);
    if (prev) {
      projectile.x = lerp(prev.x, projectile.x, alpha);
      projectile.y = lerp(prev.y, projectile.y, alpha);
    }
  }

  result.fish.x = lerp(a.fish.x, b.fish.x, alpha);
  result.fish.y = lerp(a.fish.y, b.fish.y, alpha);
  return result;
}

export interface SessionStats {
  /** Round-trip latency in ms, or -1 if no sample yet. */
  pingMs: number;
  /** Rate of authoritative state snapshots received from the server (Hz). 0 for local sessions. */
  snapshotHz: number;
  /** Milliseconds since the last authoritative snapshot. 0 for local sessions. */
  snapshotAgeMs: number;
  /** Number of players currently in the room (including disconnected lobby members). */
  playerCount: number;
  /** Number of players currently marked connected. */
  connectedCount: number;
}

export interface Session {
  readonly kind: "local" | "network";
  readonly roomId: string;
  readonly localPlayerId: string;
  getState(): GameState;
  getRenderableState(now?: number): GameState;
  getStats(): SessionStats;
  subscribe(listener: Listener): () => void;
  onStatus(listener: StatusListener): () => void;
  sendInput(input: InputState): void;
  sendMessage(message: ClientMessage): void;
  setPaused?(paused: boolean): void;
  dispose(): void;
}

function countConnectedPlayers(state: GameState): number {
  let n = 0;
  for (const id in state.players) if (state.players[id].connected) n += 1;
  return n;
}

abstract class BaseSession implements Session {
  protected readonly listeners = new Set<Listener>();
  protected readonly statusListeners = new Set<StatusListener>();
  protected previousState: GameState | null = null;
  protected currentState: GameState;
  protected currentStateAt = performance.now();
  protected status = "idle";
  localPlayerId = "";
  readonly roomId: string;
  readonly kind: "local" | "network";

  protected constructor(kind: "local" | "network", roomId: string, initialState: GameState) {
    this.kind = kind;
    this.roomId = roomId;
    this.currentState = initialState;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // Deferred so the caller has finished wiring up (e.g. the `handle` in legacy-bridge
    // isn't assigned until after createSession returns). Callers that want the state
    // synchronously can still use getState().
    queueMicrotask(() => {
      if (this.listeners.has(listener)) listener(this.currentState);
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    queueMicrotask(() => {
      if (this.statusListeners.has(listener)) listener(this.status);
    });
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  protected setStatus(status: string) {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  protected pushState(next: GameState) {
    this.previousState = this.currentState;
    this.currentState = next;
    this.currentStateAt = performance.now();
    for (const listener of this.listeners) listener(next);
  }

  getState(): GameState {
    return this.currentState;
  }

  getRenderableState(_now = performance.now()): GameState {
    return this.currentState;
  }

  getStats(): SessionStats {
    const playerCount = Object.keys(this.currentState.players).length;
    return {
      pingMs: -1,
      snapshotHz: 0,
      snapshotAgeMs: 0,
      playerCount,
      connectedCount: countConnectedPlayers(this.currentState)
    };
  }

  abstract sendInput(input: InputState): void;
  abstract sendMessage(message: ClientMessage): void;
  abstract dispose(): void;
}

const MAX_DT = 0.05;

export class LocalSession extends BaseSession {
  private readonly liveState: GameState;
  private currentInput = emptyInput();
  private previousInput = emptyInput();
  private rafId = 0;
  private lastNow = 0;
  private disposed = false;
  private paused = false;

  constructor(options: {
    name: string;
    mode: GameState["mode"];
    cheats?: Record<string, boolean>;
    startImmediately?: boolean;
  }) {
    const roomId = "solo";
    const state = createGameState(roomId, options.mode);
    super("local", roomId, snapshotState(state));
    this.liveState = state;
    this.localPlayerId = createClientId();
    addPlayerToState(this.liveState, this.localPlayerId, sanitizeName(options.name));
    this.liveState.hostId = this.localPlayerId;
    if (options.startImmediately !== false) {
      applyClientMessage(this.liveState, this.localPlayerId, {
        type: "startGame",
        cheats: options.cheats || {}
      });
    }
    this.pushState(snapshotState(this.liveState));
    this.setStatus("solo");
    this.lastNow = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  sendInput(input: InputState): void {
    this.currentInput = { ...input };
  }

  sendMessage(message: ClientMessage): void {
    applyClientMessage(this.liveState, this.localPlayerId, message);
    this.pushState(snapshotState(this.liveState));
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.lastNow = performance.now();
  }

  private readonly frame = (now: number) => {
    if (this.disposed) return;
    if (this.paused) {
      this.lastNow = now;
      this.rafId = requestAnimationFrame(this.frame);
      return;
    }
    const dt = Math.min(MAX_DT, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;

    const frameInput: FrameInputState = {
      ...this.currentInput,
      jumpPressed: this.currentInput.jump && !this.previousInput.jump
    };
    stepGame(this.liveState, { [this.localPlayerId]: frameInput }, dt);
    this.previousInput = { ...this.currentInput };
    this.currentState = this.liveState;
    this.currentStateAt = now;
    for (const listener of this.listeners) listener(this.currentState);

    this.rafId = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }
}

/** How often (ms) the client sends a ping to the server. */
const PING_INTERVAL_MS = 1000;
/** Window (ms) for computing received-snapshot rate. */
const SNAPSHOT_WINDOW_MS = 2000;
/**
 * How far behind the freshest snapshot we render. Two server ticks of headroom
 * means every render frame has two *already-received* snapshots to interpolate
 * between, even when packets arrive unevenly. Trades a bit of input→display
 * latency for smooth motion — the standard snapshot-interpolation tradeoff.
 */
const RENDER_DELAY_MS = TICK_MS * 2;
/** Drop buffered snapshots older than this relative to the newest one. */
const BUFFER_MAX_AGE_MS = 2000;

interface BufferedSnapshot {
  state: GameState;
  receivedAt: number;
}

export class NetworkSession extends BaseSession {
  private readonly socket: PartySocket;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private nextPingId = 1;
  private readonly pendingPings = new Map<number, number>();
  // EMA of RTT so the number is readable; negative means "no sample yet".
  private smoothedPingMs = -1;
  private readonly snapshotTimestamps: number[] = [];
  private readonly snapshotBuffer: BufferedSnapshot[] = [];

  constructor(options: { roomId: string; playerName: string; host?: string; clientId?: string }) {
    super("network", options.roomId, createGameState(options.roomId));
    this.localPlayerId = options.clientId ?? createClientId();

    const host = resolvePartyKitHost(options.host);
    this.socket = new PartySocket({
      host,
      room: options.roomId,
      id: this.localPlayerId,
      party: __PARTYKIT_PARTY__ || "main"
    });

    this.setStatus(`connecting:${host}`);

    this.socket.addEventListener("open", () => {
      this.setStatus(`connected:${host}`);
      this.sendMessage({ type: "join", name: sanitizeName(options.playerName) });
      this.startPingLoop();
    });

    this.socket.addEventListener("close", () => {
      this.setStatus("closed");
      this.stopPingLoop();
    });

    this.socket.addEventListener("error", () => {
      this.setStatus("error");
    });

    this.socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as ServerMessage;
        if (payload.type === "welcome") {
          this.localPlayerId = payload.playerId;
          this.ingestSnapshot(payload.state);
          return;
        }
        if (payload.type === "state") {
          this.ingestSnapshot(payload.state);
          return;
        }
        if (payload.type === "pong") {
          this.handlePong(payload.id);
          return;
        }
      } catch {
        this.setStatus("error:bad-message");
      }
    });
  }

  /**
   * Snapshot-buffered, render-delayed interpolation. We pick a `targetTime`
   * `RENDER_DELAY_MS` behind the newest buffered snapshot, then interpolate
   * between the two buffered snapshots that straddle it. Because both
   * endpoints already exist when we render, jitter in packet arrival no longer
   * shows up as freezes or jump-cuts on screen.
   */
  getRenderableState(now = performance.now()): GameState {
    const buf = this.snapshotBuffer;
    if (buf.length === 0) return cloneState(this.currentState);
    if (buf.length === 1) return cloneState(buf[0].state);

    const newest = buf[buf.length - 1];
    const targetTime = now - RENDER_DELAY_MS;

    if (targetTime <= buf[0].receivedAt) return cloneState(buf[0].state);

    for (let i = buf.length - 1; i >= 1; i--) {
      const a = buf[i - 1];
      const b = buf[i];
      if (a.receivedAt <= targetTime && targetTime <= b.receivedAt) {
        const span = b.receivedAt - a.receivedAt;
        const alpha = span > 0 ? (targetTime - a.receivedAt) / span : 1;
        return interpolateBetween(a.state, b.state, alpha);
      }
    }

    // targetTime is past the newest snapshot (packet starvation). Holding on
    // the latest known state beats extrapolating into unknown territory.
    return cloneState(newest.state);
  }

  private ingestSnapshot(state: GameState) {
    const now = performance.now();
    this.recordSnapshot();
    this.snapshotBuffer.push({ state, receivedAt: now });
    const cutoff = now - BUFFER_MAX_AGE_MS;
    while (this.snapshotBuffer.length > 2 && this.snapshotBuffer[0].receivedAt < cutoff) {
      this.snapshotBuffer.shift();
    }
    this.pushState(state);
  }

  sendInput(input: InputState): void {
    this.socket.send(JSON.stringify({ type: "input", input }));
  }

  sendMessage(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  dispose(): void {
    this.stopPingLoop();
    this.socket.close();
  }

  getStats(): SessionStats {
    const now = performance.now();
    const windowStart = now - SNAPSHOT_WINDOW_MS;
    while (this.snapshotTimestamps.length && this.snapshotTimestamps[0] < windowStart) {
      this.snapshotTimestamps.shift();
    }
    const windowSeconds = SNAPSHOT_WINDOW_MS / 1000;
    const snapshotHz = this.snapshotTimestamps.length / windowSeconds;
    const lastSnapshotAt = this.snapshotTimestamps.length
      ? this.snapshotTimestamps[this.snapshotTimestamps.length - 1]
      : this.currentStateAt;
    const playerCount = Object.keys(this.currentState.players).length;
    return {
      pingMs: this.smoothedPingMs,
      snapshotHz,
      snapshotAgeMs: Math.max(0, now - lastSnapshotAt),
      playerCount,
      connectedCount: countConnectedPlayers(this.currentState)
    };
  }

  private recordSnapshot() {
    this.snapshotTimestamps.push(performance.now());
  }

  private startPingLoop() {
    this.stopPingLoop();
    const sendPing = () => {
      const id = this.nextPingId++;
      this.pendingPings.set(id, performance.now());
      // Cap pending pings so memory doesn't grow if the socket drops.
      if (this.pendingPings.size > 16) {
        const oldestKey = this.pendingPings.keys().next().value;
        if (oldestKey !== undefined) this.pendingPings.delete(oldestKey);
      }
      try {
        this.socket.send(JSON.stringify({ type: "ping", id }));
      } catch {
        // Socket not ready; ignore — will retry next tick.
      }
    };
    sendPing();
    this.pingTimer = setInterval(sendPing, PING_INTERVAL_MS);
  }

  private stopPingLoop() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.pendingPings.clear();
  }

  private handlePong(id: number) {
    const sentAt = this.pendingPings.get(id);
    if (sentAt === undefined) return;
    this.pendingPings.delete(id);
    const rtt = performance.now() - sentAt;
    // Simple EMA to avoid jitter making the HUD flicker.
    this.smoothedPingMs = this.smoothedPingMs < 0 ? rtt : this.smoothedPingMs * 0.7 + rtt * 0.3;
  }
}

export function resolvePartyKitHost(override = ""): string {
  if (override.trim()) return override.trim();
  if (__PARTYKIT_HOST__) return __PARTYKIT_HOST__;
  return window.location.host;
}

export { SERVER_DT };
