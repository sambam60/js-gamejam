import type { TOOL_ORDER } from "./constants";

export type ToolName = (typeof TOOL_ORDER)[number];
export type GameMode = "coop" | "pvp";
export type GamePhase = "menu" | "lobby" | "playing" | "gameover";
export type Facing = "left" | "right";
export type ShapeKind = "rect" | "circle" | "triangle" | "line" | "polygon" | "bezier";
export type EntityKind = "bug" | "dangly" | "fish" | "player";
export type FishProjectileVariant = "red" | "blue" | "yellow";
export type ProjectileKind =
  | "fishRed"
  | "fishBlue"
  | "fishYellow"
  | "freeze"
  | "laser"
  | "bomb";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SegmentedShape extends Rect {
  id: string;
  ownerId: string;
  shape: ShapeKind;
  createdAtTick: number;
  segments: Rect[];
  cx?: number;
  cy?: number;
  r?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  v1?: Vec2;
  v2?: Vec2;
  v3?: Vec2;
  vertices?: Vec2[];
  p0?: Vec2;
  p1?: Vec2;
  p2?: Vec2;
}

export interface GrappleState {
  tx: number;
  ty: number;
  shapeId: string;
}

/** All cooldown values are in seconds. */
export interface Cooldowns {
  dash: number;
  sword: number;
  grapple: number;
  reflector: number;
  bomb: number;
  freeze: number;
  laser: number;
  portal: number;
}

export interface UpgradeState {
  doubleJump?: boolean;
  sprint?: boolean;
  wallClimb?: boolean;
  glide?: boolean;
  coinMagnet?: boolean;
  dash?: boolean;
  armor?: boolean;
  regen?: boolean;
  reinforce?: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  touchingWall: number;
  airJumpsUsed: number;
  direction: Facing;
  crouching: boolean;
  health: number;
  maxHealth: number;
  score: number;
  selectedTool: ToolName;
  inventory: ToolName[];
  activeUpgrades: UpgradeState;
  cooldowns: Cooldowns;
  dashSeconds: number;
  swordSeconds: number;
  damageFlashSeconds: number;
  invulnerableSeconds: number;
  respawnSeconds: number;
  regenAccum: number;
  portalBoostX: number;
  portalTeleportCooldown: number;
  grapple: GrappleState | null;
  kills: number;
  deaths: number;
  /**
   * In-progress shape draft the player is composing (drag preview, polygon
   * points so far, bezier control points). Cleared on the tick a `draw` is
   * committed, on tool switch, and on death/respawn. Broadcast via the normal
   * state snapshot so other players can see what's being drawn before it's
   * placed.
   */
  drawDraft: DrawShapeDraft | null;
}

export interface FishState {
  spawned: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  hp: number;
  maxHp: number;
  shootCooldown: number;
  /** Countdown (seconds) for the bulge/glow pulse visual that fires on each shot. Drives only rendering. */
  shootPulseSeconds: number;
  touchCooldown: number;
  respawnSeconds: number;
  frozenSeconds: number;
  phase: number;
  rotation: number;
}

export interface ProjectileState {
  id: string;
  ownerId: string;
  ownerKind: EntityKind;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  lifetime: number;
  reflected: boolean;
}

export interface BugState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  hp: number;
  maxHp: number;
  state: number;
  stateTimer: number;
  direction: -1 | 1;
  damageCooldown: number;
  phase: number;
  jumpCooldown: number;
  hurtTimer: number;
  frozen: number;
  attackCooldown: number;
}

export interface DanglyState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  hp: number;
  maxHp: number;
  state: number;
  stateTimer: number;
  direction: -1 | 1;
  damageCooldown: number;
  phase: number;
  hurtTimer: number;
  jumpCooldown: number;
  chargeProgress: number;
  armExtend: number;
  attackPulse: number;
  armDirX: number;
  armDirY: number;
  attackCooldown: number;
  chargeTicks: number;
  frozen: number;
}

