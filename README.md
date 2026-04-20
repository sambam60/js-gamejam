# SHAPESCAPE

A browser platformer I made for a game jam. You run around drawing shapes as platforms while a boss fish chases you down and shoots at you.

## Controls

- **A / D** or **← →** — move
- **Space / W / ↑** — jump (double jump if you have the upgrade)
- **Shift** — sprint
- **E** — dash
- **Click + drag** on the canvas — draw a platform
- **1–9** or **scroll wheel** — switch tools
- **ESC** — pause

## Tools

You start with the rectangle draw tool. Unlock more by collecting upgrade pickups in-game, or turn them on in the cheat menu before starting.

- Rectangle, Circle, Triangle, Line, Bezier, Polygon — draw platforms
- Eraser — delete shapes
- Portal — place two portals (A + B) and teleport between them
- Sword — melee swing, also deflects nearby projectiles
- Grapple Hook — latch onto any shape you drew
- Reflector — place a mirror that bounces projectiles back at the fish
- Bomb — timed explosion
- Freeze Ray — freeze the fish for a few seconds

## Enemies

**Evil Fish Eye** — spawns after 6 seconds, chases you and fires projectiles. Comes back harder every time you kill it.

**Bugs** — small green things that scuttle around and bite you. Spawn after ~4 seconds, max 8 at once. Kill them with the sword.

## Upgrades

Upgrade pickups appear in the world as you explore. Walking into one spends your score to buy it. You can also enable them all for free from the cheat menu (disables leaderboard).

Double Jump, Sprint, Wall Climb, Glide, Coin Magnet, Dash, Armor, Regen, Reinforce

## Scoring

Collect coins (worth 1–15 points each), kill bugs (+10), kill the fish (+50). Score submits to a dreamlo.com leaderboard on game over, unless you had cheats on.

## Assets

- Character sprites: `idle_1/2/3.png` (32×32 pixel art, 3-frame walk cycle), `idle_2_crouch.png`, `crouch_walk_0..3.png`
- Boss: rendered procedurally on the canvas (no sprite)
- Coins: `coin.png` – `coin4.png`
- Fonts: Berkeley Mono, Redaction 35
