// Ported from public/game.js. Values are in per-second form; per-frame originals
// from game.js (assumed 60 FPS) are noted in comments as "gj:X/f" where relevant.
// Rule of thumb: velocity/frame * 60 = units/sec. acceleration/frame^2 * 3600 = units/sec^2.
// Countdown in frames / 60 = seconds.

export const WORLD_FLOOR_Y = 0;

// ---------------------------------------------------------------------------
// Player (game.js L121-L130 + dash/glide/grapple inline values)
// ---------------------------------------------------------------------------
export const PLAYER_WIDTH = 32;               // gj CHAR_W
export const PLAYER_HEIGHT = 32;              // gj CHAR_H
export const PLAYER_CROUCH_HEIGHT = 20;       // gj CHAR_H_CROUCH
export const PLAYER_MAX_HEALTH = 100;
/** Aim/cursor origin offset from (player.x, player.y) — player center on both axes. */
export const PLAYER_HALF_WIDTH = PLAYER_WIDTH / 2;
export const PLAYER_HALF_HEIGHT = PLAYER_HEIGHT / 2;
/** Sword swing center Y offset from player.y. gj uses player.y + 16 = player.y + HALF_HEIGHT. */
export const PLAYER_SWORD_CENTER_Y = PLAYER_HALF_HEIGHT;

export const PLAYER_MOVE_SPEED = 120;         // gj MOVE_SPEED=2/f
export const PLAYER_SPRINT_SPEED = 216;       // gj SPRINT_SPEED=3.6/f
export const PLAYER_CROUCH_MULT = 0.6;        // gj CROUCH_SPEED_MULT
export const PLAYER_DASH_SPEED = 480;         // gj dash speed=8/f
export const PLAYER_DASH_SECONDS = 8 / 60;    // gj state.dashActive=8 frames
export const PLAYER_JUMP_VELOCITY = 360;      // gj JUMP_VEL=-6/f (sign flipped: TS uses Y-up)
export const PLAYER_GLIDE_FALL_SPEED = -60;   // gj glide vy cap=1.0/f (sign flipped)
export const PLAYER_GRAVITY = -1080;          // gj GRAVITY=0.3/f^2 (sign flipped)
export const PLAYER_TERMINAL_VELOCITY = -900; // sim-only cap; game.js has none

// Grapple (game.js L1611, L2184-L2220)
export const PLAYER_GRAPPLE_RANGE = 400;      // gj GRAPPLE_MAX_RANGE
export const GRAPPLE_COOLDOWN_SECONDS = 90 / 60; // gj grappleCooldown=90 frames (1.5s)
export const GRAPPLE_PULL_BASE = 90;          // gj 1.5/f baseline pull
export const GRAPPLE_PULL_MAX = 270;          // gj min(4.5/f) cap
export const GRAPPLE_PULL_DIST_COEF = 0.6;    // gj 0.01/f per pixel (*60 = 0.6/s per pixel)
export const GRAPPLE_VY_BLEND = 0.7;          // gj vy = vy*0.3 + target*0.7 per-frame
export const GRAPPLE_RELEASE_VY = 120;        // gj min(vy, -2)/f on close release (sim Y-up: upward kick = +120)
export const GRAPPLE_RELEASE_DIST = 12;       // gj close-enough to target
/** Legacy alias — kept so existing TS sites still compile while Phase 1b ports physics. */
export const PLAYER_GRAPPLE_STRENGTH = 180;

// Invulnerability / damage flash (game.js: no i-frames in solo; damageFlash=12/f)
export const DAMAGE_FLASH_SECONDS = 0.2;      // gj state.damageFlash=12 frames
export const PLAYER_INVULNERABLE_SECONDS = 0.9; // PvP-only (sim-authored)
export const PLAYER_RESPAWN_SECONDS = 3;        // co-op respawn (sim-authored)
export const PLAYER_PVP_RESPAWN_SECONDS = 10;   // PvP respawn (sim-authored)
export const ARMOR_DAMAGE_MULT = 0.6;         // gj applyDamage(): amount * 0.6 when armor

