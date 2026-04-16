import type * as Party from "partykit/server";
import { createGameState } from "../src/sim/state";
import { addPlayerToState, applyClientMessage, emptyInput, removePlayerFromState, sanitizeName, snapshotState, stepGame, TICK_MS } from "../src/sim/update";
import type { ClientMessage, FrameInputState, GameState, InputState, ServerMessage } from "../src/sim/types";

function safeParseMessage(raw: string | ArrayBuffer): ClientMessage | null {
  try {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    return JSON.parse(text) as ClientMessage;
  } catch {
    return null;
  }
}

function cloneInput(input?: InputState): InputState {
  return input ? { ...input } : emptyInput();
}

export default class Server implements Party.Server {
  readonly options = { hibernate: false };

  private state: GameState;
  private readonly inputs = new Map<string, InputState>();
  private readonly previousInputs = new Map<string, InputState>();
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {
    this.state = createGameState(room.id);
  }

  onStart() {
    this.ensureLoop();
  }

  onConnect(connection: Party.Connection) {
    addPlayerToState(this.state, connection.id, "Player");
    connection.setState({ name: "Player" });
    this.inputs.set(connection.id, emptyInput());
    this.previousInputs.set(connection.id, emptyInput());
    this.ensureLoop();
    this.sendTo(connection, {
      type: "welcome",
      playerId: connection.id,
      hostId: this.state.hostId,
      roomId: this.room.id,
      state: snapshotState(this.state)
    });
    this.broadcastState();
  }

  onMessage(message: string | ArrayBuffer, sender: Party.Connection) {
    const parsed = safeParseMessage(message);
    if (!parsed) return;

    if (parsed.type === "join") {
      const safeName = sanitizeName(parsed.name);
      addPlayerToState(this.state, sender.id, safeName);
      sender.setState({ name: safeName });
      this.broadcastState();
      return;
    }

    if (parsed.type === "input") {
      this.inputs.set(sender.id, cloneInput(parsed.input));
      return;
    }

    if (parsed.type === "ping") {
      this.sendTo(sender, { type: "pong", id: parsed.id });
      return;
    }

    applyClientMessage(this.state, sender.id, parsed);
    // Live draft updates are cosmetic and arrive at up to ~16 Hz per client;
    // piggybacking on the next tick-broadcast (≤50ms later) saves a ton of
    // per-message fan-out work without making the preview feel laggy.
    if (parsed.type !== "drawUpdate") {
      this.broadcastState();
    }
  }

  onClose(connection: Party.Connection) {
    removePlayerFromState(this.state, connection.id);
    this.inputs.delete(connection.id);
    this.previousInputs.delete(connection.id);
    this.broadcastState();
  }

  onRequest() {
    return new Response(JSON.stringify({
      roomId: this.room.id,
      hostId: this.state.hostId,
      phase: this.state.phase,
      players: Object.values(this.state.players).map((player) => ({
        id: player.id,
        name: player.name,
        connected: player.connected
      }))
    }), {
      headers: {
        "content-type": "application/json"
      }
    });
  }

  private ensureLoop() {
    if (this.interval) return;
    this.interval = setInterval(() => {
      this.tick();
    }, TICK_MS);
  }

  private tick() {
    const frameInputs: Record<string, FrameInputState> = {};
    for (const playerId of Object.keys(this.state.players)) {
      const current = cloneInput(this.inputs.get(playerId));
      const previous = cloneInput(this.previousInputs.get(playerId));
      frameInputs[playerId] = {
        ...current,
        jumpPressed: current.jump && !previous.jump
      };
      this.previousInputs.set(playerId, current);
    }

    stepGame(this.state, frameInputs);
    this.broadcastState();
  }

  private broadcastState() {
    const message: ServerMessage = {
      type: "state",
      state: snapshotState(this.state)
    };
    this.room.broadcast(JSON.stringify(message));
  }

  private sendTo(connection: Party.Connection, message: ServerMessage) {
    connection.send(JSON.stringify(message));
  }
}
