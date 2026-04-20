import { LocalSession, NetworkSession, type Session, type SessionStats } from "./net";
import { toRenderState } from "./render-adapter";
import type { ClientMessage, GameState, InputState } from "../sim/types";
import {
  BUG_HEIGHT,
  BUG_WIDTH,
  DANGLY_HEIGHT,
  DANGLY_WIDTH,
  PLAYER_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_CROUCH_HEIGHT
} from "../sim/constants";

type StateListener = (state: GameState) => void;
type StatusListener = (status: string) => void;

interface SoloOptions {
  name: string;
  mode?: "coop" | "pvp";
  cheats?: Record<string, boolean>;
  onState?: StateListener;
  onStatus?: StatusListener;
}

interface MultiplayerOptions {
  roomId: string;
  name: string;
  host?: string;
  onState?: StateListener;
  onStatus?: StatusListener;
}

export interface LegacySession {
  readonly kind: "local" | "network";
  readonly roomId: string;
  getLocalId(): string;
  getState(): GameState | null;
  getRenderableState(now?: number): GameState;
  getStats(): SessionStats;
  sendInput(input: InputState): void;
  send(message: ClientMessage): void;
  setPaused(paused: boolean): void;
  disconnect(): void;
  setPlayerName?(name: string): void;
}

function wrap(session: Session, onState?: StateListener, onStatus?: StatusListener): LegacySession {
  const unsubState = onState ? session.subscribe(onState) : () => {};
  const unsubStatus = onStatus ? session.onStatus(onStatus) : () => {};
  return {
    kind: session.kind,
    roomId: session.roomId,
    getLocalId() {
      return session.localPlayerId;
    },
    getState() {
      return session.getState();
    },
    getRenderableState(now?: number) {
      return session.getRenderableState(now);
    },
    getStats() {
      return session.getStats();
    },
    sendInput(input: InputState) {
      session.sendInput(input);
    },
    send(message: ClientMessage) {
      session.sendMessage(message);
    },
    setPaused(paused: boolean) {
      session.setPaused?.(paused);
    },
    setPlayerName(name: string) {
      session.sendMessage({ type: "join", name });
    },
    disconnect() {
      unsubState();
      unsubStatus();
      session.dispose();
    }
  };
}

// Shared hitbox dimensions for plain-JS renderers (public/bugs.js, public/danglies.js,
// public/game.js). These are the canonical sizes used by the sim; renderers read
// them from here so there's exactly one source of truth.
const entityDimensions = {
  bugWidth: BUG_WIDTH,
  bugHeight: BUG_HEIGHT,
  danglyWidth: DANGLY_WIDTH,
  danglyHeight: DANGLY_HEIGHT,
  playerWidth: PLAYER_WIDTH,
  playerHeight: PLAYER_HEIGHT,
  playerCrouchHeight: PLAYER_CROUCH_HEIGHT
} as const;

declare global {
  interface Window {
    ShapescapeSession?: {
      startSolo: (options: SoloOptions) => LegacySession;
      startMultiplayer: (options: MultiplayerOptions) => LegacySession;
      toRenderState: typeof toRenderState;
      entityDimensions: typeof entityDimensions;
    };
  }
}

window.ShapescapeSession = {
  startSolo(options: SoloOptions) {
    const session = new LocalSession({
      name: options.name,
      mode: options.mode ?? "coop",
      cheats: options.cheats,
      startImmediately: true
    });
    return wrap(session, options.onState, options.onStatus);
  },
  startMultiplayer(options: MultiplayerOptions) {
    const session = new NetworkSession({
      roomId: options.roomId,
      playerName: options.name,
      host: options.host
    });
    return wrap(session, options.onState, options.onStatus);
  },
  toRenderState,
  entityDimensions
};