// ---------------------------------------------------------------------------
// Engine tick
// ---------------------------------------------------------------------------
export const SERVER_TICK_MS = 50;
export const SERVER_DT = SERVER_TICK_MS / 1000;

// ---------------------------------------------------------------------------
// Pickups (game.js L2291-L2325): spawn uses min + random window, movement-gated
// ---------------------------------------------------------------------------
export const COIN_SPAWN_MIN_SECONDS = 8;      // gj 8000ms base
export const COIN_SPAWN_RANDOM_SECONDS = 7;   // gj + random*7000ms
export const HEART_SPAWN_MIN_SECONDS = 20;    // gj 20000ms base
export const HEART_SPAWN_RANDOM_SECONDS = 15; // gj + random*15000ms
export const UPGRADE_SPAWN_MIN_SECONDS = 30;  // gj 30000ms base
export const UPGRADE_SPAWN_RANDOM_SECONDS = 25; // gj + random*25000ms
// Horizontal spread (±half) of each spawn around the player anchor. gj-matched.
export const COIN_SPAWN_SPREAD = 600;
export const HEART_SPAWN_SPREAD = 500;
export const UPGRADE_SPAWN_SPREAD = 700;
export const BUG_SPAWN_SPREAD = 520;
export const DANGLY_SPAWN_SPREAD = 620;
/** Legacy non-randomized defaults used by current sim until Phase 1e ports spawn logic. */
export const COIN_SPAWN_SECONDS = COIN_SPAWN_MIN_SECONDS;
export const HEART_SPAWN_SECONDS = HEART_SPAWN_MIN_SECONDS;
export const UPGRADE_SPAWN_SECONDS = UPGRADE_SPAWN_MIN_SECONDS;

export const COIN_MAGNET_RANGE = 120;         // gj magnetRange
export const COIN_MAGNET_PULL = 90;           // gj 1.5/f

export const REGEN_INTERVAL_SECONDS = 3;      // gj 180 frames
export const REGEN_AMOUNT = 1;

export const PICKUP_HITBOX = 16;              // gj 16x16 centered overlap test

// ---------------------------------------------------------------------------
// Bugs (public/bugs.js)
// ---------------------------------------------------------------------------
export const BUG_WIDTH = 14;                  // gj BUG_W
export const BUG_HEIGHT = 12;                 // gj BUG_H
export const BUG_GRAVITY = 900;               // gj BUG_GRAVITY=0.25/f^2
export const BUG_MOVE_SPEED = 48;             // gj BUG_MOVE_SPEED=0.8/f
export const BUG_CHASE_SPEED = 84;            // gj BUG_CHASE_SPEED=1.4/f
export const BUG_JUMP_VELOCITY = 300;         // gj BUG_JUMP_VEL=5/f
export const BUG_DAMAGE = 6;                  // gj BUG_DAMAGE
export const BUG_ATTACK_COOLDOWN_SECONDS = 80 / 60; // gj BUG_DAMAGE_COOLDOWN=80 frames
export const BUG_DETECT_RANGE = 180;          // gj BUG_DETECT_RANGE
export const BUG_ATTACK_RANGE = 28;           // gj BUG_ATTACK_RANGE
export const BUG_BASE_HP = 18;                // gj createBug.hp
export const BUG_SPAWN_SECONDS = 16;          // gj BUG_SPAWN_INTERVAL=16000ms
export const BUG_KILL_SCORE = 10;             // gj sword bugKills * 10
export const MAX_BUGS = 8;                    // gj BUG_MAX_ALIVE

