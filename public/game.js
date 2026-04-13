(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const container = document.getElementById('canvas-container');
  const gameWrapper = document.getElementById('game-wrapper');

  let W, H;

  // leaderboard keys — grab free ones at dreamlo.com
  const DREAMLO_PRIVATE = '9fabDNnmmUufX_-XHl0eMQ5Rz-jJwYBEirxhcAQEpRZg';
  const DREAMLO_PUBLIC  = '69dd567a8f40bc2f605dff31';

  // colours and fonts — green terminal look, red for damage, amber for warnings
  const FONT_DISPLAY = '"Redaction 35", Georgia, serif';
  const FONT_MONO    = '"Berkeley Mono", "Courier New", "Consolas", monospace';

  const COL = {
    bright:    '#33ff33',
    primary:   '#00cc00',
    mid:       '#009900',
    dim:       '#006600',
    shadow:    '#003300',
    ghost:     '#001a00',
    glowWeak:  'rgba(51,255,51,0.15)',
    glowStrong:'rgba(51,255,51,0.35)',
    red:       '#ff3333',
    redPri:    '#cc0000',
    redDim:    '#660000',
    redGlow:   'rgba(255,51,51,0.15)',
    amber:     '#ffcc00',
    amberPri:  '#cc9900',
    amberDim:  '#665500',
    cyan:      '#00ffcc',
    cyanPri:   '#00aa88',
    cyanDim:   '#005544',
    bgVoid:    '#000000',
    bgTerminal:'#0a0a0a',
    bgPanel:   '#0d0d0d',
    bgSurface: '#111111',
    bgElevated:'#1a1a1a',
    borderSub: '#1a1a1a',
    borderDef: '#222222',
  };

  // background stars — parallax scrolling
  let starPositions = [];
  let frameTick = 0;

  function regenerateStars() {
    starPositions = [];
    if (!W || !H) return;
    const count = Math.max(80, Math.floor(W * H / 2500));
    for (let i = 0; i < count; i++) {
      starPositions.push({
        x: Math.random() * 3000,
        y: Math.random() * H * 0.8,
        r: 0.5 + Math.random() * 1.5,
        brightness: 0.3 + Math.random() * 0.7,
        parallax: 0.03 + Math.random() * 0.12
      });
    }
  }

  function resizeCanvas() {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.floor(rect.width);
    const ch = Math.floor(rect.height);
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = cw;
    H = ch;
    regenerateStars();
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // Safari shrinks the visual viewport when the tab bar is visible — figure out how much
  function updateSafariBrowserChrome() {
    const vv = window.visualViewport;
    if (!vv) return;
    const chromeHeight = Math.max(0, Math.round(window.innerHeight - vv.height));
    document.documentElement.style.setProperty('--browser-chrome-bottom', chromeHeight + 'px');
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateSafariBrowserChrome);
    window.visualViewport.addEventListener('scroll', updateSafariBrowserChrome);
    updateSafariBrowserChrome();
  }

  // load all sprites before starting
  const assets = {};
  const assetList = [
    'idle_1', 'idle_2', 'idle_3', 'little_gif_guy',
    'coin', 'coin2', 'coin3', 'coin4',
    'evil_fish_eye'
  ];
  let assetsLoaded = 0;

  function loadAssets(onDone) {
    assetList.forEach(name => {
      const img = new Image();
      const ext = name === 'little_gif_guy' ? 'gif' : 'png';
      img.src = name + '.' + ext;
      img.onload = () => { assetsLoaded++; if (assetsLoaded >= assetList.length) onDone(); };
      img.onerror = () => { assetsLoaded++; if (assetsLoaded >= assetList.length) onDone(); };
      assets[name] = img;
    });
  }

  // game constants — tweak these to adjust feel
  const CHAR_W = 32;
  const CHAR_H = 32;
  const GRAVITY = 0.3;
  const MOVE_SPEED = 2;
  const SPRINT_SPEED = 3.6;
  const JUMP_VEL = -6;
  const FISH_SPAWN_DELAY = 6000;
  const idleImages = ['idle_1', 'idle_2', 'idle_3'];
  const COIN_VALUES = { 1: 1, 2: 5, 3: 10, 4: 15 };

  // tools and upgrades
  const TOOLS = {
    square:    { name: 'DRAW',      icon: '\u25A1' },
    circle:    { name: 'CIRCLE',    icon: '\u25CB' },
    triangle:  { name: 'TRIANGLE',  icon: '\u25B3' },
    line:      { name: 'LINE',      icon: '\u2571' },
    bezier:    { name: 'BEZIER',    icon: '\u223F' },
    polygon:   { name: 'POLYGON',   icon: '\u2B21' },
    eraser:    { name: 'ERASER',    icon: '\u2715' },
    portal:    { name: 'PORTAL',    icon: '\u25CE' },
    sword:     { name: 'SWORD',     icon: '\u2020' },
    grapple:   { name: 'GRAPPLE',   icon: '\u2693' },
    reflector: { name: 'REFLECTOR', icon: '\u2B29' },
    bomb:      { name: 'BOMB',      icon: '\u25C9' },
    freeze:    { name: 'FREEZE',    icon: '\u2744' },
  };

  const UPGRADE_DEFS = {
    doubleJump: { name: 'DOUBLE JUMP',  cost: 30,  type: 'passive' },
    sprint:     { name: 'SPRINT',       cost: 20,  type: 'passive' },
    wallClimb:   { name: 'WALL CLIMB',    cost: 35,  type: 'passive' },
    glide:      { name: 'GLIDE',        cost: 25,  type: 'passive' },
    coinMagnet: { name: 'COIN MAGNET',  cost: 30,  type: 'passive' },
    dash:       { name: 'DASH',         cost: 35,  type: 'passive' },
    armor:      { name: 'ARMOR',        cost: 45,  type: 'passive' },
    regen:      { name: 'REGEN',        cost: 40,  type: 'passive' },
    reinforce:  { name: 'REINFORCE',    cost: 50,  type: 'passive' },
    circle:     { name: 'CIRCLE TOOL',  cost: 25,  type: 'tool', tool: 'circle' },
    triangle:   { name: 'TRIANGLE',     cost: 20,  type: 'tool', tool: 'triangle' },
    line:       { name: 'LINE TOOL',    cost: 30,  type: 'tool', tool: 'line' },
    bezier:     { name: 'BEZIER CURVE', cost: 60,  type: 'tool', tool: 'bezier' },
    polygon:    { name: 'POLYGON',      cost: 80,  type: 'tool', tool: 'polygon' },
    eraser:     { name: 'ERASER',       cost: 15,  type: 'tool', tool: 'eraser' },
    portal:     { name: 'PORTAL GUN',   cost: 50,  type: 'tool', tool: 'portal' },
    sword:      { name: 'SWORD',        cost: 40,  type: 'tool', tool: 'sword' },
    grapple:    { name: 'GRAPPLE HOOK', cost: 55,  type: 'tool', tool: 'grapple' },
    reflector:  { name: 'REFLECTOR',    cost: 45,  type: 'tool', tool: 'reflector' },
    bomb:       { name: 'BOMB',         cost: 35,  type: 'tool', tool: 'bomb' },
    freeze:     { name: 'FREEZE RAY',   cost: 65,  type: 'tool', tool: 'freeze' },
  };

  // menu state
  const ALL_CHEAT_KEYS = Object.keys(UPGRADE_DEFS);

  const CHEAT_CATEGORIES = [
    { id: 'shapes',   label: 'SHAPES',   keys: ['circle','triangle','line','bezier','polygon','eraser'] },
    { id: 'weapons',  label: 'WEAPONS',  keys: ['sword','bomb','reflector','freeze'] },
    { id: 'movement', label: 'MOVEMENT', keys: ['doubleJump','sprint','wallClimb','glide','dash'] },
    { id: 'utility',  label: 'UTILITY',  keys: ['portal','grapple','coinMagnet','armor','regen','reinforce'] },
  ];

  const menu = {
    playerName: '',
    nameActive: false,
    cheats: {},
    selectedIndex: 0,
    expanded: {},
    glitchFrame: -100,
    glitchLines: [],
    leaderboard: [],
    lbLoading: false,
    lbError: false,
    lbLastFetch: 0,
    scoreSubmitted: false,
  };
  for (const k of ALL_CHEAT_KEYS) menu.cheats[k] = false;
  for (const cat of CHEAT_CATEGORIES) menu.expanded[cat.id] = false;

  function getMenuItems() {
    const items = ['start', 'name'];
    for (const cat of CHEAT_CATEGORIES) {
      items.push('cat_' + cat.id);
      if (menu.expanded[cat.id]) {
        for (const k of cat.keys) items.push('cheat_' + k);
      }
    }
    return items;
  }

  function getMenuChrome() {
    const compact = H < 520;
    const padX = Math.max(10, Math.min(22, W * 0.045));
    const padY = Math.max(8, Math.min(18, H * 0.028));
    const titleY = H * (compact ? 0.12 : 0.18);
    return { compact, padX, padY, titleY };
  }

  function getMenuLayout() {
    const { titleY, compact } = getMenuChrome();
    const items = getMenuItems();
    const rows = [];
    let y = titleY + (compact ? 42 : 60);
    let firstCat = true;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === 'name') y += 30;
      if (item.startsWith('cat_')) { y += firstCat ? 30 : 10; firstCat = false; }
      rows.push({ y, item });
      if (item.startsWith('cheat_')) y += 24;
      else y += 38;
    }
    return rows;
  }

  function getMenuScrollY() {
    const layout = getMenuLayout();
    const maxVisibleY = H - 60;
    let scrollY = 0;
    if (layout.length > 0) {
      const selRow = layout[Math.min(menu.selectedIndex, layout.length - 1)];
      if (selRow && selRow.y > maxVisibleY) scrollY = selRow.y - maxVisibleY + 40;
    }
    return scrollY;
  }

  // menu rows are capped at 400px wide so they don't stretch on big screens
  function getMenuContentRect() {
    const { padX } = getMenuChrome();
    const gutter = 6;
    const avail = W - 2 * padX - 2 * gutter;
    const rowW = Math.max(100, Math.min(400, avail));
    const rowX = (W - rowW) / 2;
    return { rowW, rowX };
  }

  function triggerGlitch() {
    menu.glitchFrame = frameTick;
    menu.glitchLines = [];
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      menu.glitchLines.push({
        y: Math.random() * H,
        w: 40 + Math.random() * (W * 0.6),
        xOff: (Math.random() - 0.5) * 30,
        h: 1 + Math.random() * 3,
        bright: 0.3 + Math.random() * 0.7
      });
    }
  }

  // dreamlo is http-only with no CORS — use same-origin /api/dreamlo proxy on https (Vercel)
  function dreamloUrl(path) {
    const direct = 'http://dreamlo.com/lb/' + path;
    if (location.protocol === 'https:') {
      return '/api/dreamlo?path=' + encodeURIComponent(path);
    }
    return direct;
  }

  function formatLeaderboardTime(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    const minStr = m < 100 ? String(m).padStart(2, '0') : String(m);
    return minStr + ':' + String(r).padStart(2, '0');
  }

  function fetchLeaderboard() {
    if (!DREAMLO_PUBLIC || menu.lbLoading) return;
    const now = Date.now();
    if (now - menu.lbLastFetch < 15000) return;
    menu.lbLoading = true;
    menu.lbError = false;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', dreamloUrl(DREAMLO_PUBLIC + '/pipe'));
    xhr.onload = function () {
      const lines = xhr.responseText.trim().split('\n').filter(Boolean);
      menu.leaderboard = lines.slice(0, 10).map(function (line) {
        const parts = line.split('|');
        const timeRaw = parts[2];
        const timeSec = timeRaw !== undefined && timeRaw !== '' ? parseInt(timeRaw, 10) : NaN;
        return {
          name: parts[0] || '???',
          score: parseInt(parts[1], 10) || 0,
          timeSec: Number.isFinite(timeSec) ? timeSec : null,
        };
      });
      menu.lbLastFetch = Date.now();
      menu.lbLoading = false;
    };
    xhr.onerror = function () { menu.lbError = true; menu.lbLoading = false; };
    xhr.send();
  }

  function submitScore(name, score, timeSeconds) {
    if (!DREAMLO_PRIVATE || !name || score <= 0) return;
    const t = Math.max(0, Math.floor(timeSeconds || 0));
    const path = DREAMLO_PRIVATE + '/add/' + encodeURIComponent(name) + '/' + score + '/' + t;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', dreamloUrl(path));
    xhr.onload = function () { menu.lbLastFetch = 0; fetchLeaderboard(); };
    xhr.onerror = function () {};
    xhr.send();
  }

  // track mouse for drawing previews and tooltips
  let mouseWorld = { x: 0, y: 0 };
  let mouseScreen = { x: 0, y: 0 };
  let mouseOnCanvas = false;
  let mouseHeld = false;

  // game state — reset to this on new game
  let state = null;

  function freshState() {
    return {
      phase: 'menu',
      playerX: 50, playerY: 0, playerVY: 0,
      onGround: true, airJumpsUsed: 0,
      movingLeft: false, movingRight: false, sprinting: false,
      direction: 'right',
      idleImg: idleImages[Math.floor(Math.random() * 3)],
      cameraX: 0,
      squares: [],
      isDragging: false, dragStart: null, dragCurrent: null,
      score: 0, coins: [], lastCoinSpawn: 0,
      hearts: [], lastHeartSpawn: 0,
      upgrades: [], lastUpgradeSpawn: 0,
      activeUpgrades: {},
      health: 100, gameStartTime: 0,
      fish: { x: -200, y: 200, speed: 0.4, spawned: false, rotation: 0, lastShot: 0 },
      fishHP: 100, fishMaxHP: 100, fishRespawnTime: 0,
      projectiles: [],
      inventory: ['square'],
      selectedSlot: 0,
      portals: [],
      portalCooldown: 0,
      swordCooldown: 0,
      swordSwing: null,
      bugs: [],
      lastBugSpawn: 0,
      polyPoints: [],
      bezierPoints: [],
      grapple: null,
      grappleCooldown: 0,
      reflectors: [],
      reflectorCooldown: 0,
      bombs: [],
      bombCooldown: 0,
      fishFrozen: 0,
      freezeCooldown: 0,
      dashCooldown: 0,
      dashActive: 0,
      regenTick: 0,
      damageFlash: 0,
      pauseStart: 0,
    };
  }

  state = freshState();

  function getCurrentTool() {
    return state.inventory[state.selectedSlot] || 'square';
  }

  // keyboard input
  const keys = {};

  window.addEventListener('keydown', e => {
    if (e.repeat && state.phase !== 'menu') return;
    keys[e.code] = true;

    if (state.phase === 'menu') {
      if (menu.nameActive) {
        if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Tab') {
          menu.nameActive = false; e.preventDefault(); return;
        }
        if (e.code === 'Backspace') { menu.playerName = menu.playerName.slice(0, -1); e.preventDefault(); return; }
        if (e.key.length === 1 && menu.playerName.length < 16) { menu.playerName += e.key; e.preventDefault(); return; }
        return;
      }
      const prevIdx = menu.selectedIndex;
      const curItems = getMenuItems();
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        menu.selectedIndex = (menu.selectedIndex - 1 + curItems.length) % curItems.length;
        e.preventDefault();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        menu.selectedIndex = (menu.selectedIndex + 1) % curItems.length;
        e.preventDefault();
      } else if (e.code === 'Enter' || e.code === 'Space') {
        activateMenuItem(curItems[menu.selectedIndex]);
        e.preventDefault();
      }
      if (menu.selectedIndex !== prevIdx) triggerGlitch();
      return;
    }

    if (state.phase === 'gameover' && e.code === 'Enter') {
      state.phase = 'menu'; e.preventDefault(); return;
    }

    if (state.phase === 'playing' && e.code === 'Escape') {
      state.phase = 'paused';
      state.pauseStart = Date.now();
      state.movingLeft = false; state.movingRight = false; state.sprinting = false;
      e.preventDefault(); return;
    }

    if (state.phase === 'paused') {
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
        const pausedMs = Date.now() - state.pauseStart;
        state.gameStartTime += pausedMs;
        state.lastCoinSpawn += pausedMs;
        state.lastHeartSpawn += pausedMs;
        state.lastUpgradeSpawn += pausedMs;
        state.lastBugSpawn += pausedMs;
        if (state.fish.lastShot) state.fish.lastShot += pausedMs;
        if (state.fishRespawnTime > 0) state.fishRespawnTime += pausedMs;
        state.phase = 'playing';
        e.preventDefault(); return;
      }
      if (e.code === 'KeyQ') {
        state.phase = 'menu';
        e.preventDefault(); return;
      }
      return;
    }

    if (state.phase === 'playing') {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { tryJump(); e.preventDefault(); }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { state.movingLeft = true; e.preventDefault(); }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { state.movingRight = true; e.preventDefault(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.sprinting = true;
      if (e.code === 'KeyE' && state.activeUpgrades.dash && state.dashCooldown <= 0) {
        state.dashActive = 8;
        state.dashCooldown = 60;
      }

      // Inventory slot keys 1-9
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9 && num <= state.inventory.length) {
        state.selectedSlot = num - 1;
        e.preventDefault();
      }
    }
  });

  window.addEventListener('keyup', e => {
    keys[e.code] = false;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') state.movingLeft = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') state.movingRight = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.sprinting = false;
  });

  // Scroll wheel to cycle inventory
  canvas.addEventListener('wheel', e => {
    if (state.phase !== 'playing' || state.inventory.length <= 1) return;
    e.preventDefault();
    if (e.deltaY > 0) state.selectedSlot = (state.selectedSlot + 1) % state.inventory.length;
    else state.selectedSlot = (state.selectedSlot - 1 + state.inventory.length) % state.inventory.length;
  }, { passive: false });

  function activateMenuItem(item) {
    if (item === 'name') { menu.nameActive = true; return; }
    if (item.startsWith('cat_')) {
      const catId = item.slice(4);
      menu.expanded[catId] = !menu.expanded[catId];
      triggerGlitch();
      return;
    }
    if (item.startsWith('cheat_')) {
      const key = item.slice(6);
      menu.cheats[key] = !menu.cheats[key];
      triggerGlitch();
      return;
    }
    if (item === 'start') startGame();
  }

  // mouse and touch input
  function canvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width, scaleY = H / rect.height;
    return { x: (clientX - rect.left) * scaleX + state.cameraX, y: H - (clientY - rect.top) * scaleY };
  }

  function screenCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) * (W / rect.width), y: (clientY - rect.top) * (H / rect.height) };
  }

  canvas.addEventListener('mousemove', e => {
    mouseOnCanvas = true;
    mouseWorld = canvasCoords(e.clientX, e.clientY);
    mouseScreen = screenCoords(e.clientX, e.clientY);
    if (state.isDragging) state.dragCurrent = canvasCoords(e.clientX, e.clientY);
  });
  canvas.addEventListener('mouseleave', () => { mouseOnCanvas = false; releaseGrapple(); finishDrag(); });

  canvas.addEventListener('mousedown', e => {
    mouseHeld = true;
    if (state.phase === 'menu') { handleMenuClick(e); return; }
    if (state.phase === 'gameover') { state.phase = 'menu'; return; }
    if (state.phase !== 'playing') return;

    const tool = getCurrentTool();
    const p = canvasCoords(e.clientX, e.clientY);

    if (tool === 'square' || tool === 'circle' || tool === 'triangle' || tool === 'line') {
      state.isDragging = true; state.dragStart = p; state.dragCurrent = p;
    } else if (tool === 'polygon') {
      handlePolygonClick(p);
    } else if (tool === 'bezier') {
      handleBezierClick(p);
    } else if (tool === 'eraser') {
      eraseAtPoint(p);
    } else if (tool === 'portal') {
      placePortal(p);
    } else if (tool === 'sword') {
      triggerSwordSwing();
    } else if (tool === 'grapple') {
      activateGrapple(p);
    } else if (tool === 'reflector') {
      placeReflector(p);
    } else if (tool === 'bomb') {
      placeBomb(p);
    } else if (tool === 'freeze') {
      activateFreeze();
    }
  });
  canvas.addEventListener('mouseup', () => { mouseHeld = false; releaseGrapple(); finishDrag(); });
  window.addEventListener('mouseup', () => { mouseHeld = false; });

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    mouseHeld = true;
    if (state.phase === 'menu') {
      if (e.touches.length) {
        const t = e.touches[0];
        handleMenuClick({ clientX: t.clientX, clientY: t.clientY });
      }
      return;
    }
    if (state.phase === 'gameover') { state.phase = 'menu'; return; }
    if (state.phase !== 'playing' || !e.touches.length) return;
    const t = e.touches[0];
    const tool = getCurrentTool();
    const p = canvasCoords(t.clientX, t.clientY);
    if (tool === 'square' || tool === 'circle' || tool === 'triangle' || tool === 'line') {
      state.isDragging = true; state.dragStart = p; state.dragCurrent = p;
    } else if (tool === 'polygon') {
      handlePolygonClick(p);
    } else if (tool === 'bezier') {
      handleBezierClick(p);
    } else if (tool === 'eraser') {
      eraseAtPoint(p);
    } else if (tool === 'portal') {
      placePortal(p);
    } else if (tool === 'sword') {
      triggerSwordSwing();
    } else if (tool === 'grapple') {
      activateGrapple(p);
    } else if (tool === 'reflector') {
      placeReflector(p);
    } else if (tool === 'bomb') {
      placeBomb(p);
    } else if (tool === 'freeze') {
      activateFreeze();
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!state.isDragging || !e.touches.length) return;
    state.dragCurrent = canvasCoords(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  canvas.addEventListener('touchend', e => { e.preventDefault(); mouseHeld = false; releaseGrapple(); finishDrag(); }, { passive: false });
  canvas.addEventListener('touchcancel', e => { e.preventDefault(); mouseHeld = false; releaseGrapple(); finishDrag(); }, { passive: false });

  function finishDrag() {
    if (!state.isDragging || !state.dragStart || !state.dragCurrent) {
      state.isDragging = false; state.dragStart = null; state.dragCurrent = null; return;
    }
    const tool = getCurrentTool();
    const sx = Math.min(state.dragStart.x, state.dragCurrent.x);
    const sy = Math.min(state.dragStart.y, state.dragCurrent.y);
    const w = Math.abs(state.dragCurrent.x - state.dragStart.x);
    const h = Math.abs(state.dragCurrent.y - state.dragStart.y);
    let newShape = null;

    if (tool === 'circle') {
      const ccx = (state.dragStart.x + state.dragCurrent.x) / 2;
      const ccy = (state.dragStart.y + state.dragCurrent.y) / 2;
      const r = Math.min(w, h) / 2;
      if (r > 4) {
        newShape = { x: ccx - r, y: ccy - r, width: r * 2, height: r * 2, shape: 'circle', cx: ccx, cy: ccy, r: r };
      }
    } else if (tool === 'triangle') {
      if (w > 4 && h > 4) {
        newShape = {
          x: sx, y: sy, width: w, height: h, shape: 'triangle',
          v1: { x: sx + w / 2, y: sy + h },
          v2: { x: sx, y: sy },
          v3: { x: sx + w, y: sy },
        };
      }
    } else if (tool === 'line') {
      const ldx = state.dragCurrent.x - state.dragStart.x, ldy = state.dragCurrent.y - state.dragStart.y;
      const len = Math.sqrt(ldx * ldx + ldy * ldy);
      if (len > 8) {
        const thickness = 6;
        const segments = generateLineSegments(state.dragStart.x, state.dragStart.y, state.dragCurrent.x, state.dragCurrent.y, thickness);
        const minX = Math.min(state.dragStart.x, state.dragCurrent.x) - thickness / 2;
        const minY = Math.min(state.dragStart.y, state.dragCurrent.y) - thickness / 2;
        const maxX = Math.max(state.dragStart.x, state.dragCurrent.x) + thickness / 2;
        const maxY = Math.max(state.dragStart.y, state.dragCurrent.y) + thickness / 2;
        newShape = {
          x: minX, y: minY, width: maxX - minX, height: maxY - minY, shape: 'line',
          x1: state.dragStart.x, y1: state.dragStart.y, x2: state.dragCurrent.x, y2: state.dragCurrent.y,
          segments
        };
      }
    } else {
      if (w > 4 && h > 4) newShape = { x: sx, y: sy, width: w, height: h, shape: 'rect' };
    }

    if (newShape) {
      state.squares.push(newShape);
      ejectPlayerFromShape(newShape);
    }
    state.isDragging = false; state.dragStart = null; state.dragCurrent = null;
  }

  // hotbar DOM — shows inventory slots outside the canvas
  const hotbarEl = document.getElementById('hotbar');
  let hotbarSlotCount = 0;

  function updateHotbarDOM() {
    if (state.phase !== 'playing') {
      if (hotbarEl.children.length > 0) hotbarEl.innerHTML = '';
      hotbarSlotCount = 0;
      return;
    }

    const inv = state.inventory;
    if (inv.length !== hotbarSlotCount) {
      hotbarEl.innerHTML = '';
      for (let i = 0; i < inv.length; i++) {
        const def = TOOLS[inv[i]];
        const slot = document.createElement('div');
        slot.className = 'slot';
        slot.dataset.idx = i;
        slot.innerHTML = '<span class="slot-num">' + (i + 1) + '</span><span class="slot-icon">' + (def ? def.icon : '') + '</span><div class="slot-cd"></div>';
        slot.addEventListener('mousedown', e => { e.stopPropagation(); state.selectedSlot = parseInt(slot.dataset.idx); });
        slot.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); state.selectedSlot = parseInt(slot.dataset.idx); }, { passive: false });
        hotbarEl.appendChild(slot);
      }
      // text label showing which tool is selected
      const label = document.createElement('span');
      label.className = 'slot-label';
      hotbarEl.appendChild(label);
      hotbarSlotCount = inv.length;
    }

    const slots = hotbarEl.querySelectorAll('.slot');
    const label = hotbarEl.querySelector('.slot-label');
    for (let i = 0; i < slots.length; i++) {
      const sel = i === state.selectedSlot;
      slots[i].classList.toggle('selected', sel);
      // cooldown fill overlay per tool
      const cdEl = slots[i].querySelector('.slot-cd');
      let cdPct = 0;
      if (inv[i] === 'sword' && state.swordCooldown > 0) cdPct = (state.swordCooldown / 50) * 100;
      else if (inv[i] === 'grapple' && state.grappleCooldown > 0) cdPct = (state.grappleCooldown / 90) * 100;
      else if (inv[i] === 'bomb' && state.bombCooldown > 0) cdPct = (state.bombCooldown / 120) * 100;
      else if (inv[i] === 'freeze' && state.freezeCooldown > 0) cdPct = (state.freezeCooldown / 600) * 100;
      else if (inv[i] === 'reflector' && state.reflectorCooldown > 0) cdPct = (state.reflectorCooldown / 30) * 100;
      cdEl.style.height = Math.round(cdPct) + '%';
    }
    if (label) {
      const def = TOOLS[inv[state.selectedSlot]];
      label.textContent = def ? def.name : '';
    }
  }

  // portal gun — max 2 portals, oldest gets replaced
  function placePortal(worldPos) {
    if (state.portals.length >= 2) state.portals.shift();
    state.portals.push({ x: worldPos.x, y: worldPos.y });
  }

  // sword swing — one swing at a time, checks cooldown
  function triggerSwordSwing() {
    if (state.swordCooldown > 0 || state.swordSwing) return;
    state.swordSwing = { frame: 0, direction: state.direction, hit: false };
  }

  // the remaining tool handlers
  function handlePolygonClick(p) {
    if (state.polyPoints.length >= 3) {
      const first = state.polyPoints[0];
      const dx = p.x - first.x, dy = p.y - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 20) { closePolygon(); return; }
    }
    state.polyPoints.push(p);
  }

  function closePolygon() {
    const pts = state.polyPoints;
    if (pts.length < 3) { state.polyPoints = []; return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    const shape = { x: minX, y: minY, width: maxX - minX, height: maxY - minY, shape: 'polygon', vertices: pts.slice() };
    state.squares.push(shape);
    ejectPlayerFromShape(shape);
    state.polyPoints = [];
  }

  function handleBezierClick(p) {
    state.bezierPoints.push(p);
    if (state.bezierPoints.length === 3) closeBezier();
  }

  function closeBezier() {
    const pts = state.bezierPoints;
    if (pts.length !== 3) { state.bezierPoints = []; return; }
    const [p0, p2, p1] = pts;
    const thickness = 6;
    const segments = generateBezierSegments(p0, p1, p2, thickness);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const seg of segments) {
      if (seg.x < minX) minX = seg.x;
      if (seg.y < minY) minY = seg.y;
      if (seg.x + seg.width > maxX) maxX = seg.x + seg.width;
      if (seg.y + seg.height > maxY) maxY = seg.y + seg.height;
    }
    const shape = { x: minX, y: minY, width: maxX - minX, height: maxY - minY, shape: 'bezier', p0, p1, p2, segments };
    state.squares.push(shape);
    ejectPlayerFromShape(shape);
    state.bezierPoints = [];
  }

  function eraseAtPoint(worldPos) {
    for (let i = state.squares.length - 1; i >= 0; i--) {
      const s = state.squares[i];
      if (worldPos.x >= s.x && worldPos.x <= s.x + s.width && worldPos.y >= s.y && worldPos.y <= s.y + s.height) {
        state.squares.splice(i, 1);
        return;
      }
    }
  }

  const GRAPPLE_MAX_RANGE = 400;

  function activateGrapple(worldPos) {
    if (state.grappleCooldown > 0) return;
    const pcx = state.playerX + CHAR_W / 2;
    const pcy = -state.playerY + CHAR_H / 2;
    let hitShape = null;
    for (const s of state.squares) {
      if (worldPos.x >= s.x && worldPos.x <= s.x + s.width &&
          worldPos.y >= s.y && worldPos.y <= s.y + s.height) {
        hitShape = s;
        break;
      }
    }
    if (!hitShape) return;
    const clampX = Math.max(hitShape.x, Math.min(hitShape.x + hitShape.width, worldPos.x));
    const clampY = Math.max(hitShape.y, Math.min(hitShape.y + hitShape.height, worldPos.y));
    const dx = clampX - pcx, dy = clampY - pcy;
    if (Math.sqrt(dx * dx + dy * dy) > GRAPPLE_MAX_RANGE) return;
    state.grapple = { tx: clampX, ty: clampY, shape: hitShape };
  }

  function releaseGrapple() {
    if (state.grapple) {
      state.grapple = null;
      state.grappleCooldown = 90;
    }
  }

  function placeReflector(worldPos) {
    if (state.reflectorCooldown > 0) return;
    if (state.reflectors.length >= 3) state.reflectors.shift();
    const angle = Math.atan2(worldPos.y - (-state.playerY + CHAR_H / 2), worldPos.x - (state.playerX + CHAR_W / 2));
    state.reflectors.push({ x: worldPos.x, y: worldPos.y, angle });
    state.reflectorCooldown = 30;
  }

  function placeBomb(worldPos) {
    if (state.bombCooldown > 0) return;
    state.bombs.push({ x: worldPos.x, y: worldPos.y, timer: 180, exploding: 0 });
    state.bombCooldown = 120;
  }

  function activateFreeze() {
    if (state.freezeCooldown > 0 || !state.fish.spawned) return;
    state.fishFrozen = 180;
    state.freezeCooldown = 600;
  }

  // figure out which menu row was clicked
  function handleMenuClick(e) {
    const sc = screenCoords(e.clientX, e.clientY);
    const scrollY = getMenuScrollY();
    const layout = getMenuLayout();
    const curItems = getMenuItems();
    const { rowX, rowW } = getMenuContentRect();
    const x0 = rowX;
    const x1 = rowX + rowW;
    for (let i = layout.length - 1; i >= 0; i--) {
      const row = layout[i];
      const item = curItems[i];
      const isCheat = item.startsWith('cheat_');
      const rowHalf = isCheat ? 12 : 18;
      const visY = row.y - scrollY;
      if (visY + rowHalf < 4 || visY - rowHalf > H - 4) continue;
      if (sc.y > visY - rowHalf && sc.y < visY + rowHalf && sc.x > x0 && sc.x < x1) {
        const prevIdx = menu.selectedIndex;
        menu.selectedIndex = i;
        if (prevIdx !== i) triggerGlitch();
        activateMenuItem(curItems[i]);
        return;
      }
    }
  }

  // mobile on-screen buttons
  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const btnJump = document.getElementById('btn-jump');

  function mobileBtn(btn, onDown, onUp) {
    btn.addEventListener('touchstart', e => { e.preventDefault(); onDown(); }, { passive: false });
    btn.addEventListener('touchend', e => { e.preventDefault(); onUp(); }, { passive: false });
    btn.addEventListener('touchcancel', e => { e.preventDefault(); onUp(); }, { passive: false });
    btn.addEventListener('mousedown', onDown);
    btn.addEventListener('mouseup', onUp);
    btn.addEventListener('mouseleave', onUp);
  }
  mobileBtn(btnLeft, () => { if (state.phase === 'playing') state.movingLeft = true; }, () => { state.movingLeft = false; });
  mobileBtn(btnRight, () => { if (state.phase === 'playing') state.movingRight = true; }, () => { state.movingRight = false; });
  mobileBtn(btnJump, () => { tryJump(); }, () => {});

  // start / restart game
  function startGame() {
    menu.scoreSubmitted = false;
    const s = freshState();
    s.phase = 'playing';
    s.gameStartTime = Date.now();
    s.lastCoinSpawn = Date.now();
    s.lastHeartSpawn = Date.now();
    s.lastUpgradeSpawn = Date.now();
    const cheatedUpgrades = {};
    for (const k of ALL_CHEAT_KEYS) cheatedUpgrades[k] = menu.cheats[k];
    s.activeUpgrades = cheatedUpgrades;
    for (const k of ALL_CHEAT_KEYS) {
      const def = UPGRADE_DEFS[k];
      if (menu.cheats[k] && def.tool && s.inventory.indexOf(def.tool) === -1) {
        s.inventory.push(def.tool);
      }
    }
    state = s;
  }

  function tryJump() {
    if (state.phase !== 'playing') return;
    if (state.onGround || state.playerY >= -2) {
      state.playerVY = JUMP_VEL; state.onGround = false; state.airJumpsUsed = 0; return;
    }
    if (state.activeUpgrades.wallClimb) {
      const pL = state.playerX, pB = -state.playerY;
      const rects = getCollisionRects();
      let touchingWall = false;
      for (const s of rects) {
        if (overlap(pL - 2, pB, 2, CHAR_H, s.x, s.y, s.width, s.height) ||
            overlap(pL + CHAR_W, pB, 2, CHAR_H, s.x, s.y, s.width, s.height)) {
          touchingWall = true; break;
        }
      }
      if (touchingWall) { state.playerVY = JUMP_VEL * 0.85; return; }
    }
    if (state.activeUpgrades.doubleJump && state.airJumpsUsed < 1) {
      state.playerVY = JUMP_VEL; state.airJumpsUsed++;
    }
  }

  // collision helpers
  function overlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function resolveHorizontal(proposedX, bottom, squares, dir) {
    if (dir === 0) return proposedX;
    let x = proposedX;
    for (const s of squares) {
      if (!(bottom < s.y + s.height && bottom + CHAR_H > s.y)) continue;
      if (dir > 0 && overlap(x, bottom, CHAR_W, CHAR_H, s.x, s.y, s.width, s.height))
        x = Math.min(x, s.x - CHAR_W);
      else if (dir < 0 && overlap(x, bottom, CHAR_W, CHAR_H, s.x, s.y, s.width, s.height))
        x = Math.max(x, s.x + s.width);
    }
    return x;
  }

  function getCollisionRects() {
    const rects = [];
    for (const s of state.squares) {
      if (s.segments) for (const seg of s.segments) rects.push(seg);
      else rects.push(s);
    }
    return rects;
  }

  function generateLineSegments(x1, y1, x2, y2, thickness) {
    const segs = [];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.floor(len / 8));
    for (let i = 0; i < steps; i++) {
      const t1 = i / steps, t2 = (i + 1) / steps;
      const sx = x1 + dx * t1, sy = y1 + dy * t1;
      const ex = x1 + dx * t2, ey = y1 + dy * t2;
      const mx = Math.min(sx, ex) - thickness / 2, my = Math.min(sy, ey) - thickness / 2;
      segs.push({ x: mx, y: my, width: Math.abs(ex - sx) + thickness, height: Math.abs(ey - sy) + thickness });
    }
    return segs;
  }

  function generateBezierSegments(p0, p1, p2, thickness) {
    const segs = [];
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const t1 = i / steps, t2 = (i + 1) / steps;
      const bx1 = (1 - t1) * (1 - t1) * p0.x + 2 * (1 - t1) * t1 * p1.x + t1 * t1 * p2.x;
      const by1 = (1 - t1) * (1 - t1) * p0.y + 2 * (1 - t1) * t1 * p1.y + t1 * t1 * p2.y;
      const bx2 = (1 - t2) * (1 - t2) * p0.x + 2 * (1 - t2) * t2 * p1.x + t2 * t2 * p2.x;
      const by2 = (1 - t2) * (1 - t2) * p0.y + 2 * (1 - t2) * t2 * p1.y + t2 * t2 * p2.y;
      const mx = Math.min(bx1, bx2) - thickness / 2, my = Math.min(by1, by2) - thickness / 2;
      segs.push({ x: mx, y: my, width: Math.abs(bx2 - bx1) + thickness, height: Math.abs(by2 - by1) + thickness });
    }
    return segs;
  }

  function applyDamage(amount) {
    if (state.activeUpgrades.armor) amount = Math.ceil(amount * 0.6);
    state.health = Math.max(0, state.health - amount);
    state.damageFlash = 12;
    if (state.health <= 0) { state.phase = 'gameover'; onGameOver(); }
  }

  function hasCheatsEnabled() {
    return ALL_CHEAT_KEYS.some(function (k) { return menu.cheats[k]; });
  }

  function onGameOver() {
    if (menu.scoreSubmitted) return;
    menu.scoreSubmitted = true;
    if (hasCheatsEnabled()) return;
    const name = menu.playerName || 'ANON';
    const survivedSec = Math.floor((Date.now() - state.gameStartTime) / 1000);
    submitScore(name, state.score, survivedSec);
  }

  function ejectPlayerFromShape(shape) {
    const pL = state.playerX, pB = -state.playerY;
    if (!overlap(pL, pB, CHAR_W, CHAR_H, shape.x, shape.y, shape.width, shape.height)) return;

    const oldX = state.playerX, oldY = state.playerY;

    const toLeft = (pL + CHAR_W) - shape.x;
    const toRight = (shape.x + shape.width) - pL;
    const toBottom = (pB + CHAR_H) - shape.y;
    const toTop = (shape.y + shape.height) - pB;
    const min = Math.min(toLeft, toRight, toBottom, toTop);

    if (min === toTop) {
      state.playerY = -(shape.y + shape.height);
      state.playerVY = 0;
      state.onGround = true;
    } else if (min === toBottom) {
      state.playerY = -(shape.y - CHAR_H);
      state.playerVY = 0;
    } else if (min === toLeft) {
      state.playerX = shape.x - CHAR_W;
    } else {
      state.playerX = shape.x + shape.width;
    }

    const dx = state.playerX - oldX;
    const dy = state.playerY - oldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const pct = Math.min(dist / 200, 0.5);
    const dmg = Math.max(1, Math.floor(state.health * pct));
    applyDamage(dmg);
  }

  function resolveVertical(proposedY, px, squares, vy) {
    let y = proposedY, vel = vy, grounded = false;
    const pL = px, pR = px + CHAR_W;
    let bottom = -y;
    if (vel > 0 && bottom <= 0) { y = 0; vel = 0; grounded = true; }
    bottom = -y;
    if (vel >= 0) {
      let highest = null;
      for (const s of squares) {
        if (!(pL < s.x + s.width && pR > s.x)) continue;
        if (!overlap(pL, bottom, CHAR_W, CHAR_H, s.x, s.y, s.width, s.height)) continue;
        const top = s.y + s.height;
        if (highest === null || top > highest) highest = top;
      }
      if (highest !== null) { y = -highest; vel = 0; grounded = true; }
    } else {
      let lowest = null;
      for (const s of squares) {
        if (!(pL < s.x + s.width && pR > s.x)) continue;
        if (!overlap(pL, bottom, CHAR_W, CHAR_H, s.x, s.y, s.width, s.height)) continue;
        if (lowest === null || s.y < lowest) lowest = s.y;
      }
      if (lowest !== null) { y = -(lowest - CHAR_H); vel = 0; }
    }
    return { y, vy: vel, onGround: grounded };
  }

  // update — runs every frame
  function update() {
    if (state.phase !== 'playing' || state.health <= 0) return;
    const now = Date.now();

    let dir = 0;
    if (state.movingLeft) dir = -1;
    else if (state.movingRight) dir = 1;
    if (dir === -1) state.direction = 'left';
    else if (dir === 1) state.direction = 'right';
    if (dir !== 0) state.idleImg = idleImages[Math.floor(Math.random() * 3)];

    let speed = (state.sprinting && state.activeUpgrades.sprint) ? SPRINT_SPEED : MOVE_SPEED;
    if (state.dashActive > 0) { speed = 8; state.dashActive--; }
    if (state.dashCooldown > 0) state.dashCooldown--;
    if (state.damageFlash > 0) state.damageFlash--;

    // grapple pull — override normal gravity while hooked
    let grappleHX = 0;
    let grappling = !!state.grapple;
    if (grappling) {
      const g = state.grapple;
      const gdx = g.tx - (state.playerX + CHAR_W / 2);
      const gdy = g.ty - (-state.playerY + CHAR_H / 2);
      const gdist = Math.sqrt(gdx * gdx + gdy * gdy);
      if (gdist > 12) {
        const pullSpeed = Math.min(4.5, 1.5 + gdist * 0.01);
        grappleHX = (gdx / gdist) * pullSpeed;
        state.playerVY = state.playerVY * 0.3 + (-(gdy / gdist) * pullSpeed) * 0.7;
      }
    }

    const colRects = getCollisionRects();
    const proposedX = state.playerX + dir * speed + grappleHX;
    const hDir = proposedX > state.playerX ? 1 : proposedX < state.playerX ? -1 : dir;
    const resolvedX = resolveHorizontal(proposedX, -state.playerY, colRects, hDir);

    if (grappling && grappleHX !== 0 && Math.abs(resolvedX - proposedX) > 0.5) {
      state.grapple = null;
      state.grappleCooldown = 90;
      grappling = false;
    }
    state.playerX = resolvedX;

    if (!grappling) state.playerVY += GRAVITY;
    if (state.activeUpgrades.glide && !state.onGround && state.playerVY > 0 && (keys['Space'] || keys['ArrowUp'] || keys['KeyW'])) {
      state.playerVY = Math.min(state.playerVY, 1.0);
    }
    const vr = resolveVertical(state.playerY + state.playerVY, state.playerX, colRects, state.playerVY);
    state.playerY = vr.y; state.playerVY = vr.vy;
    if (vr.onGround) { state.onGround = true; state.airJumpsUsed = 0; } else state.onGround = false;

    if (grappling && vr.onGround) {
      state.grapple = null;
      state.grappleCooldown = 90;
    }

    const deadLeft = W * 0.3;
    const deadRight = W * 0.65;
    const screenX = state.playerX - state.cameraX;
    let targetCam = state.cameraX;
    if (screenX < deadLeft) targetCam = state.playerX - deadLeft;
    else if (screenX > deadRight) targetCam = state.playerX - deadRight;
    targetCam = Math.max(0, targetCam);
    state.cameraX += (targetCam - state.cameraX) * 0.08;

    // portal teleport
    if (state.portals.length === 2 && state.portalCooldown <= 0) {
      const pL2 = state.playerX, pB2 = -state.playerY;
      for (let i = 0; i < 2; i++) {
        const pt = state.portals[i], other = state.portals[1 - i];
        if (overlap(pL2, pB2, CHAR_W, CHAR_H, pt.x - 12, pt.y - 12, 24, 24)) {
          state.playerX = other.x - CHAR_W / 2;
          state.playerY = -(other.y - CHAR_H / 2);
          state.portalCooldown = 60;
          break;
        }
      }
    }
    if (state.portalCooldown > 0) state.portalCooldown--;

    // sword swing — advance frame, check hits at frame 3
    if (state.swordSwing) {
      state.swordSwing.frame++;
      if (state.swordSwing.frame === 3 && !state.swordSwing.hit) {
        state.swordSwing.hit = true;
        const pcx = state.playerX + CHAR_W / 2, pcy = -state.playerY + CHAR_H / 2;
        // check fish
        if (state.fish.spawned) {
          const fdx = state.fish.x - pcx, fdy = state.fish.y - pcy;
          const fdist = Math.sqrt(fdx * fdx + fdy * fdy);
          if (fdist < 60) {
            state.fishHP -= 25;
            if (fdist > 1) { state.fish.x += (fdx / fdist) * 50; state.fish.y += (fdy / fdist) * 50; }
          }
        }
        // check bugs
        if (window.BugSystem) {
          const bugKills = window.BugSystem.swordHitBugs(state.bugs, pcx, pcy, 60);
          state.score += bugKills * 10;
        }
        // deflect nearby projectiles
        state.projectiles = state.projectiles.filter(p => {
          const pdx = p.x - pcx, pdy = p.y - pcy;
          return Math.sqrt(pdx * pdx + pdy * pdy) > 50;
        });
      }
      if (state.swordSwing.frame > 12) state.swordSwing = null;
    }
    if (state.swordCooldown > 0) state.swordCooldown--;

    // spawn coins ahead of the player
    const isMoving = dir !== 0;
    if (isMoving && now - state.lastCoinSpawn > 8000 + Math.random() * 7000) {
      state.coins.push({
        id: 'c' + now + Math.random(),
        x: state.playerX + 300 + Math.random() * 200,
        y: Math.random() * (H * 0.6),
        type: Math.floor(Math.random() * 4) + 1
      });
      state.lastCoinSpawn = now;
    }

    // spawn a heart pickup if player is damaged
    if (isMoving && state.health < 100 && now - state.lastHeartSpawn > 20000 + Math.random() * 15000) {
      state.hearts.push({
        id: 'h' + now + Math.random(),
        x: state.playerX + 250 + Math.random() * 300,
        y: 10 + Math.random() * (H * 0.5),
        heal: 20 + Math.floor(Math.random() * 3) * 5,
      });
      state.lastHeartSpawn = now;
    }

    // spawn upgrade pickups — rarer than coins
    if (isMoving && now - state.lastUpgradeSpawn > 30000 + Math.random() * 25000) {
      const available = Object.keys(UPGRADE_DEFS).filter(k => !state.activeUpgrades[k]);
      if (available.length > 0) {
        const key = available[Math.floor(Math.random() * available.length)];
        state.upgrades.push({
          id: 'u' + now + Math.random(),
          x: state.playerX + 400 + Math.random() * 300,
          y: 10 + Math.random() * (H * 0.4),
          key
        });
      }
      state.lastUpgradeSpawn = now;
    }

    // collect coins / hearts / upgrades on overlap
    const pL = state.playerX, pB = -state.playerY;
    state.coins = state.coins.filter(c => {
      if (overlap(pL, pB, CHAR_W, CHAR_H, c.x - 8, c.y - 8, 16, 16)) { state.score += COIN_VALUES[c.type] || 1; return false; }
      return true;
    });
    state.hearts = state.hearts.filter(h => {
      if (overlap(pL, pB, CHAR_W, CHAR_H, h.x - 8, h.y - 8, 16, 16)) {
        state.health = Math.min(100, state.health + h.heal);
        return false;
      }
      return true;
    });
    state.upgrades = state.upgrades.filter(u => {
      if (overlap(pL, pB, CHAR_W, CHAR_H, u.x - 8, u.y - 8, 16, 16)) {
        const def = UPGRADE_DEFS[u.key];
        if (state.score >= def.cost) {
          state.score -= def.cost;
          state.activeUpgrades[u.key] = true;
          if (def.tool && state.inventory.indexOf(def.tool) === -1) {
            state.inventory.push(def.tool);
          }
          return false;
        }
      }
      return true;
    });

    // coin magnet upgrade — pull nearby coins toward player
    if (state.activeUpgrades.coinMagnet) {
      const magnetRange = 120;
      const mcx = state.playerX + CHAR_W / 2, mcy = -state.playerY + CHAR_H / 2;
      for (const c of state.coins) {
        const mdx = mcx - c.x, mdy = mcy - c.y;
        const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
        if (mdist < magnetRange && mdist > 1) { c.x += (mdx / mdist) * 1.5; c.y += (mdy / mdist) * 1.5; }
      }
    }

    // regen upgrade — slow health recovery
    if (state.activeUpgrades.regen && state.health > 0 && state.health < 100) {
      state.regenTick++;
      if (state.regenTick >= 180) { state.health = Math.min(100, state.health + 1); state.regenTick = 0; }
    }

    // release grapple once we get close enough to the target
    if (state.grapple) {
      const g = state.grapple;
      const gdx = g.tx - (state.playerX + CHAR_W / 2);
      const gdy = g.ty - (-state.playerY + CHAR_H / 2);
      if (Math.sqrt(gdx * gdx + gdy * gdy) <= 12) {
        state.playerVY = Math.min(state.playerVY, -2);
        state.grapple = null;
        state.grappleCooldown = 90;
      }
    }
    if (state.grappleCooldown > 0) state.grappleCooldown--;

    // bombs — countdown, explode, then remove
    state.bombs = state.bombs.filter(b => {
      b.timer--;
      if (b.timer <= 0 && b.exploding === 0) {
        b.exploding = 15;
        if (state.fish.spawned) {
          const bdx = state.fish.x - b.x, bdy = state.fish.y - b.y;
          if (Math.sqrt(bdx * bdx + bdy * bdy) < 80) state.fishHP -= 40;
        }
        state.projectiles = state.projectiles.filter(p => {
          const bdx2 = p.x - b.x, bdy2 = p.y - b.y;
          return Math.sqrt(bdx2 * bdx2 + bdy2 * bdy2) > 80;
        });
      }
      if (b.exploding > 0) { b.exploding--; return b.exploding > 0; }
      return b.timer > 0;
    });
    if (state.bombCooldown > 0) state.bombCooldown--;
    if (state.reflectorCooldown > 0) state.reflectorCooldown--;

    // tick down freeze and freeze cooldown
    if (state.fishFrozen > 0) state.fishFrozen--;
    if (state.freezeCooldown > 0) state.freezeCooldown--;

    // fish boss AI — spawns, chases, shoots, respawns harder each time
    const elapsed = now - state.gameStartTime;
    const fish = state.fish;

    if (state.fishHP <= 0 && fish.spawned) {
      fish.spawned = false;
      state.score += 50;
      state.projectiles = [];
      state.fishRespawnTime = now + 8000;
      state.fishMaxHP = Math.floor(state.fishMaxHP * 1.3);
    }
    if (!fish.spawned && state.fishRespawnTime > 0 && now >= state.fishRespawnTime) {
      fish.spawned = true;
      fish.x = state.playerX + 400;
      fish.y = H * 0.5;
      fish.speed = 0.4;
      fish.lastShot = now;
      state.fishHP = state.fishMaxHP;
      state.fishRespawnTime = 0;
    }

    if (!fish.spawned && elapsed >= FISH_SPAWN_DELAY && state.fishRespawnTime === 0) {
      fish.spawned = true; fish.x = state.playerX + 400; fish.y = H * 0.5; fish.speed = 0.4; fish.lastShot = now;
      state.fishHP = state.fishMaxHP;
    }
    if (fish.spawned && state.fishFrozen <= 0) {
      fish.speed = Math.min(0.4 + ((elapsed - FISH_SPAWN_DELAY) / 1000) * 0.012, 1.8);
      const pcx = state.playerX + CHAR_W / 2, pcy = -state.playerY + CHAR_H / 2;
      const dx = pcx - fish.x, dy = pcy - fish.y, dist = Math.sqrt(dx * dx + dy * dy);
      let eff = fish.speed;
      if (dist > 300) eff = fish.speed * (1 + (dist - 300) / 200);
      if (dist > 1) { fish.x += (dx / dist) * eff; fish.y += (dy / dist) * eff; }
      fish.rotation = Math.atan2(dy, dx);
      if (now - fish.lastShot > 2500 + Math.random() * 100 && dist > 60) {
        const roll = Math.random();
        let type = roll > 0.92 ? 'blue' : roll > 0.82 ? 'yellow' : 'red';
        state.projectiles.push({ id: 'fp' + now + Math.random(), x: fish.x, y: fish.y, vx: (dx / dist) * 2.5, vy: (dy / dist) * 2.5, type });
        fish.lastShot = now;
      }
      if (overlap(pL, pB, CHAR_W, CHAR_H, fish.x - 18, fish.y - 18, 36, 36)) { state.health = 0; state.phase = 'gameover'; onGameOver(); }
    }

    // reflector — flip projectile velocity on contact
    for (const ref of state.reflectors) {
      for (const p of state.projectiles) {
        if (p.reflected) continue;
        const rdx = p.x - ref.x, rdy = p.y - ref.y;
        if (Math.sqrt(rdx * rdx + rdy * rdy) < 16) {
          p.vx = -p.vx; p.vy = -p.vy;
          p.reflected = true;
        }
      }
    }

    const colRectsProj = getCollisionRects();
    state.projectiles = state.projectiles.filter(p => {
      p.x += p.vx; p.y += p.vy;
      if ((p.x - state.playerX) ** 2 + (p.y + state.playerY) ** 2 > 640000) return false;
      if (p.reflected && state.fish.spawned) {
        const rdx = p.x - state.fish.x, rdy = p.y - state.fish.y;
        if (Math.sqrt(rdx * rdx + rdy * rdy) < 20) { state.fishHP -= 15; return false; }
      }
      const ps = 6, plx = p.x - ps / 2, pby = p.y - ps / 2;
      if (p.type === 'red' || p.reflected) { for (const s of colRectsProj) { if (overlap(plx, pby, ps, ps, s.x, s.y, s.width, s.height)) return false; } }
      if (p.type === 'yellow' && !state.activeUpgrades.reinforce && !p.reflected) {
        const before = state.squares.length;
        state.squares = state.squares.filter(s => !overlap(plx, pby, ps, ps, s.x, s.y, s.width, s.height));
        if (state.grapple && state.squares.length < before && state.squares.indexOf(state.grapple.shape) === -1) {
          state.grapple = null;
          state.grappleCooldown = 90;
        }
      }
      if (!p.reflected && overlap(pL, pB, CHAR_W, CHAR_H, plx, pby, ps, ps)) {
        applyDamage(p.type === 'red' ? 12 : 6);
        return false;
      }
      return true;
    });

    // bug enemies
    if (window.BugSystem) {
      const BS = window.BugSystem;
      if (elapsed > 4000) {
        state.lastBugSpawn = BS.maybeSpawn(state.bugs, state.playerX, state.lastBugSpawn, now);
      }
      BS.updateAll(state.bugs, state.playerX, pB, state.squares, H, frameTick);
      const bugDmg = BS.checkPlayerCollision(state.bugs, pL, pB, CHAR_W, CHAR_H);
      if (bugDmg > 0) { applyDamage(bugDmg); }
    }
  }

  // render — called every frame after update
  let walkFrame = 0, walkTimer = 0;

  let lastPlayingClass = false;
  function render() {
    const isPlaying = state.phase === 'playing' || state.phase === 'paused';
    if (isPlaying !== lastPlayingClass) {
      gameWrapper.classList.toggle('game-playing', isPlaying);
      lastPlayingClass = isPlaying;
      requestAnimationFrame(resizeCanvas);
    }
    ctx.clearRect(0, 0, W, H);
    frameTick++;

    if (state.phase === 'menu') { fetchLeaderboard(); updateHotbarDOM(); drawMenu(); return; }

    const cam = state.cameraX;
    drawSkyAndStars(cam);

    ctx.strokeStyle = COL.dim;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1); ctx.stroke();

    // draw all platforms
    for (const s of state.squares) {
      if (s.shape === 'circle') {
        const cx = s.cx - cam, cy = H - s.cy;
        ctx.fillStyle = COL.ghost;
        ctx.beginPath(); ctx.arc(cx, cy, s.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = COL.dim; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, s.r, 0, Math.PI * 2); ctx.stroke();
      } else if (s.shape === 'triangle') {
        ctx.fillStyle = COL.ghost; ctx.strokeStyle = COL.dim; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.v1.x - cam, H - s.v1.y);
        ctx.lineTo(s.v2.x - cam, H - s.v2.y);
        ctx.lineTo(s.v3.x - cam, H - s.v3.y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (s.shape === 'line') {
        ctx.strokeStyle = COL.dim; ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(s.x1 - cam, H - s.y1);
        ctx.lineTo(s.x2 - cam, H - s.y2);
        ctx.stroke();
        ctx.strokeStyle = COL.primary; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x1 - cam, H - s.y1);
        ctx.lineTo(s.x2 - cam, H - s.y2);
        ctx.stroke();
      } else if (s.shape === 'bezier') {
        ctx.strokeStyle = COL.dim; ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(s.p0.x - cam, H - s.p0.y);
        ctx.quadraticCurveTo(s.p1.x - cam, H - s.p1.y, s.p2.x - cam, H - s.p2.y);
        ctx.stroke();
        ctx.strokeStyle = COL.primary; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.p0.x - cam, H - s.p0.y);
        ctx.quadraticCurveTo(s.p1.x - cam, H - s.p1.y, s.p2.x - cam, H - s.p2.y);
        ctx.stroke();
      } else if (s.shape === 'polygon') {
        ctx.fillStyle = COL.ghost; ctx.strokeStyle = COL.dim; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.vertices[0].x - cam, H - s.vertices[0].y);
        for (let vi = 1; vi < s.vertices.length; vi++) ctx.lineTo(s.vertices[vi].x - cam, H - s.vertices[vi].y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else {
        const sx = s.x - cam, sy = H - s.y - s.height;
        ctx.fillStyle = COL.ghost;
        ctx.fillRect(sx, sy, s.width, s.height);
        ctx.strokeStyle = COL.dim; ctx.lineWidth = 1;
        ctx.strokeRect(sx + 0.5, sy + 0.5, s.width - 1, s.height - 1);
      }
    }

    // show a preview while the player is dragging to draw
    if (state.isDragging && state.dragStart && state.dragCurrent) {
      const tool = getCurrentTool();
      const dw = Math.abs(state.dragCurrent.x - state.dragStart.x);
      const dh = Math.abs(state.dragCurrent.y - state.dragStart.y);
      ctx.setLineDash([5, 5]); ctx.strokeStyle = COL.mid; ctx.lineWidth = 1;

      if (tool === 'circle') {
        const ccx = (state.dragStart.x + state.dragCurrent.x) / 2 - cam;
        const ccy = H - (state.dragStart.y + state.dragCurrent.y) / 2;
        const r = Math.min(dw, dh) / 2;
        ctx.fillStyle = 'rgba(0,204,0,0.08)';
        ctx.beginPath(); ctx.arc(ccx, ccy, r, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ccx, ccy, r, 0, Math.PI * 2); ctx.stroke();
      } else if (tool === 'triangle') {
        const tsx = Math.min(state.dragStart.x, state.dragCurrent.x);
        const tsy = Math.min(state.dragStart.y, state.dragCurrent.y);
        ctx.fillStyle = 'rgba(0,204,0,0.08)';
        ctx.beginPath();
        ctx.moveTo(tsx + dw / 2 - cam, H - (tsy + dh));
        ctx.lineTo(tsx - cam, H - tsy);
        ctx.lineTo(tsx + dw - cam, H - tsy);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (tool === 'line') {
        ctx.beginPath();
        ctx.moveTo(state.dragStart.x - cam, H - state.dragStart.y);
        ctx.lineTo(state.dragCurrent.x - cam, H - state.dragCurrent.y);
        ctx.stroke();
      } else {
        const sx = Math.min(state.dragStart.x, state.dragCurrent.x) - cam;
        const sy = H - Math.max(state.dragStart.y, state.dragCurrent.y);
        ctx.fillStyle = 'rgba(0,204,0,0.08)';
        ctx.fillRect(sx, sy, dw, dh);
        ctx.strokeRect(sx, sy, dw, dh);
      }
      ctx.setLineDash([]);
    }

    // polygon preview — draw lines between clicked points
    if (state.polyPoints.length > 0) {
      ctx.setLineDash([5, 5]); ctx.strokeStyle = COL.cyan; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(state.polyPoints[0].x - cam, H - state.polyPoints[0].y);
      for (let pi = 1; pi < state.polyPoints.length; pi++) ctx.lineTo(state.polyPoints[pi].x - cam, H - state.polyPoints[pi].y);
      if (mouseOnCanvas) ctx.lineTo(mouseWorld.x - cam, H - mouseWorld.y);
      ctx.stroke(); ctx.setLineDash([]);
      for (const pp of state.polyPoints) {
        ctx.fillStyle = COL.cyan;
        ctx.beginPath(); ctx.arc(pp.x - cam, H - pp.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // bezier preview — show curve as you pick control points
    if (state.bezierPoints.length > 0 && state.bezierPoints.length < 3) {
      ctx.setLineDash([5, 5]); ctx.strokeStyle = COL.amber; ctx.lineWidth = 1;
      const bp = state.bezierPoints;
      if (bp.length === 1 && mouseOnCanvas) {
        ctx.beginPath();
        ctx.moveTo(bp[0].x - cam, H - bp[0].y);
        ctx.lineTo(mouseWorld.x - cam, H - mouseWorld.y);
        ctx.stroke();
      } else if (bp.length === 2 && mouseOnCanvas) {
        ctx.beginPath();
        ctx.moveTo(bp[0].x - cam, H - bp[0].y);
        ctx.quadraticCurveTo(mouseWorld.x - cam, H - mouseWorld.y, bp[1].x - cam, H - bp[1].y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const bpp of bp) {
        ctx.fillStyle = COL.amber;
        ctx.beginPath(); ctx.arc(bpp.x - cam, H - bpp.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // portals
    for (let i = 0; i < state.portals.length; i++) {
      const pt = state.portals[i];
      const ptx = pt.x - cam, pty = H - pt.y;
      const col = i === 0 ? COL.bright : COL.cyan;
      const glow = i === 0 ? COL.glowStrong : 'rgba(0,255,204,0.35)';
      const pulse = 0.7 + Math.sin(frameTick * 0.08 + i * 3) * 0.3;
      ctx.save();
      ctx.shadowColor = glow; ctx.shadowBlur = 18;
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = pulse;
      ctx.beginPath(); ctx.arc(ptx, pty, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = i === 0 ? COL.primary : COL.cyanPri; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(ptx, pty, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // Label
      ctx.fillStyle = col; ctx.font = '8px ' + FONT_MONO; ctx.textAlign = 'center';
      ctx.fillText(i === 0 ? 'A' : 'B', ptx, pty - 20); ctx.textAlign = 'left';
    }

    // coins
    const coinAssets = { 1: 'coin', 2: 'coin2', 3: 'coin3', 4: 'coin4' };
    for (const c of state.coins) {
      const img = assets[coinAssets[c.type]], cx = c.x - cam - 8, cy = H - c.y - 8;
      if (img && img.complete) ctx.drawImage(img, cx, cy, 16, 16);
      else { ctx.fillStyle = COL.amber; ctx.beginPath(); ctx.arc(cx + 8, cy + 8, 8, 0, Math.PI * 2); ctx.fill(); }
    }

    // heart pickups
    for (const h of state.hearts) {
      const hx = h.x - cam, hy = H - h.y;
      const pulse = 0.7 + Math.sin(frameTick * 0.08) * 0.3;
      const sz = 7;
      ctx.save();
      ctx.shadowColor = `rgba(255,51,51,${pulse * 0.6})`; ctx.shadowBlur = 12;
      ctx.fillStyle = `rgba(255,51,51,${0.6 + pulse * 0.4})`;
      ctx.beginPath();
      ctx.moveTo(hx, hy - sz * 0.3);
      ctx.bezierCurveTo(hx - sz, hy - sz * 1.2, hx - sz * 1.6, hy + sz * 0.2, hx, hy + sz);
      ctx.bezierCurveTo(hx + sz * 1.6, hy + sz * 0.2, hx + sz, hy - sz * 1.2, hx, hy - sz * 0.3);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = COL.red; ctx.font = '8px ' + FONT_MONO; ctx.textAlign = 'center';
      ctx.fillText('+' + h.heal + 'HP', hx, hy - 14); ctx.textAlign = 'left';
    }

    // upgrade pickups (drawn as a little diamond)
    for (const u of state.upgrades) {
      const def = UPGRADE_DEFS[u.key], ux = u.x - cam, uy = H - u.y;
      const pulse = 0.6 + Math.sin(frameTick * 0.06) * 0.3;
      const sz = 5;
      ctx.save();
      ctx.shadowColor = `rgba(0,255,204,${pulse * 0.5})`; ctx.shadowBlur = 10;
      ctx.fillStyle = `rgba(0,255,204,${pulse})`;
      ctx.beginPath();
      ctx.moveTo(ux, uy - sz); ctx.lineTo(ux + sz, uy); ctx.lineTo(ux, uy + sz); ctx.lineTo(ux - sz, uy);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = COL.bright; ctx.font = '9px ' + FONT_MONO; ctx.textAlign = 'center';
      ctx.fillText(def.name, ux, uy - 14); ctx.textAlign = 'left';
    }

    // bugs
    if (window.BugSystem && state.bugs.length > 0) {
      window.BugSystem.renderAll(ctx, state.bugs, cam, H, frameTick);
    }

    // reflectors
    for (const ref of state.reflectors) {
      const rx = ref.x - cam, ry = H - ref.y;
      const pulse = 0.6 + Math.sin(frameTick * 0.1) * 0.3;
      ctx.save();
      ctx.shadowColor = 'rgba(0,255,204,0.5)'; ctx.shadowBlur = 8;
      ctx.translate(rx, ry); ctx.rotate(-ref.angle);
      ctx.strokeStyle = COL.cyan; ctx.lineWidth = 3; ctx.globalAlpha = pulse;
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(12, 0); ctx.stroke();
      ctx.strokeStyle = COL.cyanPri; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-12, -4); ctx.lineTo(-12, 4);
      ctx.moveTo(12, -4); ctx.lineTo(12, 4);
      ctx.stroke();
      ctx.restore();
    }

    // bombs
    for (const b of state.bombs) {
      const bx = b.x - cam, by = H - b.y;
      if (b.exploding > 0) {
        const radius = (15 - b.exploding) * 6;
        const alpha = b.exploding / 15;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = COL.amber;
        ctx.shadowColor = 'rgba(255,204,0,0.6)'; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(bx, by, radius, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = COL.red;
        ctx.beginPath(); ctx.arc(bx, by, radius * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        const blink = b.timer < 60 && frameTick % 8 < 4;
        ctx.save();
        ctx.shadowColor = blink ? 'rgba(255,51,51,0.6)' : 'rgba(255,204,0,0.3)';
        ctx.shadowBlur = 8;
        ctx.fillStyle = blink ? COL.red : COL.amberDim;
        ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = COL.amber; ctx.font = '8px ' + FONT_MONO; ctx.textAlign = 'center';
        ctx.fillText(Math.ceil(b.timer / 60) + 's', bx, by - 10);
        ctx.textAlign = 'left';
        ctx.restore();
      }
    }

    // grapple rope
    if (state.grapple) {
      const g = state.grapple;
      const gpx = state.playerX + CHAR_W / 2 - cam, gpy = H - (-state.playerY) - CHAR_H / 2;
      const gtx = g.tx - cam, gty = H - g.ty;
      ctx.save();
      ctx.strokeStyle = COL.amber; ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(255,204,0,0.4)'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.moveTo(gpx, gpy); ctx.lineTo(gtx, gty); ctx.stroke();
      ctx.fillStyle = COL.amber;
      ctx.beginPath(); ctx.arc(gtx, gty, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // freeze ring around fish when frozen
    if (state.fishFrozen > 0 && state.fish.spawned) {
      const ffx = state.fish.x - cam, ffy = H - state.fish.y;
      ctx.save();
      ctx.strokeStyle = COL.cyan; ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(0,255,204,0.5)'; ctx.shadowBlur = 12;
      ctx.globalAlpha = 0.5 + Math.sin(frameTick * 0.15) * 0.3;
      ctx.beginPath(); ctx.arc(ffx, ffy, 24, 0, Math.PI * 2); ctx.stroke();
      ctx.font = '10px ' + FONT_MONO; ctx.fillStyle = COL.cyan; ctx.textAlign = 'center';
      ctx.fillText('\u2744', ffx, ffy - 26);
      ctx.textAlign = 'left';
      ctx.restore();
    }

    // dash afterimage
    if (state.dashActive > 0) {
      const dtx = state.playerX - cam, dty = H - (-state.playerY) - CHAR_H;
      ctx.save(); ctx.globalAlpha = 0.3;
      ctx.fillStyle = COL.amber;
      for (let di = 1; di <= 3; di++) {
        const off = di * 10 * (state.direction === 'right' ? -1 : 1);
        ctx.globalAlpha = 0.3 - di * 0.08;
        ctx.fillRect(dtx + off, dty, CHAR_W, CHAR_H);
      }
      ctx.restore();
    }

    // glide wing lines above player
    if (state.activeUpgrades.glide && !state.onGround && state.playerVY > 0 && (keys['Space'] || keys['ArrowUp'] || keys['KeyW'])) {
      const glx = state.playerX + CHAR_W / 2 - cam, gly = H - (-state.playerY) - CHAR_H - 4;
      ctx.save(); ctx.globalAlpha = 0.4;
      ctx.strokeStyle = COL.primary; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(glx - 14, gly + 8); ctx.lineTo(glx, gly); ctx.lineTo(glx + 14, gly + 8);
      ctx.stroke();
      ctx.restore();
    }

    // player sprite
    const isMoving = state.movingLeft || state.movingRight;
    const px = state.playerX - cam, py = H - (-state.playerY) - CHAR_H;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    if (state.direction === 'left') { ctx.translate(px + CHAR_W, py); ctx.scale(-1, 1); }
    else ctx.translate(px, py);
    let playerImg;
    if (isMoving) {
      walkTimer++;
      if (walkTimer > ((state.sprinting && state.activeUpgrades.sprint) ? 5 : 8)) { walkTimer = 0; walkFrame = (walkFrame + 1) % 3; }
      playerImg = assets[idleImages[walkFrame]];
    } else { playerImg = assets[state.idleImg]; walkFrame = 0; walkTimer = 0; }
    if (playerImg && playerImg.complete) ctx.drawImage(playerImg, 0, 0, CHAR_W, CHAR_H);
    else { ctx.fillStyle = COL.primary; ctx.fillRect(0, 0, CHAR_W, CHAR_H); }
    if (state.damageFlash > 0) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(255,51,51,${state.damageFlash / 12 * 0.6})`;
      ctx.fillRect(0, 0, CHAR_W, CHAR_H);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.imageSmoothingEnabled = true; ctx.restore();

    // sword swing animation
    if (state.swordSwing && state.swordSwing.frame <= 12) {
      const sw = state.swordSwing;
      const scx = state.playerX + CHAR_W / 2 - cam;
      const scy = H - (-state.playerY) - CHAR_H / 2;
      const dirMul = sw.direction === 'right' ? 1 : -1;
      const progress = sw.frame / 12;
      const baseAngle = sw.direction === 'right' ? -Math.PI / 3 : Math.PI + Math.PI / 3;
      const sweep = dirMul * Math.PI * 2 / 3 * progress;
      const len = 42;
      const alpha = sw.frame <= 8 ? 1 : 1 - (sw.frame - 8) / 4;
      const endX = scx + Math.cos(baseAngle + sweep) * len;
      const endY = scy + Math.sin(baseAngle + sweep) * len;

      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = COL.bright; ctx.lineWidth = 3;
      ctx.shadowColor = COL.glowStrong; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(scx, scy); ctx.lineTo(endX, endY); ctx.stroke();
      // arc trail behind the blade
      ctx.strokeStyle = COL.primary; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(scx, scy, len, baseAngle, baseAngle + sweep, dirMul < 0);
      ctx.stroke();
      ctx.restore();
    }

    // fish boss sprite + HP bar
    if (state.fish.spawned) {
      const fSize = 36, fx = state.fish.x - cam, fy = H - state.fish.y;
      ctx.save(); ctx.translate(fx, fy); ctx.rotate(-state.fish.rotation);
      ctx.shadowColor = 'rgba(255,51,51,0.5)'; ctx.shadowBlur = 16; ctx.imageSmoothingEnabled = false;
      const fImg = assets['evil_fish_eye'];
      if (fImg && fImg.complete) ctx.drawImage(fImg, -fSize / 2, -fSize / 2, fSize, fSize);
      else { ctx.fillStyle = COL.red; ctx.fillRect(-fSize / 2, -fSize / 2, fSize, fSize); }
      ctx.imageSmoothingEnabled = true; ctx.shadowBlur = 0; ctx.restore();

      // HP bar above the fish
      const fhpW = 30, fhpH = 3;
      const fhpX = fx - fhpW / 2, fhpY = fy - fSize / 2 - 8;
      ctx.fillStyle = COL.bgPanel; ctx.fillRect(fhpX, fhpY, fhpW, fhpH);
      ctx.fillStyle = COL.redDim;
      ctx.fillRect(fhpX, fhpY, fhpW * Math.max(0, state.fishHP / state.fishMaxHP), fhpH);
      ctx.strokeStyle = COL.redDim; ctx.lineWidth = 0.5;
      ctx.strokeRect(fhpX, fhpY, fhpW, fhpH);
    }

    // projectiles fired by the fish
    for (const p of state.projectiles) {
      const pSize = p.type === 'red' ? 6 : 8, ppx = p.x - cam - pSize / 2, ppy = H - p.y - pSize / 2;
      const colors = { red: COL.red, blue: '#4488ee', yellow: COL.amber };
      const glows = { red: COL.redGlow, blue: 'rgba(60,100,220,0.5)', yellow: 'rgba(255,204,0,0.3)' };
      ctx.save(); ctx.shadowColor = glows[p.type]; ctx.shadowBlur = 10; ctx.fillStyle = colors[p.type];
      if (p.type === 'blue') { ctx.beginPath(); ctx.arc(ppx + pSize / 2, ppy + pSize / 2, pSize / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(ppx, ppy, pSize, pSize);
      ctx.shadowBlur = 0; ctx.restore();
    }

    drawHUD();
    updateHotbarDOM();
    if (mouseOnCanvas) drawTooltips(cam);

    // game over screen
    if (state.phase === 'gameover') {
      ctx.fillStyle = 'rgba(0,0,0,0.88)'; ctx.fillRect(0, 0, W, H);

      const panelW = Math.min(420, W - 40), panelH = 236;
      const panelX = (W - panelW) / 2, panelY = (H - panelH) / 2;

      ctx.strokeStyle = COL.redDim; ctx.lineWidth = 1;
      ctx.strokeRect(panelX, panelY, panelW, panelH);
      ctx.fillStyle = COL.bgTerminal;
      ctx.fillRect(panelX + 1, panelY + 1, panelW - 2, panelH - 2);
      ctx.save(); ctx.shadowColor = COL.redGlow; ctx.shadowBlur = 16;
      ctx.strokeStyle = COL.redDim; ctx.strokeRect(panelX, panelY, panelW, panelH); ctx.restore();

      ctx.fillStyle = COL.redDim; ctx.fillRect(panelX + 1, panelY + 1, panelW - 2, 28);
      ctx.fillStyle = COL.red; ctx.font = '12px ' + FONT_MONO; ctx.textAlign = 'left';
      ctx.fillText('[X] SIGNAL LOST', panelX + 10, panelY + 19);

      ctx.save(); ctx.shadowColor = 'rgba(255,51,51,0.4)'; ctx.shadowBlur = 16;
      ctx.fillStyle = COL.red; ctx.font = 'bold 32px ' + FONT_DISPLAY; ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', W / 2, panelY + 80); ctx.restore();

      ctx.font = '13px ' + FONT_MONO; ctx.textAlign = 'center';
      ctx.fillStyle = COL.mid; ctx.fillText('FINAL SCORE', W / 2, panelY + 108);
      ctx.fillStyle = COL.bright; ctx.font = '20px ' + FONT_MONO;
      ctx.fillText(String(state.score), W / 2, panelY + 134);

      const goElapsed = Math.floor((Date.now() - state.gameStartTime) / 1000);
      ctx.fillStyle = COL.mid; ctx.font = '11px ' + FONT_MONO;
      ctx.fillText('TIME  ' + formatLeaderboardTime(goElapsed), W / 2, panelY + 158);

      if (menu.playerName) {
        ctx.fillStyle = COL.dim; ctx.font = '11px ' + FONT_MONO;
        ctx.fillText('PLAYER: ' + menu.playerName.toUpperCase(), W / 2, panelY + 178);
      }
      ctx.fillStyle = COL.shadow; ctx.font = '11px ' + FONT_MONO;
      ctx.fillText(frameTick % 60 < 30 ? '> PRESS ENTER TO CONTINUE_' : '> PRESS ENTER TO CONTINUE', W / 2, panelY + 208);
      ctx.textAlign = 'left';
    }

    // pause screen
    if (state.phase === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, W, H);

      const panelW = Math.min(360, W - 40), panelH = 180;
      const panelX = (W - panelW) / 2, panelY = (H - panelH) / 2;

      ctx.strokeStyle = COL.dim; ctx.lineWidth = 1;
      ctx.strokeRect(panelX, panelY, panelW, panelH);
      ctx.fillStyle = COL.bgTerminal;
      ctx.fillRect(panelX + 1, panelY + 1, panelW - 2, panelH - 2);
      ctx.save(); ctx.shadowColor = COL.glowWeak; ctx.shadowBlur = 16;
      ctx.strokeStyle = COL.dim; ctx.strokeRect(panelX, panelY, panelW, panelH); ctx.restore();

      ctx.fillStyle = COL.shadow; ctx.fillRect(panelX + 1, panelY + 1, panelW - 2, 28);
      ctx.fillStyle = COL.mid; ctx.font = '12px ' + FONT_MONO; ctx.textAlign = 'left';
      ctx.fillText('[\u2759\u2759] PAUSED', panelX + 10, panelY + 19);

      ctx.save(); ctx.shadowColor = COL.glowStrong; ctx.shadowBlur = 16;
      ctx.fillStyle = COL.bright; ctx.font = 'bold 28px ' + FONT_DISPLAY; ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, panelY + 74); ctx.restore();

      ctx.font = '12px ' + FONT_MONO; ctx.textAlign = 'center';
      ctx.fillStyle = COL.mid;
      ctx.fillText('ESC / ENTER / SPACE  \u2500  RESUME', W / 2, panelY + 115);
      ctx.fillStyle = COL.dim;
      ctx.fillText('Q  \u2500  QUIT TO MENU', W / 2, panelY + 140);

      const elapsed = Math.floor((state.pauseStart - state.gameStartTime) / 1000);
      ctx.fillStyle = COL.shadow; ctx.font = '10px ' + FONT_MONO;
      ctx.fillText('T+' + String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0') + '  \u2502  SCORE: ' + state.score, W / 2, panelY + 168);
      ctx.textAlign = 'left';
    }
  }

  // HUD — health bar, score, active upgrade tags, timer, coords
  function drawHUD() {
    const x = 10, y = 8;
    const hp = Math.max(0, state.health);
    const barW = 120, barH = 12;

    ctx.fillStyle = COL.mid; ctx.font = '10px ' + FONT_MONO;
    ctx.fillText('HP', x, y + 10);
    ctx.fillStyle = COL.bgPanel; ctx.fillRect(x + 22, y, barW, barH);
    ctx.strokeStyle = COL.dim; ctx.lineWidth = 1; ctx.strokeRect(x + 22, y, barW, barH);

    const fillW = barW * (hp / 100);
    ctx.fillStyle = hp > 50 ? COL.dim : hp > 25 ? COL.amberDim : COL.redDim;
    ctx.fillRect(x + 22, y, fillW, barH);
    ctx.fillStyle = COL.bgVoid;
    for (let sx = x + 22 + 4; sx < x + 22 + barW; sx += 5) ctx.fillRect(sx, y, 1, barH);

    if (hp <= 25 && hp > 0) {
      const pulse = Math.sin(frameTick * 0.15) * 0.3 + 0.5;
      ctx.fillStyle = `rgba(255,51,51,${pulse * 0.2})`; ctx.fillRect(x + 22, y, fillW, barH);
    }

    ctx.fillStyle = hp > 50 ? COL.primary : hp > 25 ? COL.amberPri : COL.red;
    ctx.font = '10px ' + FONT_MONO;
    ctx.fillText(hp + '%', x + 22 + barW + 6, y + 10);

    const scoreX = x + 22 + barW + 50;
    ctx.fillStyle = COL.mid; ctx.font = '10px ' + FONT_MONO; ctx.fillText('SCORE:', scoreX, y + 10);
    ctx.fillStyle = COL.bright;
    ctx.save(); ctx.shadowColor = COL.glowWeak; ctx.shadowBlur = 6;
    ctx.fillText(String(state.score), scoreX + 52, y + 10); ctx.restore();

    let tagX = scoreX + 52 + ctx.measureText(String(state.score)).width + 16;
    ctx.font = '9px ' + FONT_MONO;
    const tags = [
      ['doubleJump', '2xJUMP', COL.cyanPri, COL.cyan],
      ['sprint', 'SPRINT', COL.amberDim, COL.amber],
      ['wallClimb', 'WALLCLIMB', COL.cyanPri, COL.cyan],
      ['glide', 'GLIDE', COL.cyanPri, COL.cyan],
      ['coinMagnet', 'MAGNET', COL.amberDim, COL.amber],
      ['dash', 'DASH', COL.amberDim, COL.amber],
      ['armor', 'ARMOR', COL.dim, COL.primary],
      ['regen', 'REGEN', COL.dim, COL.primary],
      ['reinforce', 'REINF', COL.dim, COL.primary],
    ];
    for (const [key, label, bc, tc] of tags) {
      if (state.activeUpgrades[key]) { drawTag(tagX, y, label, bc, tc); tagX += ctx.measureText(label).width + 16; }
    }

    ctx.fillStyle = COL.shadow; ctx.font = '9px ' + FONT_MONO;
    const elapsed = Math.floor((Date.now() - state.gameStartTime) / 1000);
    ctx.fillText('T+' + String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0'), 10, H - 8);
    ctx.textAlign = 'right';
    ctx.fillText('X:' + Math.floor(state.playerX) + ' Y:' + Math.floor(-state.playerY), W - 10, H - 8);
    ctx.textAlign = 'left';
  }

  function drawTag(x, y, label, borderCol, textCol) {
    const tw = ctx.measureText(label).width + 8;
    ctx.strokeStyle = borderCol; ctx.lineWidth = 1; ctx.strokeRect(x, y, tw, 12);
    ctx.fillStyle = textCol; ctx.fillText(label, x + 4, y + 10);
  }


  // hover tooltips on nearby pickups
  function drawTooltips(cam) {
    for (const c of state.coins) {
      const dx = mouseWorld.x - c.x, dy = mouseWorld.y - c.y;
      if (dx * dx + dy * dy < 400) {
        ctx.fillStyle = COL.amber; ctx.font = '10px ' + FONT_MONO; ctx.textAlign = 'center';
        ctx.fillText('+' + (COIN_VALUES[c.type] || 1), c.x - cam, H - c.y - 16);
        ctx.textAlign = 'left'; break;
      }
    }
    for (const h of state.hearts) {
      const dx = mouseWorld.x - h.x, dy = mouseWorld.y - h.y;
      if (dx * dx + dy * dy < 400) {
        ctx.fillStyle = COL.red; ctx.font = '10px ' + FONT_MONO; ctx.textAlign = 'center';
        ctx.fillText('HEAL +' + h.heal, h.x - cam, H - h.y - 20);
        ctx.textAlign = 'left'; break;
      }
    }
    for (const u of state.upgrades) {
      const dx = mouseWorld.x - u.x, dy = mouseWorld.y - u.y;
      if (dx * dx + dy * dy < 576) {
        const def = UPGRADE_DEFS[u.key], canAfford = state.score >= def.cost;
        ctx.font = '10px ' + FONT_MONO; ctx.textAlign = 'center';
        ctx.fillStyle = canAfford ? COL.bright : COL.red;
        ctx.fillText('COST: ' + def.cost, u.x - cam, H - u.y - 26);
        ctx.textAlign = 'left'; break;
      }
    }
  }

  // sky gradient + stars
  function drawSkyAndStars(cam) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#020408'); grad.addColorStop(0.5, '#040810'); grad.addColorStop(1, '#060c18');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    for (const s of starPositions) {
      const sx = ((s.x - cam * s.parallax) % (W + 200) + W + 200) % (W + 200);
      const twinkle = s.brightness + Math.sin(frameTick * 0.02 + s.x) * 0.1;
      const a = Math.max(0.05, twinkle);
      ctx.fillStyle = s.x % 3 < 1 ? `rgba(100,210,120,${a * 0.6})` : `rgba(180,190,210,${a})`;
      ctx.beginPath(); ctx.arc(sx, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  // main menu draw
  function getCatColor(catId) {
    if (catId === 'shapes')   return { pri: COL.cyan,  dim: COL.cyanDim };
    if (catId === 'weapons')  return { pri: COL.red,   dim: COL.redDim };
    if (catId === 'movement') return { pri: COL.amber, dim: COL.amberDim };
    return { pri: COL.primary, dim: COL.dim };
  }

  function drawMenu() {
    ctx.fillStyle = COL.bgVoid; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(0,153,0,${0.01 + Math.random() * 0.02})`;
      ctx.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1);
    }

    const cx = W / 2;
    const chrome = getMenuChrome();
    const { padX, padY, titleY, compact } = chrome;

    ctx.strokeStyle = COL.shadow; ctx.lineWidth = 1;
    ctx.strokeRect(padX, padY, W - 2 * padX, H - 2 * padY);
    ctx.fillStyle = COL.shadow; ctx.font = '9px ' + FONT_MONO;
    ctx.textAlign = 'left'; ctx.fillText('WEYLAND YUTANI CORP', padX + 8, padY - 2);
    ctx.textAlign = 'right'; ctx.fillText('VER/1.0.0', W - padX - 8, padY + 16);

    ctx.save(); ctx.shadowColor = COL.glowStrong; ctx.shadowBlur = 20;
    ctx.fillStyle = COL.bright;
    ctx.font = `bold ${compact ? 34 : 48}px ` + FONT_DISPLAY;
    ctx.textAlign = 'center';
    ctx.fillText('SHAPESCAPE', cx, titleY); ctx.restore();

    ctx.strokeStyle = COL.dim; ctx.lineWidth = 1;
    const ruleHalf = compact ? Math.min(130, W * 0.34) : 180;
    ctx.beginPath(); ctx.moveTo(cx - ruleHalf, titleY + 16); ctx.lineTo(cx + ruleHalf, titleY + 16); ctx.stroke();

    const layout = getMenuLayout();
    const items = getMenuItems();
    const scrollY = getMenuScrollY();
    const { rowW, rowX } = getMenuContentRect();
    const rowPad = 10;
    const colL = rowX + rowPad;
    const colR = rowX + rowW - rowPad;
    const colMidL = rowX + Math.min(130, rowW * 0.38);
    const colMidR = rowX + rowW - rowPad;

    ctx.save();
    ctx.translate(0, -scrollY);

    for (let i = 0; i < items.length; i++) {
      const row = layout[i], selected = i === menu.selectedIndex, item = items[i];
      const isCat = item.startsWith('cat_');
      const isCheat = item.startsWith('cheat_');
      const isSmall = isCheat;
      const rowH = isSmall ? 20 : 32;
      const rowHalf = rowH / 2;

      if (item === 'name') {
        ctx.fillStyle = COL.dim; ctx.font = '11px ' + FONT_MONO; ctx.textAlign = 'center';
        ctx.fillText('\u2500\u2500  PLAYER  \u2500\u2500', cx, row.y - 18);
      }

      if (selected) {
        ctx.fillStyle = COL.ghost; ctx.fillRect(rowX, row.y - rowHalf, rowW, rowH);
        ctx.strokeStyle = COL.shadow; ctx.lineWidth = 1; ctx.strokeRect(rowX, row.y - rowHalf, rowW, rowH);
        ctx.fillStyle = COL.bright; ctx.font = (isSmall ? '11' : '14') + 'px ' + FONT_MONO; ctx.textAlign = 'left';
        ctx.fillText('>', colL - 2, row.y + (isSmall ? 4 : 5));
      }

      const textColor = selected ? COL.bright : COL.mid;

      if (item === 'start') {
        let startPx = compact ? 15 : 18;
        if (rowW < 260) startPx = 13;
        if (rowW < 200) startPx = 11;
        ctx.textAlign = 'center';
        ctx.fillStyle = textColor;
        for (;;) {
          ctx.font = startPx + 'px ' + FONT_MONO;
          if (ctx.measureText('START GAME').width <= rowW - 16 || startPx <= 9) break;
          startPx--;
        }
        ctx.save(); if (selected) { ctx.shadowColor = COL.glowStrong; ctx.shadowBlur = 10; }
        ctx.fillText('START GAME', cx, row.y + 7); ctx.restore();
      } else if (isCat) {
        const catId = item.slice(4);
        const cat = CHEAT_CATEGORIES.find(c => c.id === catId);
        const cc = getCatColor(catId);
        const expanded = menu.expanded[catId];
        const arrow = expanded ? '\u25BC' : '\u25B6';
        const onCount = cat.keys.filter(k => menu.cheats[k]).length;
        ctx.fillStyle = selected ? COL.bright : cc.pri;
        ctx.font = (rowW < 280 ? '11px ' : '13px ') + FONT_MONO; ctx.textAlign = 'left';
        ctx.fillText(arrow + ' ' + cat.label, colL, row.y + 5);
        ctx.fillStyle = cc.dim; ctx.font = '9px ' + FONT_MONO;
        ctx.fillText(cat.keys.length + ' ITEMS', colMidL, row.y + 5);
        if (onCount > 0) {
          ctx.fillStyle = cc.pri; ctx.font = 'bold 10px ' + FONT_MONO; ctx.textAlign = 'right';
          ctx.fillText(onCount + ' ON', colMidR, row.y + 5);
        }
      } else if (isCheat) {
        const key = item.slice(6);
        const def = UPGRADE_DEFS[key], on = menu.cheats[key];
        ctx.fillStyle = on ? (selected ? COL.bright : COL.primary) : (selected ? COL.dim : COL.shadow);
        ctx.font = '11px ' + FONT_MONO; ctx.textAlign = 'left';
        const nameX = colL + (selected ? 10 : 0);
        let label = def.name;
        const maxNameW = rowW - rowPad * 2 - 36;
        while (label.length > 4 && ctx.measureText(label).width > maxNameW) label = label.slice(0, -2) + '\u2026';
        ctx.fillText(label, nameX, row.y + 4);
        if (on) {
          ctx.fillStyle = COL.bright; ctx.save(); ctx.shadowColor = COL.glowWeak; ctx.shadowBlur = 4;
          ctx.font = 'bold 11px ' + FONT_MONO; ctx.textAlign = 'right';
          ctx.fillText('ON', colMidR, row.y + 4); ctx.restore();
        } else {
          ctx.fillStyle = COL.shadow; ctx.font = '11px ' + FONT_MONO; ctx.textAlign = 'right';
          ctx.fillText('OFF', colMidR, row.y + 4);
        }
      } else if (item === 'name') {
        ctx.fillStyle = textColor; ctx.font = (rowW < 300 ? '12px ' : '14px ') + FONT_MONO; ctx.textAlign = 'left';
        ctx.fillText('NAME:', colL, row.y + 6);
        const nameVal = menu.playerName || (menu.nameActive ? '' : 'ANONYMOUS');
        ctx.fillStyle = menu.playerName ? textColor : (selected ? COL.dim : COL.shadow);
        const cursorChar = menu.nameActive && frameTick % 50 < 25 ? '\u2588' : '';
        let base = menu.nameActive ? menu.playerName.toUpperCase() : nameVal;
        const nameStartX = colL + ctx.measureText('NAME: ').width;
        const maxNm = colR - nameStartX;
        while (base.length > 0 && ctx.measureText(base + cursorChar).width > maxNm) base = base.slice(0, -1);
        ctx.fillText(base + cursorChar, nameStartX, row.y + 6);
      }
    }

    ctx.restore();

    if (hasCheatsEnabled()) {
      const lastRow = layout.length > 0 ? layout[layout.length - 1] : null;
      const warnY = (lastRow ? lastRow.y - scrollY + 48 : titleY + 120);
      ctx.save(); ctx.shadowColor = 'rgba(255,204,0,0.25)'; ctx.shadowBlur = 8;
      ctx.fillStyle = COL.amber; ctx.font = 'bold 13px ' + FONT_MONO; ctx.textAlign = 'center';
      ctx.fillText('\u26A0 CHEATS ENABLED', cx, warnY);
      ctx.restore();
      ctx.fillStyle = COL.amberDim; ctx.font = '11px ' + FONT_MONO; ctx.textAlign = 'center';
      ctx.fillText('SCORE WILL NOT SUBMIT TO LEADERBOARD', cx, warnY + 18);
      ctx.textAlign = 'left';
    }

    // glitch effect when navigating the menu
    const glitchAge = frameTick - menu.glitchFrame;
    if (glitchAge < 12) {
      const alpha = 1 - glitchAge / 12;
      for (const g of menu.glitchLines) {
        if (Math.random() > 0.7) continue;
        ctx.fillStyle = `rgba(0,204,0,${alpha * g.bright * 0.5})`;
        ctx.fillRect(g.xOff + Math.random() * 6, g.y + (Math.random() - 0.5) * 4, g.w, g.h);
        ctx.fillStyle = `rgba(255,51,51,${alpha * g.bright * 0.12})`;
        ctx.fillRect(g.xOff + 2 + Math.random() * 4, g.y - 1, g.w * 0.7, g.h * 0.6);
      }
    }

    // leaderboard panel — sits to the side if there's space, otherwise below the menu
    if (DREAMLO_PUBLIC) {
      const menuRight = (W + rowW) / 2;
      const sideSpace = W - menuRight - padX - 50;
      const isSide = sideSpace >= 120;

      let lbX, lbY, lbW, lbH;
      if (isSide) {
        lbW = Math.min(216, sideSpace);
        const gap = W - padX - menuRight;
        lbX = menuRight + (gap - lbW) / 2;
        lbY = titleY - 10;
        lbH = Math.min(H - lbY - 60, 340);
      } else {
        lbW = Math.min(rowW, W - 2 * padX - 20);
        lbX = (W - lbW) / 2;
        const lastRow = layout.length > 0 ? layout[layout.length - 1] : null;
        const menuBottom = lastRow ? lastRow.y - scrollY + 44 : titleY + 120;
        lbY = menuBottom + 12;
        lbH = Math.min(H - lbY - 50, 180);
      }

      if (lbW >= 100 && lbH >= 60) {
        ctx.fillStyle = COL.bgPanel;
        ctx.fillRect(lbX, lbY, lbW, lbH);
        ctx.strokeStyle = COL.shadow; ctx.lineWidth = 1;
        ctx.strokeRect(lbX, lbY, lbW, lbH);

        ctx.fillStyle = COL.shadow; ctx.fillRect(lbX + 1, lbY + 1, lbW - 2, 22);
        ctx.fillStyle = COL.cyan; ctx.font = 'bold 10px ' + FONT_MONO; ctx.textAlign = 'center';
        ctx.fillText('\u2261 TOP SCORES', lbX + lbW / 2, lbY + 15);

        ctx.textAlign = 'left';
        const entryH = 20;
        const nameMaxW = lbW - 88;
        const maxEntries = Math.floor((lbH - 30) / entryH);

        if (menu.lbLoading && menu.leaderboard.length === 0) {
          ctx.fillStyle = COL.dim; ctx.font = '9px ' + FONT_MONO; ctx.textAlign = 'center';
          ctx.fillText('LOADING...', lbX + lbW / 2, lbY + 50);
        } else if (menu.lbError && menu.leaderboard.length === 0) {
          ctx.fillStyle = COL.redDim; ctx.font = '9px ' + FONT_MONO; ctx.textAlign = 'center';
          ctx.fillText('OFFLINE', lbX + lbW / 2, lbY + 50);
        } else if (menu.leaderboard.length === 0) {
          ctx.fillStyle = COL.dim; ctx.font = '9px ' + FONT_MONO; ctx.textAlign = 'center';
          ctx.fillText('NO SCORES YET', lbX + lbW / 2, lbY + 50);
        } else {
          for (let li = 0; li < Math.min(menu.leaderboard.length, maxEntries); li++) {
            const entry = menu.leaderboard[li];
            const ey = lbY + 30 + li * entryH;
            const isTop3 = li < 3;

            ctx.fillStyle = isTop3 ? COL.cyanDim : COL.shadow;
            ctx.font = '9px ' + FONT_MONO;
            ctx.fillText((li + 1) + '.', lbX + 6, ey + 13);

            let eName = (entry.name || '???').toUpperCase();
            ctx.font = (isTop3 ? 'bold ' : '') + '10px ' + FONT_MONO;
            ctx.fillStyle = isTop3 ? COL.cyan : COL.mid;
            while (eName.length > 2 && ctx.measureText(eName).width > nameMaxW) eName = eName.slice(0, -2) + '\u2026';
            ctx.fillText(eName, lbX + 22, ey + 13);

            const timeStr = entry.timeSec != null ? formatLeaderboardTime(entry.timeSec) : '--:--';
            const scoreStr = String(entry.score);
            const statsX = lbX + lbW - 6;
            const rowY = ey + 13;
            ctx.font = (isTop3 ? 'bold ' : '') + '10px ' + FONT_MONO;
            ctx.textAlign = 'right';
            ctx.fillStyle = isTop3 ? COL.bright : COL.primary;
            ctx.fillText(scoreStr, statsX, rowY);
            const scoreW = ctx.measureText(scoreStr).width;
            ctx.fillStyle = isTop3 ? COL.cyanDim : COL.shadow;
            ctx.font = '10px ' + FONT_MONO;
            ctx.fillText(timeStr + '  ', statsX - scoreW, rowY);
            ctx.textAlign = 'left';
          }
        }

        if (menu.lbLoading) {
          const dotCount = 1 + (Math.floor(frameTick / 20) % 3);
          ctx.fillStyle = COL.dim; ctx.font = '8px ' + FONT_MONO; ctx.textAlign = 'center';
          ctx.fillText('\u2022'.repeat(dotCount), lbX + lbW / 2, lbY + lbH - 6);
        }
      }
    }

    const footBase = H - padY;
    ctx.fillStyle = COL.shadow; ctx.font = '9px ' + FONT_MONO;
    ctx.textAlign = 'left'; ctx.fillText('SYS: SHAPESCAPE v1.0', padX + 8, footBase - 10);
    ctx.textAlign = 'right'; ctx.fillText('STATUS: READY', W - padX - 8, footBase - 10);
    ctx.textAlign = 'left'; ctx.fillText('> ' + (frameTick % 180 < 90 ? '\u2588' : ' '), padX + 8, padY + 20);

    ctx.fillStyle = COL.shadow; ctx.font = (compact ? '8px ' : '10px ') + FONT_MONO; ctx.textAlign = 'center';
    if (compact) {
      ctx.fillText('TAP ROW TO SELECT', cx, footBase - 34);
      ctx.fillText('IN GAME: HOTBAR + DRAG TO DRAW / USE TOOLS', cx, footBase - 20);
    } else {
      ctx.fillText('\u2191\u2193 NAVIGATE    ENTER SELECT    A/D MOVE    SPACE JUMP    SHIFT SPRINT    E DASH    ESC PAUSE', cx, footBase - 36);
      ctx.fillText('1-9 TOOLS    SCROLL CYCLE    CLICK+DRAG PLATFORMS    HOLD JUMP TO GLIDE', cx, footBase - 22);
    }
    ctx.textAlign = 'left';
  }

  // main loop
  function loop() { update(); render(); requestAnimationFrame(loop); }
  loadAssets(() => { loop(); });
})();