export interface CoinState {
  id: string;
  x: number;
  y: number;
  value: number;
}

export interface HeartState {
  id: string;
  x: number;
  y: number;
  value: number;
}

export interface UpgradePickupState {
  id: string;
  x: number;
  y: number;
  key: string;
  cost: number;
}

export interface PortalState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  slot?: number;
}

export interface ReflectorState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  angle: number;
  radius: number;
  ttl: number;
}

export interface BombState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  fuse: number;
  explosionSeconds: number;
}

export interface SpawnTimers {
  coin: number;
  heart: number;
  bug: number;
  dangly: number;
  upgrade: number;
  revive: number;
}

export interface RevivePickupState {
  id: string;
  x: number;
  y: number;
}

export interface GameState {
  roomId: string;
  hostId: string | null;
  mode: GameMode;
  phase: GamePhase;
  tick: number;
  elapsedMs: number;
  winnerId: string | null;
  cheats: Record<string, boolean>;
  players: Record<string, PlayerState>;
  shapes: SegmentedShape[];
  coins: CoinState[];
  hearts: HeartState[];
  upgrades: UpgradePickupState[];
  fish: FishState;
  bugs: BugState[];
  danglies: DanglyState[];
  projectiles: ProjectileState[];
  portals: Record<string, PortalState[]>;
  reflectors: ReflectorState[];
  bombs: BombState[];
  revives: RevivePickupState[];
  spawnTimers: SpawnTimers;
}

export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  dash: boolean;
}

export interface FrameInputState extends InputState {
  jumpPressed: boolean;
}

export interface DrawShapeDraft {
  tool: ShapeKind | "square";
  start?: Vec2;
  end?: Vec2;
  points?: Vec2[];
  /**
   * Live cursor position for tools that don't have a `start`/`end` pair yet
   * (polygon / bezier). Used only for the in-progress preview rendered for
   * other players — never consumed by `createShapeFromDraft`.
   */
  cursor?: Vec2;
}

export interface JoinMessage {
  type: "join";
  name: string;
}

export interface InputMessage {
  type: "input";
  input: InputState;
}

export interface DrawMessage {
  type: "draw";
  draft: DrawShapeDraft;
}

/**
 * Sent while the player is composing a shape but hasn't committed it yet.
 * The server stores the draft on the player's state and rebroadcasts it so
 * peers can see the live preview. A `null` draft clears the stored preview
 * (e.g. the player cancelled out of polygon mode).
 */
export interface DrawUpdateMessage {
  type: "drawUpdate";
  draft: DrawShapeDraft | null;
}

export interface EraseMessage {
  type: "erase";
  point: Vec2;
}

export interface ToolMessage {
  type: "tool";
  action: "portal" | "sword" | "grapple" | "reflector" | "bomb" | "freeze" | "laser";
  target?: Vec2;
}

export interface SetModeMessage {
  type: "setMode";
  mode: GameMode;
}

export interface StartGameMessage {
  type: "startGame";
  cheats?: Record<string, boolean>;
}

export interface SelectToolMessage {
  type: "selectTool";
  tool: ToolName;
}

export interface PingMessage {
  type: "ping";
  id: number;
}

export type ClientMessage =
  | JoinMessage
  | InputMessage
  | DrawMessage
  | DrawUpdateMessage
  | EraseMessage
  | ToolMessage
  | SetModeMessage
  | StartGameMessage
  | SelectToolMessage
  | PingMessage;

export interface SnapshotMessage {
  type: "state";
  state: GameState;
}

export interface ServerEventMessage {
  type: "event";
  event: "joined" | "left" | "started" | "gameover";
  playerId?: string;
  roomId?: string;
  hostId?: string | null;
}

export interface WelcomeMessage {
  type: "welcome";
  playerId: string;
  hostId: string | null;
  roomId: string;
  state: GameState;
}

export interface PongMessage {
  type: "pong";
  id: number;
}

export type ServerMessage = SnapshotMessage | ServerEventMessage | WelcomeMessage | PongMessage;