// ---------------------------------------------------------------------------
// Danglies (public/danglies.js)
// ---------------------------------------------------------------------------
export const DANGLY_WIDTH = 18;               // gj DANGLY_W
export const DANGLY_HEIGHT = 34;              // gj DANGLY_H
export const DANGLY_GRAVITY = 900;            // gj DANGLY_GRAVITY=0.25/f^2
export const DANGLY_MOVE_SPEED = 27;          // gj DANGLY_MOVE_SPEED=0.45/f
export const DANGLY_CHASE_SPEED = 42;         // gj DANGLY_CHASE_SPEED=0.7/f
export const DANGLY_JUMP_VELOCITY = 510;      // gj DANGLY_JUMP_VEL=8.5/f
export const DANGLY_JUMP_COOLDOWN_SECONDS = 200 / 60; // gj DANGLY_JUMP_COOLDOWN=200 frames
export const DANGLY_DAMAGE = 10;              // gj DANGLY_DAMAGE
export const DANGLY_ATTACK_COOLDOWN_SECONDS = 1.5; // gj DANGLY_DAMAGE_COOLDOWN=90 frames
export const DANGLY_DETECT_RANGE = 200;       // gj DANGLY_DETECT_RANGE
export const DANGLY_ATTACK_RANGE = 80;        // gj DANGLY_ATTACK_RANGE
export const DANGLY_BASE_HP = 35;             // gj createDangly.hp
export const DANGLY_SPAWN_SECONDS = 22;       // gj DANGLY_SPAWN_INTERVAL=22000ms
export const DANGLY_ARM_MAX_REACH = 75;       // gj DANGLY_ARM_MAX_REACH
export const DANGLY_CHARGE_SECONDS = 80 / 60; // gj DANGLY_CHARGE_FRAMES
export const DANGLY_KILL_SCORE = 15;          // gj sword danglyKills * 15
export const MAX_DANGLIES = 5;                // gj DANGLY_MAX_ALIVE

// ---------------------------------------------------------------------------
// Fish boss (game.js L2475-L2520)
// ---------------------------------------------------------------------------
export const FISH_SPAWN_DELAY_MS = 120000;    // gj FISH_SPAWN_DELAY (already ms)
export const FISH_RESPAWN_SECONDS = 90;       // gj fishRespawnTime=now+90000
export const FISH_SPAWN_CHANCE_PER_SECOND = 0.12; // gj Math.random()<0.002/f (*60)
export const FISH_BASE_HP = 100;              // gj freshState fishMaxHP=100
export const FISH_HP_SCALE_ON_KILL = 1.3;     // gj fishMaxHP * 1.3 on kill
export const FISH_BASE_SPEED = 24;            // gj fish.speed=0.4/f
export const FISH_MAX_SPEED = 108;            // gj Math.min(..., 1.8)/f cap
export const FISH_SPEED_RAMP_PER_SECOND = 0.72; // gj 0.012/f per elapsed-second
export const FISH_CHASE_DIST_THRESHOLD = 300; // gj if (dist>300) speed boost
export const FISH_CHASE_DIST_DENOM = 200;     // gj (dist-300)/200 chase multiplier
export const FISH_SHOOT_INTERVAL_SECONDS = 2.5; // gj 2500ms + random*100
export const FISH_SHOOT_MIN_DIST = 60;        // gj dist>60 required to shoot
export const FISH_SHOOT_PULSE_SECONDS = 18 / 60; // gj fishShootPulse=18 frames
export const FISH_TOUCH_COOLDOWN_SECONDS = 1; // gj fish.touchCd=60 frames
export const FISH_CONTACT_RADIUS = 18;        // gj overlap test 36x36 from center -18
export const FISH_CONTACT_DAMAGE = 15;        // gj applyDamage(15)
export const FISH_KILL_SCORE = 50;            // gj score+=50 on kill
/** Fish hitbox used for bomb explosion overlap — half-size (48x48 centered). */
export const FISH_BOMB_HITBOX_HALF = 24;
/** Fish hitbox used for laser/freeze/projectile overlap — half-size (56x56 centered). */
export const FISH_PROJECTILE_HITBOX_HALF = 28;

