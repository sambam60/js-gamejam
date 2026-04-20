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

  async onRequest(req: Party.Request) {
    const url = new URL(req.url);
    // Same-origin proxy for dreamlo (no CORS from browser). PartyKit only hits
    // `onRequest` for URLs that match a party/room (e.g.
    // `/parties/main/dreamlo`), so the leaderboard client is routed to the
    // "dreamlo" room on partykit deployments. We also match `/api/dreamlo` in
    // case a custom host routes that path through partykit.
    if (
      this.room.id === "dreamlo" ||
      url.pathname.endsWith("/api/dreamlo") ||
      url.pathname === "/api/dreamlo"
    ) {
      return handleDreamloProxy(req, url);
    }
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
    // The "dreamlo" room only exists to serve HTTP proxy requests — no
    // players ever connect, so don't burn a 50ms interval on it.
    if (this.room.id === "dreamlo") return;
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

function isValidDreamloPath(path: string): boolean {
  if (!path || path.length > 600 || path.includes("..")) return false;
  const segs = path.split("/");
  if (segs.length < 2) return false;
  const key = segs[0];
  if (!/^[a-zA-Z0-9_-]+$/.test(key) || key.length < 8) return false;
  const rest = segs.slice(1).join("/");
  if (rest === "pipe") return true;
  if (rest.startsWith("add/")) {
    return /^add\/[^/]+\/[0-9]+(?:\/[0-9]+)?$/.test(rest);
  }
  return false;
}

async function handleDreamloProxy(req: Party.Request, url: URL): Promise<Response> {
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...corsHeaders, Allow: "GET, OPTIONS" }
    });
  }
  const path = (url.searchParams.get("path") || "").trim();
  if (!isValidDreamloPath(path)) {
    return new Response("Invalid path", { status: 400, headers: corsHeaders });
  }
  // Dreamlo's free tier returns "SSL not enabled for this leaderboard" on
  // https://, so we hit the http:// endpoint first. Cloudflare Workers'
  // server-side fetch has no problem with cleartext, and the mixed-content
  // block that applies to the browser doesn't affect server-to-server
  // requests — the browser only sees our same-origin https proxy response.
  // We keep https as a fallback in case the user later upgrades.
  const targets = [
    "http://dreamlo.com/lb/" + path,
    "https://dreamlo.com/lb/" + path
  ];
  const errors: string[] = [];
  for (const target of targets) {
    try {
      // NB: Cloudflare Workers (PartyKit runtime) rejects the `cache` init
      // option with a runtime error, so we control caching via headers only.
      const upstream = await fetch(target, {
        headers: {
          Accept: "text/plain,*/*",
          "Cache-Control": "no-cache",
          "User-Agent": "shapescape-partykit-proxy/1.0"
        }
      });
      const text = await upstream.text();
      const contentType = upstream.headers.get("content-type") || "text/plain";
      return new Response(text, {
        status: upstream.status,
        headers: { ...corsHeaders, "Content-Type": contentType }
      });
    } catch (err) {
      errors.push(`${target}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return new Response("Bad gateway\n" + errors.join("\n"), {
    status: 502,
    headers: corsHeaders
  });
}