export const FISH_PROJECTILE_SPEED = 150;     // gj 2.5/f
export const FISH_PROJECTILE_SIZE = 6;        // gj const ps=6
export const FISH_PROJECTILE_MAX_DIST = 800;  // gj distance>800 (sqrt(640000)) from player
export const FISH_PROJECTILE_MAX_DIST_SQ = FISH_PROJECTILE_MAX_DIST * FISH_PROJECTILE_MAX_DIST;
export const FISH_PROJECTILE_LIFETIME_SECONDS = 4.5; // sim fallback (game.js uses dist, not lifetime)
export const FISH_PROJECTILE_RED_DAMAGE = 12;   // gj applyDamage(type==='red' ? 12 : 6)
export const FISH_PROJECTILE_OTHER_DAMAGE = 6;  // gj ... : 6 (blue/yellow)
/** Legacy alias — old average; will be phased out in Phase 1c. */
export const FISH_PROJECTILE_DAMAGE = FISH_PROJECTILE_RED_DAMAGE;
export const FISH_REFLECTED_HIT_RADIUS = 20;  // gj reflected projectile vs fish
export const FISH_REFLECTED_DAMAGE = 15;      // gj state.fishHP -= 15 (reflected)
export const FISH_PROJECTILE_YELLOW_ERASE_SIZE = 6; // gj ps=6 shape erase box
// Fish shoot roll (game.js L2510): roll>0.92 blue, >0.82 yellow, else red
export const FISH_PROJECTILE_BLUE_CHANCE = 0.08;   // gj 1 - 0.92
export const FISH_PROJECTILE_YELLOW_CHANCE = 0.10; // gj 0.92 - 0.82

// ---------------------------------------------------------------------------
// Sword (game.js L2254-L2287, L824 cooldown divisor 50)
// ---------------------------------------------------------------------------
export const SWORD_RANGE = 60;                // gj fdist<60
export const SWORD_DAMAGE = 25;               // gj state.fishHP -= 25
export const SWORD_DEFLECT_RADIUS = 50;       // gj nearby projectile filter
export const SWORD_SWING_SECONDS = 12 / 60;   // gj swordSwing.frame>12 exit (0.2s)
export const SWORD_HIT_FRAME_SECONDS = 3 / 60;// gj swordSwing.frame===3 damage check
export const SWORD_COOLDOWN_SECONDS = 50 / 60; // gj swordCooldown hotbar divisor 50
export const SWORD_PUSH_DIST = 50;            // gj fish.x += (fdx/fdist)*50 knockback

// ---------------------------------------------------------------------------
// Dash (game.js L952-L953 / L1506 divisor 60)
// ---------------------------------------------------------------------------
export const DASH_COOLDOWN_SECONDS = 60 / 60; // gj dashCooldown=60 frames

// ---------------------------------------------------------------------------
// Bomb (game.js L1662 placement, L2387-L2403 tick, L1508 divisor 120)
// ---------------------------------------------------------------------------
export const BOMB_FUSE_SECONDS = 180 / 60;    // gj timer=180 frames (3.0s)
export const BOMB_EXPLOSION_SECONDS = 15 / 60;// gj exploding=15 frames (0.25s)
export const BOMB_EXPLOSION_RADIUS = 80;      // gj distance<80
export const BOMB_DAMAGE = 40;                // gj state.fishHP -= 40
export const BOMB_COOLDOWN_SECONDS = 120 / 60;// gj bombCooldown=120 frames (2.0s)

// ---------------------------------------------------------------------------
// Laser (game.js L1690 fire, L2442-L2473 travel, L1510 divisor 45)
// ---------------------------------------------------------------------------
export const LASER_SPEED = 480;               // gj 8/f
export const LASER_LIFETIME_SECONDS = 60 / 60;// gj life=60 frames (1.0s)
export const LASER_COOLDOWN_SECONDS = 45 / 60;// gj laserCooldown=45 frames (0.75s)
export const LASER_DAMAGE = 18;               // gj state.fishHP -= 18 (fish hit)
export const LASER_DAMAGE_BUG = 12;           // gj b.hp -= 12
export const LASER_DAMAGE_DANGLY = 15;        // gj d.hp -= 15
export const LASER_HIT_RADIUS_FISH = 25;      // gj dist<25 (fish)
export const LASER_HIT_RADIUS_BUG = 20;       // gj dist<20 (bug)
export const LASER_HIT_RADIUS_DANGLY = 24;    // gj dist<24 (dangly)

// ---------------------------------------------------------------------------
// Freeze (game.js L1676 fire, L2412-L2440 travel, L1509 divisor 600)
// ---------------------------------------------------------------------------
export const FREEZE_SPEED = 300;              // gj 5/f
export const FREEZE_LIFETIME_SECONDS = 120 / 60;  // gj life=120 frames (2.0s)
export const FREEZE_DURATION_SECONDS = 240 / 60;  // gj frozen=240 frames (4.0s)
export const FREEZE_COOLDOWN_SECONDS = 600 / 60;  // gj freezeCooldown=600 frames (10.0s)
export const FREEZE_HIT_RADIUS_FISH = 30;     // gj dist<30
export const FREEZE_HIT_RADIUS_BUG = 20;      // gj dist<20
export const FREEZE_HIT_RADIUS_DANGLY = 24;   // gj dist<24

// ---------------------------------------------------------------------------
// Reflector (game.js L1653 placement, L2523-L2531 hit, L1511 divisor 30)
// ---------------------------------------------------------------------------
export const REFLECTOR_RADIUS = 16;           // gj dist<16 projectile flip
export const REFLECTOR_TTL_SECONDS = 9;       // sim-authored; game.js has no TTL (capped to 3)
export const REFLECTOR_COOLDOWN_SECONDS = 30 / 60; // gj reflectorCooldown=30 frames (0.5s)
export const MAX_REFLECTORS = 3;              // gj if (state.reflectors.length>=3) shift()

// ---------------------------------------------------------------------------
// Portal (game.js L2232-L2252, L830 divisor 20)
// ---------------------------------------------------------------------------
export const MAX_PORTALS_PER_PLAYER = 2;
export const PORTAL_HIT_WIDTH = 14;           // gj PORTAL_HIT_W
export const PORTAL_HIT_HEIGHT = 48;          // gj PORTAL_HIT_H
export const PORTAL_RADIUS = 24;              // render/placement radius (sim-authored)
export const PORTAL_TELEPORT_COOLDOWN_SECONDS = 20 / 60; // gj state.portalCooldown=20 frames (0.333s)
export const PORTAL_COOLDOWN_SECONDS = 20 / 60; // placement cooldown; game.js has none, align with hotbar divisor 20
export const PORTAL_BOOST_ENTRY_MULT = 1.15;  // gj entryVX * 1.15
export const PORTAL_BOOST_VX = 360;           // sim-authored max boost cap
// gj portalBoostVX *= 0.92 per-frame. Continuous approx: (1 - k*dt)^60 ≈ 0.92 → k ≈ 4.8
export const PORTAL_BOOST_DECAY_PER_SECOND = 4.8;
// gj if (abs(portalBoostVX) < 0.05)/f → per-sec threshold 3 (0.05*60)
export const PORTAL_BOOST_CUTOFF = 3;

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------
export const COIN_VALUES = [1, 5, 10, 15] as const; // gj COIN_VALUES {1:1,2:5,3:10,4:15}

export const DRAW_SNAP_GRID = 16;             // gj DRAW_SNAP_GRID

// gj ejectPlayerFromShape (L1138-L1143): drag-over-player damage scales with how far
// the player was shifted out of the new shape. dist<30px is a free nudge; past that,
// damage = max(1, floor(currentHealth * min(dist/200, 0.5))).
export const SHAPE_DRAG_DAMAGE_MIN_DIST = 30;
export const SHAPE_DRAG_DAMAGE_SCALE = 200;
export const SHAPE_DRAG_DAMAGE_MAX_PCT = 0.5;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
export const TOOL_ORDER = [
  "square",
  "circle",
  "triangle",
  "line",
  "polygon",
  "bezier",
  "eraser",
  "portal",
  "sword",
  "grapple",
  "reflector",
  "bomb",
  "freeze",
  "laser"
] as const;
