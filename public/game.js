(function () {
  const canvas = document.getElementById('game');
  const crtCanvas = document.getElementById('crt-overlay');
  const ctx = canvas.getContext('2d');
  const container = document.getElementById('canvas-container');
  const gameWrapper = document.getElementById('game-wrapper');

  let W, H;

  // leaderboard keys — grab free ones at dreamlo.com. Module in public/leaderboard.js.
  //yes the keys are plaintext, technically you could add a fake score
  //if you beat the top score you got a free bakery item
  //but if you are reading this then email me via my website samfitch.com with the message 'THE CAKE IS A LIE'
  const leaderboardApi = window.LeaderboardSystem({
    private: '9fabDNnmmUufX_-XHl0eMQ5Rz-jJwYBEirxhcAQEpRZg',
    public: '69dd567a8f40bc2f605dff31',
  });
  const formatLeaderboardTime = leaderboardApi.formatTime;
  const CRT_PREF_KEY = 'shapescape_crt_enabled';

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
  let crtRenderer = null;

  // FPS tracking for the multiplayer "stats for nerds" HUD
  const fpsMeter = { samples: [], lastAt: 0, value: 0 };
  function tickFps(now) {
    if (fpsMeter.lastAt > 0) {
      const dt = now - fpsMeter.lastAt;
      if (dt > 0 && dt < 1000) fpsMeter.samples.push(dt);
      if (fpsMeter.samples.length > 60) fpsMeter.samples.shift();
    }
    fpsMeter.lastAt = now;
    if (fpsMeter.samples.length >= 10) {
      let sum = 0;
      for (const s of fpsMeter.samples) sum += s;
      fpsMeter.value = 1000 / (sum / fpsMeter.samples.length);
    }
  }

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
    if (crtRenderer) crtRenderer.resize(cw, ch, dpr);
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
    'idle_1', 'idle_2', 'idle_2_crouch', 'idle_3',
    'crouch_walk_0', 'crouch_walk_1', 'crouch_walk_2', 'crouch_walk_3',
    'coin', 'coin2', 'coin3', 'coin4',
    'dead',
  ];
  let assetsLoaded = 0;

  function loadAssets(onDone) {
    assetList.forEach(name => {
      const img = new Image();
      img.src = name + '.png';
      img.onload = () => { assetsLoaded++; if (assetsLoaded >= assetList.length) onDone(); };
      img.onerror = () => { assetsLoaded++; if (assetsLoaded >= assetList.length) onDone(); };
      assets[name] = img;
    });
  }

  // visuals — the simulation lives in src/sim and doesn't need movement constants here.
  const CHAR_W = 32;
  const CHAR_H = 32;
  /** Collision/visual feet-aligned height while crouching (standing uses CHAR_H). */
  const CHAR_H_CROUCH = 20;
  const idleImages = ['idle_1', 'idle_2', 'idle_3'];
  const crouchWalkImages = ['crouch_walk_0', 'crouch_walk_1', 'crouch_walk_2', 'crouch_walk_3'];
  /** Sprite tier → score value (mirrors coinTypeFromValue). Used only for the tooltip overlay. */
  const COIN_VALUES = { 1: 1, 2: 5, 3: 10, 4: 15 };

  /** World units — hold Option/Alt while drawing to snap to this grid (and snap line angles). */
  const DRAW_SNAP_GRID = 16;

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
    laser:     { name: 'LASER',     icon: '\u2301' },
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
    laser:      { name: 'LASER GUN',   cost: 50,  type: 'tool', tool: 'laser' },
  };

  // menu state
  const ALL_CHEAT_KEYS = Object.keys(UPGRADE_DEFS);

  const CHEAT_CATEGORIES = [
    { id: 'shapes',   label: 'SHAPES',   keys: ['circle','triangle','line','bezier','polygon','eraser'] },
    { id: 'weapons',  label: 'WEAPONS',  keys: ['sword','bomb','reflector','freeze','laser'] },
    { id: 'movement', label: 'MOVEMENT', keys: ['doubleJump','sprint','wallClimb','glide','dash'] },
    { id: 'utility',  label: 'UTILITY',  keys: ['portal','grapple','coinMagnet','armor','regen','reinforce'] },
  ];

  const menu = {
    playerName: '',
    activeField: '',
    multiplayerMode: false,
    crtEnabled: false,
    crtSupported: false,
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
    scrollY: 0,
    userScrolled: false,
  };
  for (const k of ALL_CHEAT_KEYS) menu.cheats[k] = false;
  for (const cat of CHEAT_CATEGORIES) menu.expanded[cat.id] = false;

  const multiplayer = {
    available: !!(window.ShapescapeSession && window.ShapescapeSession.startMultiplayer),
    active: false,
    connected: false,
    session: null,
    snapshot: null,
    localId: '',
    remotePlayers: [],
    status: 'OFFLINE',
    roomCode: '',
    host: (() => {
      const saved = localStorage.getItem('shapescape_partykit_host') || '';
      // Older builds accidentally persisted location.host (*.vercel.app) here; those
      // values point at nothing and must never be used as a PartyKit host.
      if (/\.vercel\.app$/i.test(saved)) {
        localStorage.removeItem('shapescape_partykit_host');
        return '';
      }
      return saved;
    })(),
    mode: 'coop',
    playerNotifs: [],      // { text, joinedAt, type:'join'|'leave' }
    prevPlayerIds: null,   // Map<id, name> — null until first snapshot
  };

  const session = {
    active: false,
    handle: null,
    kind: null,
    localId: '',
    input: { left: false, right: false, jump: false, sprint: false, crouch: false, dash: false },
  };

  function sessionActive() {
    return session.active && session.handle !== null;
  }

  function sessionSend(message) {
    if (!sessionActive()) return false;
    session.handle.send(message);
    return true;
  }

  function sessionSendInput() {
    if (!sessionActive()) return;
    session.handle.sendInput(Object.assign({}, session.input));
  }

  // --- live draft preview broadcasting --------------------------------------
  // While the local player is dragging a shape / placing polygon vertices,
  // we mirror the in-progress preview to the server so every other player
  // can see what's being drawn before it's committed. Updates are throttled
  // to avoid spamming the wire with a packet per mousemove — the preview
  // only has to look continuous, not frame-perfect.
  const DRAFT_THROTTLE_MS = 60;
  let lastDraftSentAt = 0;
  let lastDraftSentKey = '';

  function draftTool() {
    const tool = getCurrentTool();
    return tool === 'square' ? 'square' : tool;
  }

  function computeLocalDraft() {
    if (state.phase !== 'playing') return null;
    const tool = getCurrentTool();
    if (state.isDragging && state.dragStart && state.dragCurrent
        && (tool === 'square' || tool === 'circle' || tool === 'triangle' || tool === 'line')) {
      return {
        tool: draftTool(),
        start: { x: state.dragStart.x, y: state.dragStart.y },
        end: { x: state.dragCurrent.x, y: state.dragCurrent.y },
      };
    }
    if (tool === 'polygon' && state.polyPoints.length > 0) {
      return {
        tool: 'polygon',
        points: state.polyPoints.map(p => ({ x: p.x, y: p.y })),
        cursor: mouseOnCanvas ? { x: mouseWorld.x, y: mouseWorld.y } : undefined,
      };
    }
    if (tool === 'bezier' && state.bezierPoints.length > 0 && state.bezierPoints.length < 3) {
      return {
        tool: 'bezier',
        points: state.bezierPoints.map(p => ({ x: p.x, y: p.y })),
        cursor: mouseOnCanvas ? { x: mouseWorld.x, y: mouseWorld.y } : undefined,
      };
    }
    return null;
  }

  // Cheap stringification used only for change-detection. Rounding to whole
  // pixels keeps sub-pixel mouse jitter from triggering a network send.
  function draftKey(draft) {
    if (!draft) return '';
    const r = (p) => p ? (Math.round(p.x) + ',' + Math.round(p.y)) : '';
    let k = draft.tool + '|' + r(draft.start) + '|' + r(draft.end) + '|' + r(draft.cursor);
    if (draft.points) k += '|' + draft.points.map(r).join(';');
    return k;
  }

  function maybeSendDraftUpdate() {
    if (!sessionActive() || session.kind !== 'network') return;
    const draft = computeLocalDraft();
    const key = draftKey(draft);
    if (key === lastDraftSentKey) return;
    const now = performance.now();
    // Always send the clearing update (key === '') immediately so peers don't
    // see a frozen ghost preview hanging in the world after we stop drafting.
    if (key !== '' && now - lastDraftSentAt < DRAFT_THROTTLE_MS) return;
    lastDraftSentKey = key;
    lastDraftSentAt = now;
    sessionSend({ type: 'drawUpdate', draft });
  }

  function getMultiplayerPanelReserve() {
    return 0;
  }

  function ensureMultiplayerPanel() {
    return null;
  }

  function setInputValueIfIdle(el, value) {
    return;
  }

  function syncMultiplayerPanel() {
    return;
  }

  function isMenuTextItem(item) {
    return item === 'name' || item === 'mp_room' || item === 'mp_host';
  }

  function isSelectableMenuItem(item) {
    if (item === 'mp_status') return false;
    if (item === 'mp_join' && multiplayer.active) return false;
    if (item === 'mp_matchmode' && isMatchModeLocked()) return false;
    if ((item === 'mp_room' || item === 'mp_host') && multiplayer.active) return false;
    return true;
  }

  function isMatchModeLocked() {
    return !!(multiplayer.active
      && multiplayer.snapshot
      && multiplayer.snapshot.hostId
      && multiplayer.snapshot.hostId !== multiplayer.localId);
  }

  function getMenuTextValue(item) {
    if (item === 'name') return menu.playerName || '';
    if (item === 'mp_room') return multiplayer.roomCode || '';
    if (item === 'mp_host') return multiplayer.host || '';
    return '';
  }

  function isMultiplayerMenuItem(item) {
    return item.startsWith('mp_');
  }

  function setMenuTextValue(item, value) {
    if (item === 'name') {
      menu.playerName = value.slice(0, 16);
      return;
    }
    if (item === 'mp_room') {
      multiplayer.roomCode = value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12);
      return;
    }
    if (item === 'mp_host') {
      multiplayer.host = value.replace(/\s+/g, '').slice(0, 120);
      localStorage.setItem('shapescape_partykit_host', multiplayer.host);
    }
  }

  // Hidden DOM input used to summon the mobile virtual keyboard when editing
  // menu text fields. We mirror menu.activeField state into .focus()/.blur()
  // and sync characters via the input event to avoid double-entry with the
  // window-level keydown handler.
  const menuTextInput = document.getElementById('menu-text-input');
  let menuInputSyncing = false;

  function menuTextInputFocused() {
    return !!menuTextInput && document.activeElement === menuTextInput;
  }

  function setActiveField(field) {
    const next = field || '';
    menu.activeField = next;
    if (!menuTextInput) return;
    if (next) {
      menuInputSyncing = true;
      menuTextInput.value = getMenuTextValue(next);
      menuTextInput.setAttribute('autocapitalize', next === 'mp_host' ? 'off' : 'characters');
      menuTextInput.setAttribute('inputmode', next === 'mp_host' ? 'url' : 'text');
      try { menuTextInput.focus({ preventScroll: true }); }
      catch (_) { menuTextInput.focus(); }
      menuInputSyncing = false;
    } else if (menuTextInputFocused()) {
      menuTextInput.blur();
    }
  }

  if (menuTextInput) {
    menuTextInput.addEventListener('input', () => {
      if (menuInputSyncing || !menu.activeField) return;
      setMenuTextValue(menu.activeField, menuTextInput.value);
      const normalized = getMenuTextValue(menu.activeField);
      if (menuTextInput.value !== normalized) {
        menuInputSyncing = true;
        menuTextInput.value = normalized;
        menuInputSyncing = false;
      }
    });
    menuTextInput.addEventListener('blur', () => {
      if (menu.activeField) menu.activeField = '';
    });
    menuTextInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'Escape') {
        e.preventDefault();
        menuTextInput.blur();
      }
    });
  }

  function normalizeMenuSelection() {
    const items = getMenuItems();
    if (!items.length) {
      menu.selectedIndex = 0;
      return;
    }
    menu.selectedIndex = Math.max(0, Math.min(menu.selectedIndex, items.length - 1));
    if (isSelectableMenuItem(items[menu.selectedIndex])) return;
    for (let i = 0; i < items.length; i++) {
      if (isSelectableMenuItem(items[i])) {
        menu.selectedIndex = i;
        return;
      }
    }
    menu.selectedIndex = 0;
  }

  function moveMenuSelection(dir) {
    const items = getMenuItems();
    if (!items.length) return;
    normalizeMenuSelection();
    let idx = menu.selectedIndex;
    for (let i = 0; i < items.length; i++) {
      idx = (idx + dir + items.length) % items.length;
      if (isSelectableMenuItem(items[idx])) {
        menu.selectedIndex = idx;
        menu.userScrolled = false;
        return;
      }
    }
  }

  function getMultiplayerStatusLines() {
    if (!multiplayer.available) return ['PARTYKIT BRIDGE NOT LOADED'];
    const lines = [];
    lines.push('STATUS: ' + multiplayer.status + (multiplayer.connected && multiplayer.roomCode ? '  ROOM: ' + multiplayer.roomCode : ''));
    if (!multiplayer.active || !multiplayer.connected) {
      lines.push('START HOSTS A ROOM. JOIN USES ROOM CODE.');
      return lines;
    }
    if (multiplayer.snapshot && multiplayer.snapshot.phase === 'lobby') {
      const players = Object.values(multiplayer.snapshot.players || {});
      lines.push('LOBBY: ' + players.length + ' PLAYER' + (players.length === 1 ? '' : 'S'));
      const visiblePlayers = players.slice(0, 4);
      for (const p of visiblePlayers) {
        let label = p.name || 'ANON';
        if (p.id === multiplayer.snapshot.hostId) label += ' [HOST]';
        if (p.id === multiplayer.localId) label += ' [YOU]';
        lines.push(label);
      }
      if (players.length > visiblePlayers.length) lines.push('+' + (players.length - visiblePlayers.length) + ' MORE');
      lines.push(multiplayer.snapshot.hostId === multiplayer.localId ? 'PRESS START TO LAUNCH MATCH' : 'WAITING FOR HOST TO START');
      return lines;
    }
    if (multiplayer.snapshot && multiplayer.snapshot.phase === 'playing') {
      lines.push('MATCH LIVE');
      return lines;
    }
    lines.push('NOT CONNECTED TO A MATCH YET');
    return lines;
  }

  function wrapTextToWidth(text, maxWidth, font) {
    if (!text) return [''];
    const prevFont = ctx.font;
    ctx.font = font;
    const out = [];
    const words = String(text).split(' ');
    let current = '';
    for (const w of words) {
      const test = current ? current + ' ' + w : w;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
        continue;
      }
      if (current) out.push(current);
      if (ctx.measureText(w).width > maxWidth) {
        let seg = '';
        for (const ch of w) {
          const testSeg = seg + ch;
          if (ctx.measureText(testSeg).width <= maxWidth) {
            seg = testSeg;
          } else {
            if (seg) out.push(seg);
            seg = ch;
          }
        }
        current = seg;
      } else {
        current = w;
      }
    }
    if (current) out.push(current);
    ctx.font = prevFont;
    return out.length ? out : [String(text)];
  }

  function getMultiplayerStatusDisplayLines() {
    const raw = getMultiplayerStatusLines();
    const { rowW } = getMenuContentRect();
    const rowPad = 10;
    const maxW = Math.max(40, rowW - rowPad * 2);
    const font = '10px ' + FONT_MONO;
    const out = [];
    for (const line of raw) {
      for (const wrapped of wrapTextToWidth(line, maxW, font)) out.push(wrapped);
    }
    return out;
  }

  function getMenuRowHeight(item) {
    if (item === 'mp_status') return 18 + getMultiplayerStatusDisplayLines().length * 12;
    if (item.startsWith('cheat_')) return 20;
    if (item === 'mode') return 40;
    return 32;
  }

  function getStartMenuLabel() {
    if (!menu.multiplayerMode) return 'START GAME';
    if (!multiplayer.active || !multiplayer.connected) return 'HOST GAME';
    if (multiplayer.snapshot && multiplayer.snapshot.phase === 'lobby') {
      if (multiplayer.snapshot.hostId === multiplayer.localId) return 'START MATCH';
      return 'WAITING FOR HOST';
    }
    if (multiplayer.snapshot && multiplayer.snapshot.phase === 'playing') return 'MATCH LIVE';
    if (multiplayer.snapshot && multiplayer.snapshot.phase === 'gameover') {
      if (multiplayer.snapshot.hostId === multiplayer.localId) return 'NEW MATCH';
      return 'WAITING FOR HOST';
    }
    return 'START GAME';
  }

  function activateStartAction() {
    setActiveField('');
    if (!menu.multiplayerMode) {
      startGame();
      return;
    }
    if (!multiplayer.active || !multiplayer.connected) {
      connectMultiplayer(true);
      return;
    }
    const phase = multiplayer.snapshot && multiplayer.snapshot.phase;
    if (phase === 'lobby' || phase === 'gameover') {
      if (multiplayer.snapshot.hostId === multiplayer.localId && multiplayer.session) {
        multiplayer.session.send({ type: 'setMode', mode: multiplayer.mode });
        multiplayer.session.send({ type: 'startGame', cheats: Object.assign({}, menu.cheats) });
      } else {
        multiplayer.status = 'WAITING FOR HOST';
        syncMultiplayerPanel();
      }
    }
  }

  function isTypingInField() {
    const ae = document.activeElement;
    return !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA'));
  }

  function teardownSession() {
    if (session.handle) session.handle.disconnect();
    session.active = false;
    session.handle = null;
    session.kind = null;
    session.localId = '';
    for (const k in session.input) session.input[k] = false;
  }

  function disconnectMultiplayer(returnToMenu) {
    teardownSession();
    multiplayer.active = false;
    multiplayer.connected = false;
    multiplayer.session = null;
    multiplayer.snapshot = null;
    multiplayer.localId = '';
    multiplayer.remotePlayers = [];
    multiplayer.status = 'OFFLINE';
    multiplayer.playerNotifs = [];
    multiplayer.prevPlayerIds = null;
    if (returnToMenu) {
      const next = freshState();
      next.phase = 'menu';
      state = next;
    }
    syncMultiplayerPanel();
  }

  const NOTIF_DURATION_MS = 4000;

  function diffPlayerSnapshot(snapshot) {
    const newMap = new Map();
    for (const p of Object.values(snapshot.players || {})) {
      newMap.set(p.id, String(p.name || 'ANON').toUpperCase().slice(0, 18));
    }

    if (multiplayer.prevPlayerIds !== null) {
      for (const [id, name] of newMap) {
        if (!multiplayer.prevPlayerIds.has(id) && id !== multiplayer.localId) {
          multiplayer.playerNotifs.push({ text: name + ' joined the game', joinedAt: Date.now(), type: 'join' });
        }
      }
      for (const [id, name] of multiplayer.prevPlayerIds) {
        if (!newMap.has(id) && id !== multiplayer.localId) {
          multiplayer.playerNotifs.push({ text: name + ' left the game', joinedAt: Date.now(), type: 'leave' });
        }
      }
    }

    multiplayer.prevPlayerIds = newMap;
    const cutoff = Date.now() - NOTIF_DURATION_MS;
    multiplayer.playerNotifs = multiplayer.playerNotifs.filter(n => n.joinedAt > cutoff);
  }

  function connectMultiplayer(isHost) {
    if (!multiplayer.available) return;
    menu.playerName = (menu.playerName || 'ANON').slice(0, 16);
    multiplayer.roomCode = (multiplayer.roomCode || Math.random().toString(36).slice(2, 8)).toUpperCase();
    multiplayer.host = (multiplayer.host || '').trim();
    disconnectMultiplayer(false);
    multiplayer.active = true;
    multiplayer.status = isHost ? 'HOSTING...' : 'JOINING...';
    const handle = window.ShapescapeSession.startMultiplayer({
      roomId: multiplayer.roomCode,
      name: menu.playerName || 'ANON',
      host: multiplayer.host,
      onState: snapshot => {
        multiplayer.snapshot = snapshot;
        multiplayer.connected = true;
        // session.handle is assigned synchronously after createSession returns; our
        // subscribe() callback is deferred (queueMicrotask) so it's always ready here.
        multiplayer.localId = session.handle ? session.handle.getLocalId() : multiplayer.localId;
        session.localId = multiplayer.localId;
        // Non-hosts mirror the host's match type so the lobby UI stays in sync.
        if (snapshot && snapshot.mode && snapshot.hostId && snapshot.hostId !== multiplayer.localId) {
          multiplayer.mode = snapshot.mode;
        }
        diffPlayerSnapshot(snapshot);
        applyMultiplayerSnapshot(snapshot);
        syncMultiplayerPanel();
      },
      onStatus: status => {
        multiplayer.status = status.toUpperCase();
        syncMultiplayerPanel();
      }
    });
    multiplayer.session = handle;
    session.active = true;
    session.handle = handle;
    session.kind = 'network';
    syncMultiplayerPanel();
  }

  function loadCrtPreference() {
    try {
      return localStorage.getItem(CRT_PREF_KEY) !== '0';
    } catch (err) {
      return true;
    }
  }

  function saveCrtPreference(enabled) {
    try {
      localStorage.setItem(CRT_PREF_KEY, enabled ? '1' : '0');
    } catch (err) {}
  }

  function applyCrtMode() {
    const enabled = !!menu.crtEnabled;
    const hasWebglCrt = !!crtRenderer;
    container.classList.toggle('crt-on', enabled);
    container.classList.toggle('crt-webgl', hasWebglCrt);
    if (crtRenderer) crtRenderer.setEnabled(enabled);
  }

  if (window.CRTPostProcess && crtCanvas) {
    try {
      const renderer = new window.CRTPostProcess(canvas, crtCanvas);
      if (renderer.supported) crtRenderer = renderer;
    } catch (err) {
      crtRenderer = null;
    }
  }
  menu.crtSupported = !!crtRenderer;
  menu.crtEnabled = menu.crtSupported && loadCrtPreference();
  applyCrtMode();
  if (crtRenderer) resizeCanvas();

  function getMenuItems() {
    const items = ['mode', 'start', 'name'];
    if (menu.multiplayerMode) {
      items.push('mp_room', 'mp_host', 'mp_matchmode', 'mp_join', 'mp_leave', 'mp_status');
    }
    items.push('crt');
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
    let prevHalf = 0;
    let prevItem = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const thisHalf = getMenuRowHeight(item) / 2;
      let gap;
      if (item.startsWith('cheat_')) gap = 4;
      else if (item === 'name') gap = 28;
      else if (item === 'mp_room') gap = 44;
      else if (item === 'mp_status') gap = 10;
      else if (item.startsWith('cat_')) { gap = firstCat ? 28 : 10; firstCat = false; }
      else gap = 6;
      if (prevItem === 'mp_status') gap = Math.max(gap, 28);
      y += (i === 0 ? 0 : prevHalf + gap) + thisHalf;
      rows.push({ y, item });
      prevHalf = thisHalf;
      prevItem = item;
    }
    return rows;
  }

  function getMenuContentHeight() {
    const layout = getMenuLayout();
    if (!layout.length) return 0;
    const last = layout[layout.length - 1];
    const bottom = last.y + getMenuRowHeight(last.item) / 2;
    return bottom + 40;
  }

  function getMenuMaxScroll() {
    const contentHeight = getMenuContentHeight();
    return Math.max(0, contentHeight - H + 40);
  }

  function getMenuScrollY() {
    normalizeMenuSelection();
    const layout = getMenuLayout();
    const maxVisibleY = H - 60;
    const maxScroll = getMenuMaxScroll();
    if (menu.userScrolled) {
      // User-driven scroll (wheel / touch drag) takes precedence until they
      // use keyboard navigation, which resets userScrolled and falls back to
      // the selection-driven auto-scroll below.
      menu.scrollY = Math.max(0, Math.min(menu.scrollY, maxScroll));
      return menu.scrollY;
    }
    let scrollY = 0;
    if (layout.length > 0) {
      const selRow = layout[Math.min(menu.selectedIndex, layout.length - 1)];
      if (selRow && selRow.y > maxVisibleY) scrollY = selRow.y - maxVisibleY + 40;
    }
    menu.scrollY = Math.max(0, Math.min(scrollY, maxScroll));
    return menu.scrollY;
  }

  function adjustMenuScroll(deltaY) {
    const maxScroll = getMenuMaxScroll();
    if (maxScroll <= 0) return;
    menu.userScrolled = true;
    menu.scrollY = Math.max(0, Math.min(menu.scrollY + deltaY, maxScroll));
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

  const fetchLeaderboard = function () { leaderboardApi.fetch(menu); };
  const submitScore = function (name, score, timeSeconds) {
    leaderboardApi.submit(menu, name, score, timeSeconds);
  };

  // track mouse for drawing previews and tooltips
  let mouseWorld = { x: 0, y: 0 };
  let mouseScreen = { x: 0, y: 0 };
  let mouseOnCanvas = false;
  let mouseHeld = false;
  /** True while Option/Alt is held — used for touch (no altKey on move) and previews. */
  let drawSnapAltHeld = false;

  // game state — reset to this on new game
  let state = null;

  function freshState() {
    return {
      phase: 'menu',
      playerX: 50, playerY: 0, playerVY: 0,
      onGround: true,
      movingLeft: false, movingRight: false, sprinting: false, crouching: false,
      mobileCrouch: false, mobileSprintHeld: false, mobileJumpHeld: false,
      direction: 'right',
      idleImg: idleImages[Math.floor(Math.random() * 3)],
      cameraX: 0,
      cameraY: 0,
      squares: [],
      isDragging: false, dragStart: null, dragCurrent: null,
      score: 0, coins: [],
      hearts: [],
      upgrades: [],
      activeUpgrades: {},
      health: 100, gameStartTime: 0,
      fish: { x: -200, y: 200, spawned: false, rotation: 0 },
      fishHP: 100, fishMaxHP: 100,
      projectiles: [],
      inventory: ['square'],
      selectedSlot: 0,
      portals: [],
      portalBoostVX: 0,
      swordCooldown: 0,
      swordSwing: null,
      bugs: [],
      danglies: [],
      polyPoints: [],
      bezierPoints: [],
      grapple: null,
      grappleCooldown: 0,
      reflectors: [],
      reflectorCooldown: 0,
      bombs: [],
      bombCooldown: 0,
      revives: [],
      fishShootPulse: 0,
      fishFrozen: 0,
      freezeCooldown: 0,
      iceShards: [],
      laserCooldown: 0,
      laserBeams: [],
      dashActive: 0,
      damageFlash: 0,
      pauseStart: 0,
      particles: [],
    };
  }

  state = freshState();

  // Snapshot → legacy render-state is implemented in TypeScript
  // (src/client/render-adapter.ts) so the mapping is typed and testable. This
  // wrapper only handles phase-transition policy and idle-sprite preservation,
  // which depend on game.js-local state (idleImages, onGameOver, pause clock)
  function applyMultiplayerSnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.phase === 'lobby') {
      state.phase = 'menu';
      multiplayer.remotePlayers = [];
      return;
    }
    // Let a multiplayer match pull us out of the main menu once the host kicks it off.
    // Solo mode flips `state.phase` to 'playing' inside startGame() before the first
    // snapshot arrives, so this path only matters for network sessions.
    if (state.phase === 'menu') {
      if (!(multiplayer.active && snapshot.phase === 'playing')) return;
      const base = freshState();
      base.phase = 'playing';
      base.gameStartTime = Date.now();
      state = base;
    }
    if (state.phase === 'paused') return;
    // Host-triggered "NEW MATCH" flips the server straight from gameover to
    // playing — pull any still-on-the-scoreboard clients into the new round
    // instead of keeping them locked on their old gameover screen.
    if (state.phase === 'gameover' && snapshot.phase === 'playing') {
      const base = freshState();
      base.phase = 'playing';
      base.gameStartTime = Date.now();
      state = base;
    }
    if (state.phase === 'gameover' && snapshot.phase !== 'gameover') return;

    const adapter = window.ShapescapeSession && window.ShapescapeSession.toRenderState;
    if (!adapter) return;
    const result = adapter(snapshot, multiplayer.localId || session.localId, W, H);
    if (!result) return;

    const prevPhase = state.phase;
    const prevHealth = typeof state.health === 'number' ? state.health : null;
    const prevCoinCount = Array.isArray(state.coins) ? state.coins.length : null;
    const next = result.next;

    // Preserve draw-in-progress + idle sprite across frames.
    next.isDragging = state.isDragging;
    next.dragStart = state.dragStart;
    next.dragCurrent = state.dragCurrent;
    next.polyPoints = state.polyPoints;
    next.bezierPoints = state.bezierPoints;
    if (next.movingLeft || next.movingRight) {
      next.idleImg = idleImages[Math.floor(Math.random() * idleImages.length)];
    } else if (state.idleImg) {
      next.idleImg = state.idleImg;
    }
    next.particles = state.particles || [];
    next.mobileCrouch = state.mobileCrouch;
    next.mobileSprintHeld = state.mobileSprintHeld;
    next.mobileJumpHeld = state.mobileJumpHeld;
    next.portalBoostVX = state.portalBoostVX || 0;
    next.pauseStart = state.pauseStart || 0;

    state = next;
    multiplayer.remotePlayers = result.remotePlayers;
    if (
      prevPhase === 'playing' &&
      next.phase === 'playing' &&
      prevHealth !== null &&
      typeof next.health === 'number' &&
      next.health < prevHealth &&
      next.health > 0
    ) {
      const dmg = prevHealth - next.health;
      haptic(dmg >= 25 ? 'error' : 'heavy');
    }
    if (
      prevPhase === 'playing' &&
      next.phase === 'playing' &&
      prevCoinCount !== null &&
      Array.isArray(next.coins) &&
      next.coins.length < prevCoinCount
    ) {
      haptic('selection');
    }
    if (prevPhase !== 'gameover' && next.phase === 'gameover') {
      haptic('error');
      onGameOver();
    }
  }

  function isSprintActive() {
    return (state.sprinting || state.mobileSprintHeld) && state.activeUpgrades.sprint;
  }

  function pauseGameplay() {
    if (state.phase !== 'playing') return;
    state.phase = 'paused';
    state.pauseStart = Date.now();
    state.movingLeft = false;
    state.movingRight = false;
    state.sprinting = false;
    state.mobileSprintHeld = false;
    state.mobileCrouch = false;
    state.mobileJumpHeld = false;
    if (sessionActive() && session.handle && session.handle.setPaused) session.handle.setPaused(true);
  }

  function resumeFromPause() {
    if (state.phase !== 'paused') return;
    // shift the HUD timer forward so the wall-clock pause doesn't count as playtime;
    // every other timer lives in the sim (LocalSession/NetworkSession), which is paused via setPaused.
    state.gameStartTime += Date.now() - state.pauseStart;
    state.phase = 'playing';
    if (sessionActive() && session.handle && session.handle.setPaused) session.handle.setPaused(false);
  }

  function quitToMenuFromPause() {
    if (state.phase !== 'paused') return;
    if (multiplayer.active) {
      disconnectMultiplayer(true);
      return;
    }
    if (sessionActive() && session.kind === 'local') teardownSession();
    state.phase = 'menu';
  }

  function getCurrentTool() {
    return state.inventory[state.selectedSlot] || 'square';
  }

  // keyboard input
  const keys = {};
  const DOUBLE_TAP_MS = 280;
  let lastKeyDirDoubleTap = { side: null, t: 0 };

  window.addEventListener('keydown', e => {
    if (e.repeat && state.phase !== 'menu') return;
    keys[e.code] = true;
    if (e.code === 'AltLeft' || e.code === 'AltRight') drawSnapAltHeld = true;

    if (isTypingInField() && state.phase === 'menu' && !menu.activeField) return;

    if (state.phase === 'menu') {
      if (menu.activeField) {
        if (e.code === 'Escape' || e.code === 'Enter') {
          setActiveField(''); e.preventDefault(); return;
        }
        if (e.code === 'Tab') {
          const prevIdx = menu.selectedIndex;
          setActiveField('');
          moveMenuSelection(e.shiftKey ? -1 : 1);
          if (menu.selectedIndex !== prevIdx) triggerGlitch();
          e.preventDefault();
          return;
        }
        // When the hidden DOM input has focus (desktop or mobile) let it handle
        // character entry via its own input event so we don't double-type.
        if (menuTextInputFocused()) return;
        if (e.code === 'Backspace') {
          setMenuTextValue(menu.activeField, getMenuTextValue(menu.activeField).slice(0, -1));
          e.preventDefault();
          return;
        }
        if (e.key.length === 1) {
          setMenuTextValue(menu.activeField, getMenuTextValue(menu.activeField) + e.key);
          e.preventDefault();
          return;
        }
        return;
      }
      normalizeMenuSelection();
      const prevIdx = menu.selectedIndex;
      const curItems = getMenuItems();
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const item = curItems[menu.selectedIndex];
        if (item === 'mode') {
          setMenuMultiplayerMode(e.code === 'ArrowRight');
          e.preventDefault();
          return;
        }
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        moveMenuSelection(-1);
        e.preventDefault();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        moveMenuSelection(1);
        e.preventDefault();
      } else if (e.code === 'Tab') {
        moveMenuSelection(e.shiftKey ? -1 : 1);
        e.preventDefault();
      } else if (e.code === 'Enter' || e.code === 'Space') {
        activateMenuItem(curItems[menu.selectedIndex]);
        e.preventDefault();
      }
      if (menu.selectedIndex !== prevIdx) triggerGlitch();
      return;
    }

    if (state.phase === 'gameover' && e.code === 'Enter') {
      if (sessionActive() && session.kind === 'local') teardownSession();
      state.phase = 'menu'; e.preventDefault(); return;
    }

    if (state.phase === 'playing' && e.code === 'Escape') {
      pauseGameplay();
      if (sessionActive()) {
        for (const k in session.input) session.input[k] = false;
        sessionSendInput();
      }
      e.preventDefault(); return;
    }

    if (state.phase === 'paused') {
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
        resumeFromPause();
        e.preventDefault(); return;
      }
      if (e.code === 'KeyQ') {
        quitToMenuFromPause();
        e.preventDefault(); return;
      }
      return;
    }

    if (state.phase === 'playing') {
      if (sessionActive()) {
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { session.input.jump = true; sessionSendInput(); e.preventDefault(); }
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
          const now = Date.now();
          if (lastKeyDirDoubleTap.side === 'left' && now - lastKeyDirDoubleTap.t < DOUBLE_TAP_MS) {
            session.input.dash = true; sessionSendInput();
            setTimeout(() => { session.input.dash = false; sessionSendInput(); }, 80);
            lastKeyDirDoubleTap = { side: null, t: 0 };
          } else {
            lastKeyDirDoubleTap = { side: 'left', t: now };
          }
          session.input.left = true; sessionSendInput(); e.preventDefault();
        }
        if (e.code === 'ArrowRight' || e.code === 'KeyD') {
          const now = Date.now();
          if (lastKeyDirDoubleTap.side === 'right' && now - lastKeyDirDoubleTap.t < DOUBLE_TAP_MS) {
            session.input.dash = true; sessionSendInput();
            setTimeout(() => { session.input.dash = false; sessionSendInput(); }, 80);
            lastKeyDirDoubleTap = { side: null, t: 0 };
          } else {
            lastKeyDirDoubleTap = { side: 'right', t: now };
          }
          session.input.right = true; sessionSendInput(); e.preventDefault();
        }
        if (e.code === 'KeyS' || e.code === 'ArrowDown' || e.code === 'KeyC') { session.input.crouch = true; sessionSendInput(); e.preventDefault(); }
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { session.input.sprint = true; sessionSendInput(); }
        if (e.code === 'KeyE') {
          session.input.dash = true; sessionSendInput();
          setTimeout(() => { session.input.dash = false; sessionSendInput(); }, 80);
        }
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9 && num <= state.inventory.length) {
          const tool = state.inventory[num - 1];
          sessionSend({ type: 'selectTool', tool: tool });
          e.preventDefault();
        }
      }
    }
  });

  window.addEventListener('keyup', e => {
    keys[e.code] = false;
    if (e.code === 'AltLeft' || e.code === 'AltRight') drawSnapAltHeld = false;
    if (!sessionActive() || state.phase !== 'playing') return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') session.input.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') session.input.right = false;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') session.input.jump = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') session.input.sprint = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown' || e.code === 'KeyC') session.input.crouch = false;
    sessionSendInput();
  });

  window.addEventListener('blur', () => { drawSnapAltHeld = false; });

  // Scroll wheel: cycle inventory while playing, scroll the menu otherwise.
  canvas.addEventListener('wheel', e => {
    if (state.phase === 'menu') {
      e.preventDefault();
      adjustMenuScroll(e.deltaY);
      return;
    }
    if (!sessionActive() || state.phase !== 'playing' || state.inventory.length <= 1) return;
    e.preventDefault();
    const nextIdx = e.deltaY > 0
      ? (state.selectedSlot + 1) % state.inventory.length
      : (state.selectedSlot - 1 + state.inventory.length) % state.inventory.length;
    sessionSend({ type: 'selectTool', tool: state.inventory[nextIdx] });
  }, { passive: false });

  function setMenuMultiplayerMode(wantMp) {
    if (menu.multiplayerMode === wantMp) return;
    menu.multiplayerMode = wantMp;
    if (!menu.multiplayerMode && multiplayer.active && state.phase === 'menu') disconnectMultiplayer(false);
    syncMultiplayerPanel();
    triggerGlitch();
    normalizeMenuSelection();
  }

  function activateMenuItem(item) {
    if (item === 'mode') {
      setActiveField('');
      setMenuMultiplayerMode(!menu.multiplayerMode);
      return;
    }
    if (isMenuTextItem(item)) {
      if ((item === 'mp_room' || item === 'mp_host') && multiplayer.active) return;
      setActiveField(item);
      return;
    }
    setActiveField('');
    if (item === 'mp_matchmode') {
      if (isMatchModeLocked()) return;
      multiplayer.mode = multiplayer.mode === 'pvp' ? 'coop' : 'pvp';
      if (multiplayer.session && multiplayer.snapshot && multiplayer.snapshot.hostId === multiplayer.localId) {
        multiplayer.session.send({ type: 'setMode', mode: multiplayer.mode });
      }
      triggerGlitch();
      return;
    }
    if (item === 'mp_join') {
      if (multiplayer.active) return;
      if (!multiplayer.roomCode) {
        setActiveField('mp_room');
        multiplayer.status = 'ENTER ROOM CODE';
      } else {
        connectMultiplayer(false);
      }
      triggerGlitch();
      return;
    }
    if (item === 'mp_leave') {
      if (multiplayer.active) disconnectMultiplayer(true);
      triggerGlitch();
      return;
    }
    if (item === 'crt') {
      if (!menu.crtSupported) return;
      menu.crtEnabled = !menu.crtEnabled;
      saveCrtPreference(menu.crtEnabled);
      applyCrtMode();
      triggerGlitch();
      return;
    }
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
    if (item === 'start') activateStartAction();
  }

  // mouse and touch input
  function canvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width, scaleY = H / rect.height;
    return {
      x: (clientX - rect.left) * scaleX + state.cameraX,
      y: H - (clientY - rect.top) * scaleY + (state.cameraY || 0)
    };
  }

  function snapWorldPointToGrid(p) {
    return {
      x: Math.round(p.x / DRAW_SNAP_GRID) * DRAW_SNAP_GRID,
      y: Math.round(p.y / DRAW_SNAP_GRID) * DRAW_SNAP_GRID,
    };
  }

  /**
   * Option/Alt: snap drag end to grid for box shapes; snap line to nearest 45° from drag start.
   */
  function snapDragEndForTool(start, rawEnd, tool, snap) {
    if (!snap) return rawEnd;
    if (tool === 'line') {
      const dx = rawEnd.x - start.x, dy = rawEnd.y - start.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return snapWorldPointToGrid(rawEnd);
      let ang = Math.atan2(dy, dx);
      const step = Math.PI / 4;
      ang = Math.round(ang / step) * step;
      return { x: start.x + Math.cos(ang) * len, y: start.y + Math.sin(ang) * len };
    }
    return snapWorldPointToGrid(rawEnd);
  }

  function screenCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) * (W / rect.width), y: (clientY - rect.top) * (H / rect.height) };
  }

  function getPausePanelRect() {
    const w = Math.min(360, W - 40), h = 180;
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  /** Same breakpoint as `#mobile-controls` in style.css — touch / narrow viewports. */
  function isMobilePauseHints() {
    try {
      return window.matchMedia('(pointer: coarse), (max-width: 600px)').matches;
    } catch (e) {
      return false;
    }
  }

  function handlePauseScreenPointer(clientX, clientY) {
    if (state.phase !== 'paused') return;
    const sc = screenCoords(clientX, clientY);
    const r = getPausePanelRect();
    const inside = sc.x >= r.x && sc.x <= r.x + r.w && sc.y >= r.y && sc.y <= r.y + r.h;
    if (inside) quitToMenuFromPause();
    else resumeFromPause();
  }

  canvas.addEventListener('mousemove', e => {
    mouseOnCanvas = true;
    mouseWorld = canvasCoords(e.clientX, e.clientY);
    mouseScreen = screenCoords(e.clientX, e.clientY);
    if (state.isDragging && state.dragStart) {
      const raw = canvasCoords(e.clientX, e.clientY);
      const tool = getCurrentTool();
      state.dragCurrent = snapDragEndForTool(state.dragStart, raw, tool, e.altKey);
    }
  });
  canvas.addEventListener('mouseleave', () => { mouseOnCanvas = false; finishDrag(); });

  canvas.addEventListener('mousedown', e => {
    mouseHeld = true;
    if (state.phase === 'menu') {
      // Prevent default so the browser doesn't move focus to <body>/canvas and
      // clobber the .focus() call in setActiveField(). Without this, clicking
      // a text field on desktop never actually focuses the hidden input.
      e.preventDefault();
      handleMenuClick(e);
      return;
    }
    if (state.phase === 'gameover') {
      if (sessionActive() && session.kind === 'local') teardownSession();
      state.phase = 'menu'; return;
    }
    if (state.phase === 'paused') {
      handlePauseScreenPointer(e.clientX, e.clientY);
      e.preventDefault();
      return;
    }
    if (state.phase !== 'playing') return;

    const tool = getCurrentTool();
    const pRaw = canvasCoords(e.clientX, e.clientY);
    const snapPt = e.altKey ? snapWorldPointToGrid(pRaw) : pRaw;

    if (tool === 'square' || tool === 'circle' || tool === 'triangle' || tool === 'line') {
      state.isDragging = true; state.dragStart = snapPt; state.dragCurrent = snapPt;
    } else if (tool === 'polygon') {
      handlePolygonClick(snapPt);
    } else if (tool === 'bezier') {
      handleBezierClick(snapPt);
    } else if (tool === 'eraser') {
      eraseAtPoint(snapPt);
    } else if (tool === 'portal') {
      placePortal(snapPt);
    } else if (tool === 'sword') {
      triggerSwordSwing();
    } else if (tool === 'grapple') {
      activateGrapple(snapPt);
    } else if (tool === 'reflector') {
      placeReflector(snapPt);
    } else if (tool === 'bomb') {
      placeBomb(snapPt);
    } else if (tool === 'freeze') {
      activateFreeze(snapPt);
    } else if (tool === 'laser') {
      fireLaser(snapPt);
    }
  });
  canvas.addEventListener('mouseup', () => { mouseHeld = false; finishDrag(); });
  window.addEventListener('mouseup', () => { mouseHeld = false; });

  // Track touch drag in the menu so we can differentiate a tap (activate row)
  // from a scroll gesture (drag the menu up/down on mobile).
  let menuTouchDrag = null;
  const MENU_TOUCH_TAP_PX = 8;
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    mouseHeld = true;
    if (state.phase === 'menu') {
      if (e.touches.length) {
        const t = e.touches[0];
        menuTouchDrag = {
          startX: t.clientX,
          startY: t.clientY,
          lastY: t.clientY,
          moved: false,
          scale: (H / canvas.getBoundingClientRect().height) || 1
        };
      }
      return;
    }
    if (state.phase === 'gameover') {
      if (sessionActive() && session.kind === 'local') teardownSession();
      state.phase = 'menu'; return;
    }
    if (state.phase === 'paused' && e.touches.length) {
      const t = e.touches[0];
      handlePauseScreenPointer(t.clientX, t.clientY);
      return;
    }
    if (state.phase !== 'playing' || !e.touches.length) return;
    const t = e.touches[0];
    const tool = getCurrentTool();
    const pRaw = canvasCoords(t.clientX, t.clientY);
    const snapPt = drawSnapAltHeld ? snapWorldPointToGrid(pRaw) : pRaw;
    if (tool === 'square' || tool === 'circle' || tool === 'triangle' || tool === 'line') {
      state.isDragging = true; state.dragStart = snapPt; state.dragCurrent = snapPt;
    } else if (tool === 'polygon') {
      handlePolygonClick(snapPt);
    } else if (tool === 'bezier') {
      handleBezierClick(snapPt);
    } else if (tool === 'eraser') {
      eraseAtPoint(snapPt);
    } else if (tool === 'portal') {
      placePortal(snapPt);
    } else if (tool === 'sword') {
      triggerSwordSwing();
    } else if (tool === 'grapple') {
      activateGrapple(snapPt);
    } else if (tool === 'reflector') {
      placeReflector(snapPt);
    } else if (tool === 'bomb') {
      placeBomb(snapPt);
    } else if (tool === 'freeze') {
      activateFreeze(snapPt);
    } else if (tool === 'laser') {
      fireLaser(snapPt);
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (state.phase === 'menu' && menuTouchDrag && e.touches.length) {
      const t = e.touches[0];
      const dx = t.clientX - menuTouchDrag.startX;
      const dy = t.clientY - menuTouchDrag.startY;
      if (Math.hypot(dx, dy) > MENU_TOUCH_TAP_PX) menuTouchDrag.moved = true;
      const delta = menuTouchDrag.lastY - t.clientY;
      adjustMenuScroll(delta * menuTouchDrag.scale);
      menuTouchDrag.lastY = t.clientY;
      return;
    }
    if (!state.isDragging || !e.touches.length || !state.dragStart) return;
    const raw = canvasCoords(e.touches[0].clientX, e.touches[0].clientY);
    state.dragCurrent = snapDragEndForTool(state.dragStart, raw, getCurrentTool(), drawSnapAltHeld);
  }, { passive: false });
  canvas.addEventListener('touchend', e => {
    e.preventDefault();
    mouseHeld = false;
    if (state.phase === 'menu' && menuTouchDrag) {
      if (!menuTouchDrag.moved) {
        handleMenuClick({ clientX: menuTouchDrag.startX, clientY: menuTouchDrag.startY });
      }
      menuTouchDrag = null;
      return;
    }
    finishDrag();
  }, { passive: false });
  canvas.addEventListener('touchcancel', e => {
    e.preventDefault();
    mouseHeld = false;
    menuTouchDrag = null;
    finishDrag();
  }, { passive: false });

  function finishDrag() {
    if (!state.isDragging || !state.dragStart || !state.dragCurrent) {
      state.isDragging = false; state.dragStart = null; state.dragCurrent = null; return;
    }
    const tool = getCurrentTool();
    const w = Math.abs(state.dragCurrent.x - state.dragStart.x);
    const h = Math.abs(state.dragCurrent.y - state.dragStart.y);

    // Size gates mirror src/sim/shapes.ts so we don't send drafts the server will silently reject.
    let valid = false;
    if (tool === 'circle') {
      valid = Math.min(w, h) / 2 > 4;
    } else if (tool === 'triangle') {
      valid = w > 4 && h > 4;
    } else if (tool === 'line') {
      const ldx = state.dragCurrent.x - state.dragStart.x;
      const ldy = state.dragCurrent.y - state.dragStart.y;
      valid = Math.sqrt(ldx * ldx + ldy * ldy) > 8;
    } else {
      valid = w > 4 && h > 4;
    }

    if (valid && sessionActive()) {
      sessionSend({
        type: 'draw',
        draft: {
          tool: tool === 'square' ? 'square' : tool,
          start: state.dragStart,
          end: state.dragCurrent,
        }
      });
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
        slot.addEventListener('mousedown', e => {
          e.stopPropagation();
          const idx = parseInt(slot.dataset.idx);
          state.selectedSlot = idx;
          if (sessionActive() && state.inventory[idx]) sessionSend({ type: 'selectTool', tool: state.inventory[idx] });
        });
        slot.addEventListener('touchstart', e => {
          e.preventDefault(); e.stopPropagation();
          if (window.haptics) window.haptics.trigger('selection');
          const idx = parseInt(slot.dataset.idx);
          state.selectedSlot = idx;
          if (sessionActive() && state.inventory[idx]) sessionSend({ type: 'selectTool', tool: state.inventory[idx] });
        }, { passive: false });
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
      else if (inv[i] === 'laser' && state.laserCooldown > 0) cdPct = (state.laserCooldown / 45) * 100;
      else if (inv[i] === 'reflector' && state.reflectorCooldown > 0) cdPct = (state.reflectorCooldown / 30) * 100;
      cdEl.style.height = Math.round(cdPct) + '%';
    }
    if (label) {
      const def = TOOLS[inv[state.selectedSlot]];
      label.textContent = def ? def.name : '';
    }
  }

  // Tool handlers just forward to the active session; simulation is authoritative.
  function placePortal(worldPos) {
    if (sessionActive()) sessionSend({ type: 'tool', action: 'portal', target: worldPos });
  }

  function triggerSwordSwing() {
    if (sessionActive()) sessionSend({ type: 'tool', action: 'sword' });
  }

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
    if (pts.length >= 3 && sessionActive()) {
      sessionSend({ type: 'draw', draft: { tool: 'polygon', points: pts.slice() } });
    }
    state.polyPoints = [];
  }

  function handleBezierClick(p) {
    state.bezierPoints.push(p);
    if (state.bezierPoints.length === 3) closeBezier();
  }

  function closeBezier() {
    const pts = state.bezierPoints;
    if (pts.length === 3 && sessionActive()) {
      const [p0, p2, p1] = pts;
      sessionSend({ type: 'draw', draft: { tool: 'bezier', points: [p0, p1, p2] } });
    }
    state.bezierPoints = [];
  }

  function eraseAtPoint(worldPos) {
    if (sessionActive()) sessionSend({ type: 'erase', point: worldPos });
  }

  function activateGrapple(worldPos) {
    if (sessionActive()) sessionSend({ type: 'tool', action: 'grapple', target: worldPos });
  }

  function placeReflector(worldPos) {
    if (sessionActive()) sessionSend({ type: 'tool', action: 'reflector', target: worldPos });
  }

  function placeBomb(worldPos) {
    if (sessionActive()) sessionSend({ type: 'tool', action: 'bomb', target: worldPos });
  }

  function activateFreeze(target) {
    if (sessionActive()) sessionSend({ type: 'tool', action: 'freeze', target: target });
  }

  function fireLaser(target) {
    if (sessionActive()) sessionSend({ type: 'tool', action: 'laser', target: target });
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
      const rowHalf = getMenuRowHeight(item) / 2;
      const visY = row.y - scrollY;
      if (visY + rowHalf < 4 || visY - rowHalf > H - 4) continue;
      if (sc.y > visY - rowHalf && sc.y < visY + rowHalf && sc.x > x0 && sc.x < x1) {
        if (!isSelectableMenuItem(item)) return;
        const prevIdx = menu.selectedIndex;
        menu.selectedIndex = i;
        if (prevIdx !== i) triggerGlitch();
        if (item === 'mode') {
          setMenuMultiplayerMode(sc.x >= rowX + rowW / 2);
          return;
        }
        activateMenuItem(curItems[i]);
        return;
      }
    }
  }

  // mobile on-screen buttons
  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const btnJump = document.getElementById('btn-jump');
  const btnPause = document.getElementById('btn-pause');
  const btnSprint = document.getElementById('btn-sprint');
  const btnCrouch = document.getElementById('btn-crouch');

  let lastMobileLeftTap = 0;
  let lastMobileRightTap = 0;
  function triggerDash(_dirSign) {
    if (!sessionActive()) return;
    haptic('heavy');
    session.input.dash = true; sessionSendInput();
    setTimeout(() => { session.input.dash = false; sessionSendInput(); }, 80);
  }

  function touchDirDoubleTap(isLeft) {
    const now = Date.now();
    if (isLeft) {
      if (now - lastMobileLeftTap < DOUBLE_TAP_MS) {
        triggerDash(-1);
        lastMobileLeftTap = 0;
      } else {
        lastMobileLeftTap = now;
      }
    } else if (now - lastMobileRightTap < DOUBLE_TAP_MS) {
      triggerDash(1);
      lastMobileRightTap = 0;
    } else {
      lastMobileRightTap = now;
    }
  }

  function haptic(preset) {
    if (window.haptics && window.haptics.trigger) window.haptics.trigger(preset);
  }

  function mobileBtn(btn, onDown, onUp, hapticPreset) {
    if (!btn) return;
    const preset = hapticPreset || 'selection';
    btn.addEventListener('touchstart', e => { e.preventDefault(); haptic(preset); onDown(); }, { passive: false });
    btn.addEventListener('touchend', e => { e.preventDefault(); onUp(); }, { passive: false });
    btn.addEventListener('touchcancel', e => { e.preventDefault(); onUp(); }, { passive: false });
    btn.addEventListener('mousedown', onDown);
    btn.addEventListener('mouseup', onUp);
    btn.addEventListener('mouseleave', onUp);
  }

  function mobileBtnPlaying(btn, onDown, onUp, hapticPreset) {
    if (!btn) return;
    const down = () => {
      if (state.phase === 'paused') { resumeFromPause(); return; }
      onDown();
    };
    mobileBtn(btn, down, onUp, hapticPreset);
  }

  function mobileTap(btn, handler, hapticPreset) {
    if (!btn) return;
    const preset = hapticPreset || 'light';
    const run = e => {
      if (e.type === 'mousedown' && e.button !== 0) return;
      e.preventDefault();
      handler();
    };
    btn.addEventListener('touchstart', e => { e.preventDefault(); haptic(preset); handler(); }, { passive: false });
    btn.addEventListener('click', run);
  }

  mobileBtnPlaying(btnLeft, () => {
    touchDirDoubleTap(true);
    if (state.phase !== 'playing' || !sessionActive()) return;
    session.input.left = true; sessionSendInput();
  }, () => {
    if (sessionActive()) { session.input.left = false; sessionSendInput(); }
  }, 'selection');
  mobileBtnPlaying(btnRight, () => {
    touchDirDoubleTap(false);
    if (state.phase !== 'playing' || !sessionActive()) return;
    session.input.right = true; sessionSendInput();
  }, () => {
    if (sessionActive()) { session.input.right = false; sessionSendInput(); }
  }, 'selection');
  mobileBtnPlaying(btnJump, () => {
    if (state.phase !== 'playing' || !sessionActive()) return;
    state.mobileJumpHeld = true;
    session.input.jump = true; sessionSendInput();
  }, () => {
    state.mobileJumpHeld = false;
    if (sessionActive()) { session.input.jump = false; sessionSendInput(); }
  }, 'medium');
  mobileBtnPlaying(btnSprint, () => {
    if (state.phase !== 'playing' || !sessionActive()) return;
    state.mobileSprintHeld = true;
    session.input.sprint = true; sessionSendInput();
  }, () => {
    state.mobileSprintHeld = false;
    if (sessionActive()) { session.input.sprint = false; sessionSendInput(); }
  }, 'light');
  mobileBtnPlaying(btnCrouch, () => {
    if (state.phase !== 'playing' || !sessionActive()) return;
    state.mobileCrouch = true;
    session.input.crouch = true; sessionSendInput();
  }, () => {
    state.mobileCrouch = false;
    if (sessionActive()) { session.input.crouch = false; sessionSendInput(); }
  }, 'light');
  mobileTap(btnPause, () => {
    if (state.phase === 'playing') pauseGameplay();
    else if (state.phase === 'paused') resumeFromPause();
  }, 'light');

  // start / restart game
  function startGame() {
    menu.scoreSubmitted = false;
    teardownSession();
    const s = freshState();
    s.phase = 'playing';
    s.gameStartTime = Date.now();
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

    if (window.ShapescapeSession && window.ShapescapeSession.startSolo) {
      const cheatsCopy = {};
      for (const k of ALL_CHEAT_KEYS) cheatsCopy[k] = !!menu.cheats[k];
      session.active = true;
      session.kind = 'local';
      const handle = window.ShapescapeSession.startSolo({
        name: menu.playerName || 'ANON',
        mode: 'coop',
        cheats: cheatsCopy,
        onState: snapshot => {
          if (!session.localId && session.handle) session.localId = session.handle.getLocalId();
          applyMultiplayerSnapshot(snapshot);
        }
      });
      session.handle = handle;
      session.localId = handle.getLocalId();
    }
  }

  function playerHitH() {
    return state.crouching ? CHAR_H_CROUCH : CHAR_H;
  }

  /** Feet stay at world `y`; corpse is scaled to CHAR_H tall, centered on the 32px player slot. */
  function drawPlayerCorpseSprite(x, y, direction, cam, fillFallback, damageFlash) {
    const img = assets.dead;
    const dh = CHAR_H;
    const dw =
      img && img.naturalWidth && img.naturalHeight
        ? Math.max(1, Math.round(img.naturalWidth * (dh / img.naturalHeight)))
        : CHAR_W;
    const px = x + (CHAR_W - dw) / 2 - cam;
    const py = H - y - dh;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if ((direction || 'right') === 'left') {
      ctx.translate(px + dw, py);
      ctx.scale(-1, 1);
    } else ctx.translate(px, py);
    if (img && img.complete) ctx.drawImage(img, 0, 0, dw, dh);
    else {
      ctx.fillStyle = fillFallback;
      ctx.fillRect(0, 0, dw, dh);
    }
    if (damageFlash > 0) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(255,51,51,${Math.min(0.6, (damageFlash || 0) / 12 * 0.6)})`;
      ctx.fillRect(0, 0, dw, dh);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.imageSmoothingEnabled = true;
    ctx.restore();
  }

  function hasCheatsEnabled() {
    return ALL_CHEAT_KEYS.some(function (k) { return menu.cheats[k]; });
  }

  function onGameOver() {
    if (menu.scoreSubmitted) return;
    menu.scoreSubmitted = true;
    // Leaderboard gate: only skip when cheats were enabled during the run. Both solo
    // (LocalSession) and multiplayer (NetworkSession) runs submit through the same path.
    if (hasCheatsEnabled()) return;
    const name = menu.playerName || 'ANON';
    const survivedSec = Math.floor((Date.now() - state.gameStartTime) / 1000);
    submitScore(name, state.score, survivedSec);
  }

  // render — called every frame after update
  let walkFrame = 0, walkTimer = 0;
  let crouchWalkFrame = 0, crouchWalkTimer = 0;

  // Render another player's in-progress shape draft (dragging, polygon points
  // so far, bezier control points). Mirrors the local preview geometry but uses
  // a marching-ant dash so it reads as "live", plus a small name tag anchored
  // to the draft's top-left so you can tell who is drawing what.
  function drawRemoteDraft(draft, cam, name) {
    if (!draft || !draft.tool) return;
    const tool = draft.tool;
    ctx.save();
    ctx.setLineDash([5, 5]);
    // Marching-ant offset — tied to frameTick so every remote draft shares the
    // same animation phase on this client.
    ctx.lineDashOffset = -(frameTick * 0.5) % 10;
    ctx.lineWidth = 1;
    ctx.strokeStyle = COL.amber;
    ctx.globalAlpha = 0.75;

    let anchorX = null;
    let anchorY = null;

    if ((tool === 'square' || tool === 'circle' || tool === 'triangle' || tool === 'line')
        && draft.start && draft.end) {
      const s = draft.start, e = draft.end;
      const dw = Math.abs(e.x - s.x), dh = Math.abs(e.y - s.y);
      if (tool === 'circle') {
        const ccx = (s.x + e.x) / 2 - cam;
        const ccy = H - (s.y + e.y) / 2;
        const r = Math.min(dw, dh) / 2;
        ctx.beginPath(); ctx.arc(ccx, ccy, r, 0, Math.PI * 2); ctx.stroke();
        anchorX = ccx - r; anchorY = ccy - r;
      } else if (tool === 'triangle') {
        const tsx = Math.min(s.x, e.x), tsy = Math.min(s.y, e.y);
        ctx.beginPath();
        ctx.moveTo(tsx + dw / 2 - cam, H - (tsy + dh));
        ctx.lineTo(tsx - cam, H - tsy);
        ctx.lineTo(tsx + dw - cam, H - tsy);
        ctx.closePath(); ctx.stroke();
        anchorX = tsx - cam; anchorY = H - (tsy + dh);
      } else if (tool === 'line') {
        ctx.beginPath();
        ctx.moveTo(s.x - cam, H - s.y);
        ctx.lineTo(e.x - cam, H - e.y);
        ctx.stroke();
        anchorX = Math.min(s.x, e.x) - cam;
        anchorY = Math.min(H - s.y, H - e.y);
      } else {
        const sx = Math.min(s.x, e.x) - cam;
        const sy = H - Math.max(s.y, e.y);
        ctx.strokeRect(sx, sy, dw, dh);
        anchorX = sx; anchorY = sy;
      }
    } else if (tool === 'polygon' && draft.points && draft.points.length > 0) {
      const pts = draft.points;
      ctx.beginPath();
      ctx.moveTo(pts[0].x - cam, H - pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x - cam, H - pts[i].y);
      if (draft.cursor) ctx.lineTo(draft.cursor.x - cam, H - draft.cursor.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of pts) {
        ctx.fillStyle = COL.amber;
        ctx.beginPath(); ctx.arc(p.x - cam, H - p.y, 2, 0, Math.PI * 2); ctx.fill();
      }
      let minX = pts[0].x, maxY = pts[0].y;
      for (const p of pts) { if (p.x < minX) minX = p.x; if (p.y > maxY) maxY = p.y; }
      anchorX = minX - cam; anchorY = H - maxY;
    } else if (tool === 'bezier' && draft.points && draft.points.length > 0) {
      const bp = draft.points;
      if (bp.length === 1 && draft.cursor) {
        ctx.beginPath();
        ctx.moveTo(bp[0].x - cam, H - bp[0].y);
        ctx.lineTo(draft.cursor.x - cam, H - draft.cursor.y);
        ctx.stroke();
      } else if (bp.length === 2 && draft.cursor) {
        ctx.beginPath();
        ctx.moveTo(bp[0].x - cam, H - bp[0].y);
        ctx.quadraticCurveTo(draft.cursor.x - cam, H - draft.cursor.y, bp[1].x - cam, H - bp[1].y);
        ctx.stroke();
      } else if (bp.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(bp[0].x - cam, H - bp[0].y);
        ctx.lineTo(bp[1].x - cam, H - bp[1].y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const p of bp) {
        ctx.fillStyle = COL.amber;
        ctx.beginPath(); ctx.arc(p.x - cam, H - p.y, 2, 0, Math.PI * 2); ctx.fill();
      }
      anchorX = bp[0].x - cam; anchorY = H - bp[0].y;
    }

    ctx.setLineDash([]);
    ctx.restore();

    if (name && anchorX !== null && anchorY !== null) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = COL.amber;
      ctx.font = '8px ' + FONT_MONO;
      ctx.textAlign = 'left';
      ctx.fillText(name.toUpperCase(), Math.round(anchorX), Math.round(anchorY) - 4);
      ctx.restore();
    }
  }

  // Stable, distinct per-player (owner) portal color pair. A/B hues are 180°
  // apart so they're always visually distinguishable; different owners also
  // get different base hues via a cheap string hash so two players' portals
  // don't collide visually.
  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < (str || '').length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function hslToRgb(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    };
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }
  function portalColorsFor(ownerId, slot) {
    const baseHue = hashString(ownerId || 'local') % 360;
    const hue = (baseHue + (slot === 1 ? 180 : 0)) % 360;
    const [r, g, b] = hslToRgb(hue, 0.85, 0.58);
    const [br, bg, bb] = hslToRgb(hue, 0.85, 0.72);
    const [ir, ig, ib] = hslToRgb(hue, 0.85, 0.42);
    const [dr, dg, db] = hslToRgb(hue, 0.85, 0.16);
    const [vr, vg, vb] = hslToRgb(hue, 0.8, 0.06);
    const hex = (rr, gg, bb2) => '#' + ((1 << 24) + (rr << 16) + (gg << 8) + bb2).toString(16).slice(1);
    return {
      col: hex(r, g, b),
      colBright: hex(br, bg, bb),
      colInner: hex(ir, ig, ib),
      colDark: hex(dr, dg, db),
      colVoid: hex(vr, vg, vb),
      glow: `rgba(${r},${g},${b},0.5)`
    };
  }

  // Renders one portal with the full animated Portal-2 look. `pt.slot` is the
  // per-owner slot (0=A, 1=B) so placement order is visually stable. Each owner
  // gets a unique hue pair so two players' portals can't be confused.
  function drawPortal(pt, cam) {
    const slot = pt.slot === 1 ? 1 : 0;
    const ptx = pt.x - cam, pty = H - pt.y;
    const { col, colBright, colInner, colDark, colVoid, glow } = portalColorsFor(pt.ownerId, slot);
    const pulse = 0.7 + Math.sin(frameTick * 0.08 + slot * 3) * 0.3;

    const PW = 12, PH = 48;
    const px = Math.floor(ptx - PW / 2), py = Math.floor(pty - PH / 2);

    ctx.save();

    ctx.shadowColor = glow; ctx.shadowBlur = 24 * pulse;
    ctx.fillStyle = colDark; ctx.globalAlpha = 0.6 * pulse;
    ctx.fillRect(px - 3, py - 3, PW + 6, PH + 6);
    ctx.shadowBlur = 0;

    ctx.fillStyle = colVoid; ctx.globalAlpha = 0.95;
    ctx.fillRect(px + 2, py + 2, PW - 4, PH - 4);

    for (let sy = 0; sy < PH - 4; sy += 2) {
      const bandPhase = (frameTick * 0.12 + sy * 0.5 + slot * 50) % (PH + 8);
      const bandAlpha = Math.sin(bandPhase / PH * Math.PI) * 0.35 * pulse;
      if (bandAlpha > 0.02) {
        ctx.fillStyle = colInner; ctx.globalAlpha = bandAlpha;
        ctx.fillRect(px + 2, py + 2 + sy, PW - 4, 2);
      }
    }

    for (let k = 0; k < 3; k++) {
      const streakY = ((frameTick * 0.8 + k * 17 + slot * 40) % (PH - 8)) + 4;
      ctx.fillStyle = colBright; ctx.globalAlpha = 0.4 * pulse;
      ctx.fillRect(px + 3, py + Math.floor(streakY), PW - 6, 1);
    }

    ctx.globalAlpha = pulse;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.strokeRect(px, py, PW, PH);

    ctx.strokeStyle = colInner; ctx.lineWidth = 1; ctx.globalAlpha = 0.7 * pulse;
    ctx.strokeRect(px + 1, py + 1, PW - 2, PH - 2);

    ctx.fillStyle = colBright; ctx.globalAlpha = pulse * 0.9;
    ctx.fillRect(px - 1, py - 1, 3, 3);
    ctx.fillRect(px + PW - 2, py - 1, 3, 3);
    ctx.fillRect(px - 1, py + PH - 2, 3, 3);
    ctx.fillRect(px + PW - 2, py + PH - 2, 3, 3);

    for (let p = 0; p < 8; p++) {
      const t = ((frameTick * 0.025 + p / 8 + slot * 0.5) % 1);
      const edgeY = py + t * PH;
      const side = (p % 2 === 0) ? -1 : 1;
      const drift = Math.sin(frameTick * 0.06 + p * 1.7) * 6;
      const edgeX = ptx + side * (PW / 2 + 2 + Math.abs(drift));
      const pAlpha = Math.sin(t * Math.PI) * pulse * 0.7;
      ctx.fillStyle = col; ctx.globalAlpha = pAlpha;
      ctx.fillRect(Math.floor(edgeX) - 1, Math.floor(edgeY) - 1, 2, 2);
    }

    for (let p = 0; p < 4; p++) {
      const t = ((frameTick * 0.03 + p / 4 + slot * 0.3) % 1);
      const edgeX = px + 2 + t * (PW - 4);
      const topBot = (p % 2 === 0) ? -1 : 1;
      const drift = Math.sin(frameTick * 0.07 + p * 2.3) * 5;
      const edgeY = pty + topBot * (PH / 2 + 2 + Math.abs(drift));
      const pAlpha = Math.sin(t * Math.PI) * pulse * 0.5;
      ctx.fillStyle = col; ctx.globalAlpha = pAlpha;
      ctx.fillRect(Math.floor(edgeX) - 1, Math.floor(edgeY) - 1, 2, 2);
    }

    ctx.restore();

    ctx.fillStyle = col; ctx.font = '8px ' + FONT_MONO; ctx.textAlign = 'center';
    ctx.fillText(slot === 0 ? 'A' : 'B', ptx, py - 6); ctx.textAlign = 'left';
  }

  function drawMultiplayerPlayer(player, cam, isLocal) {
    const dead = player.health != null && player.health <= 0;
    if (dead) {
      drawPlayerCorpseSprite(
        player.x,
        player.y,
        player.direction,
        cam,
        isLocal ? COL.bright : COL.primary,
        player.damageFlash || 0
      );
      if (player.name) {
        const px = player.x - cam;
        const py = H - player.y - CHAR_H;
        ctx.fillStyle = isLocal ? COL.cyan : COL.mid;
        ctx.font = '9px ' + FONT_MONO;
        ctx.textAlign = 'center';
        ctx.fillText(player.name.toUpperCase(), px + CHAR_W / 2, py - 8);
        ctx.textAlign = 'left';
      }
      return;
    }

    const moving = Math.abs(player.vx || 0) > 0.15;
    const crouching = !!player.crouching;
    const hitH = crouching ? CHAR_H_CROUCH : CHAR_H;
    const px = player.x - cam;
    const py = H - player.y - CHAR_H;

    // Grapple rope — drawn BEFORE the sprite so the rope anchors under the
    // player rather than over them. Same geometry/colour as the local rope.
    if (player.grapple) {
      const g = player.grapple;
      const gpx = player.x + CHAR_W / 2 - cam;
      const gpy = H - player.y - hitH / 2;
      const gtx = g.tx - cam, gty = H - g.ty;
      ctx.save();
      ctx.strokeStyle = COL.amber; ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(255,204,0,0.4)'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.moveTo(gpx, gpy); ctx.lineTo(gtx, gty); ctx.stroke();
      ctx.fillStyle = COL.amber;
      ctx.beginPath(); ctx.arc(gtx, gty, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // dash afterimage (same geometry as local `state.dashActive` block in render())
    if ((player.dashSeconds || 0) > 0) {
      const ph = hitH;
      ctx.save(); ctx.globalAlpha = 0.3;
      ctx.fillStyle = COL.amber;
      for (let di = 1; di <= 3; di++) {
        const off = di * 10 * ((player.direction || 'right') === 'right' ? -1 : 1);
        ctx.globalAlpha = 0.3 - di * 0.08;
        ctx.fillRect(px + off, py + (CHAR_H - ph), CHAR_W, ph);
      }
      ctx.restore();
    }

    ctx.save(); ctx.imageSmoothingEnabled = false;
    if ((player.direction || 'right') === 'left') { ctx.translate(px + CHAR_W, py); ctx.scale(-1, 1); }
    else ctx.translate(px, py);
    let playerImg;
    if (crouching && moving) playerImg = assets[crouchWalkImages[Math.floor(frameTick / 8) % crouchWalkImages.length]];
    else if (crouching) playerImg = assets.idle_2_crouch;
    else if (moving) playerImg = assets[idleImages[Math.floor(frameTick / 8) % idleImages.length]];
    else playerImg = assets.idle_2;
    if (playerImg && playerImg.complete) ctx.drawImage(playerImg, 0, 0, CHAR_W, CHAR_H);
    else { ctx.fillStyle = isLocal ? COL.bright : COL.primary; ctx.fillRect(0, 0, CHAR_W, CHAR_H); }
    if (player.damageFlash > 0) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(255,51,51,${Math.min(0.6, (player.damageFlash || 0) / 12 * 0.6)})`;
      ctx.fillRect(0, 0, CHAR_W, CHAR_H);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.imageSmoothingEnabled = true; ctx.restore();

    // Sword swing — mirrors the local render block; geometry is in world
    // space so no additional flipping is needed.
    if (player.swordSwing && player.swordSwing.frame <= 12) {
      const sw = player.swordSwing;
      const scx = player.x + CHAR_W / 2 - cam;
      const scy = H - player.y - hitH / 2;
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
      ctx.strokeStyle = COL.primary; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(scx, scy, len, baseAngle, baseAngle + sweep, dirMul < 0);
      ctx.stroke();
      ctx.restore();
    }

    if (player.name) {
      ctx.fillStyle = isLocal ? COL.cyan : COL.mid;
      ctx.font = '9px ' + FONT_MONO;
      ctx.textAlign = 'center';
      ctx.fillText(player.name.toUpperCase(), px + CHAR_W / 2, py - 8);
      ctx.textAlign = 'left';
    }
  }

  function presentCrtFrame() {
    if (!crtRenderer || !menu.crtEnabled) return;
    crtRenderer.render(performance.now() * 0.001);
  }

  let lastPlayingClass = false;
  function render() {
    syncMultiplayerPanel();
    const isPlaying = state.phase === 'playing' || state.phase === 'paused';
    if (isPlaying !== lastPlayingClass) {
      gameWrapper.classList.toggle('game-playing', isPlaying);
      lastPlayingClass = isPlaying;
      requestAnimationFrame(resizeCanvas);
    }
    ctx.clearRect(0, 0, W, H);
    frameTick++;
    tickFps(performance.now());

    if (state.phase === 'menu') {
      fetchLeaderboard();
      updateHotbarDOM();
      drawMenu();
      presentCrtFrame();
      return;
    }

    maybeSendDraftUpdate();

    const cam = state.cameraX;
    const camY = state.cameraY || 0;
    drawSkyAndStars(cam);

    // Vertical camera is applied as a canvas translation so we don't have to thread
    // `camY` through every `H - y` conversion in the renderer. HUD and overlays are
    // drawn after we restore.
    ctx.save();
    ctx.translate(0, camY);

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

    const drawSnapCursor = drawSnapAltHeld ? snapWorldPointToGrid(mouseWorld) : mouseWorld;

    // polygon preview — draw lines between clicked points
    if (state.polyPoints.length > 0) {
      ctx.setLineDash([5, 5]); ctx.strokeStyle = COL.cyan; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(state.polyPoints[0].x - cam, H - state.polyPoints[0].y);
      for (let pi = 1; pi < state.polyPoints.length; pi++) ctx.lineTo(state.polyPoints[pi].x - cam, H - state.polyPoints[pi].y);
      if (mouseOnCanvas) ctx.lineTo(drawSnapCursor.x - cam, H - drawSnapCursor.y);
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
        ctx.lineTo(drawSnapCursor.x - cam, H - drawSnapCursor.y);
        ctx.stroke();
      } else if (bp.length === 2 && mouseOnCanvas) {
        ctx.beginPath();
        ctx.moveTo(bp[0].x - cam, H - bp[0].y);
        ctx.quadraticCurveTo(drawSnapCursor.x - cam, H - drawSnapCursor.y, bp[1].x - cam, H - bp[1].y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const bpp of bp) {
        ctx.fillStyle = COL.amber;
        ctx.beginPath(); ctx.arc(bpp.x - cam, H - bpp.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // remote-player drafts — render what other players are currently drawing
    // before they commit it. Animated dash offset makes it legible at a glance
    // that this is live / in-progress, not a placed shape.
    if (multiplayer.active && multiplayer.remotePlayers.length > 0) {
      for (const rp of multiplayer.remotePlayers) {
        if (rp && rp.drawDraft) drawRemoteDraft(rp.drawDraft, cam, rp.name);
      }
    }

    // portals — Portal 2 style rectangular, pixelated.
    // Draw every visible portal (local + remote) with the same visuals; the
    // sim's per-player slot (0=A, 1=B) drives the colour so a remote player's
    // A still looks blue, their B still looks orange.
    for (const pt of state.portals) drawPortal(pt, cam);
    if (multiplayer.active && multiplayer.remotePlayers.length > 0) {
      for (const rp of multiplayer.remotePlayers) {
        if (rp && rp.portals && rp.portals.length) {
          for (const pt of rp.portals) drawPortal(pt, cam);
        }
      }
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

    // revive tokens (coop) — pulsating green cross, falls into the pool of
    // pickups only when someone on the team is waiting to respawn.
    if (state.revives && state.revives.length) {
      for (const r of state.revives) {
        const rx = r.x - cam, ry = H - r.y;
        const pulse = 0.6 + Math.sin(frameTick * 0.12) * 0.4;
        ctx.save();
        ctx.shadowColor = `rgba(102,255,140,${pulse * 0.7})`;
        ctx.shadowBlur = 14;
        ctx.fillStyle = `rgba(102,255,140,${pulse})`;
        const s = 8;
        ctx.fillRect(Math.floor(rx) - 2, Math.floor(ry) - s, 4, s * 2);
        ctx.fillRect(Math.floor(rx) - s, Math.floor(ry) - 2, s * 2, 4);
        ctx.restore();
        ctx.fillStyle = '#66ff8c';
        ctx.font = '8px ' + FONT_MONO;
        ctx.textAlign = 'center';
        ctx.fillText('REVIVE', rx, ry - 14);
        ctx.textAlign = 'left';
      }
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

    // danglies
    if (window.DanglySystem && state.danglies.length > 0) {
      window.DanglySystem.renderAll(ctx, state.danglies, cam, H, frameTick);
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
      const gpx = state.playerX + CHAR_W / 2 - cam, gpy = H - state.playerY - playerHitH() / 2;
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
    if (state.health > 0 && state.dashActive > 0) {
      const ph = playerHitH();
      const dtx = state.playerX - cam, dty = H - state.playerY - CHAR_H;
      ctx.save(); ctx.globalAlpha = 0.3;
      ctx.fillStyle = COL.amber;
      for (let di = 1; di <= 3; di++) {
        const off = di * 10 * (state.direction === 'right' ? -1 : 1);
        ctx.globalAlpha = 0.3 - di * 0.08;
        ctx.fillRect(dtx + off, dty + (CHAR_H - ph), CHAR_W, ph);
      }
      ctx.restore();
    }

    // glide wing lines above player
    // sim is Y-up: vy < 0 means falling, which is when the glide cosmetic should show.
    if (state.health > 0 && state.activeUpgrades.glide && !state.onGround && state.playerVY < 0 && (state.mobileJumpHeld || keys['Space'] || keys['ArrowUp'] || keys['KeyW'])) {
      const glx = state.playerX + CHAR_W / 2 - cam, gly = H - state.playerY - playerHitH() - 4;
      ctx.save(); ctx.globalAlpha = 0.4;
      ctx.strokeStyle = COL.primary; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(glx - 14, gly + 8); ctx.lineTo(glx, gly); ctx.lineTo(glx + 14, gly + 8);
      ctx.stroke();
      ctx.restore();
    }

    if (multiplayer.active && multiplayer.remotePlayers.length > 0) {
      for (const rp of multiplayer.remotePlayers) drawMultiplayerPlayer(rp, cam, false);
    }

    // player sprite (prone corpse while dead / waiting to respawn)
    if (state.health <= 0) {
      drawPlayerCorpseSprite(state.playerX, state.playerY, state.direction, cam, COL.primary, state.damageFlash);
    } else {
      const isMoving = state.movingLeft || state.movingRight;
      const px = state.playerX - cam, py = H - state.playerY - CHAR_H;
      ctx.save(); ctx.imageSmoothingEnabled = false;
      if (state.direction === 'left') { ctx.translate(px + CHAR_W, py); ctx.scale(-1, 1); }
      else ctx.translate(px, py);
      let playerImg;
      if (state.crouching && isMoving) {
        walkFrame = 0; walkTimer = 0;
        crouchWalkTimer++;
        if (crouchWalkTimer > 7) {
          crouchWalkTimer = 0;
          crouchWalkFrame = (crouchWalkFrame + 1) % crouchWalkImages.length;
        }
        playerImg = assets[crouchWalkImages[crouchWalkFrame]];
      } else if (state.crouching) {
        walkFrame = 0; walkTimer = 0;
        crouchWalkFrame = 0; crouchWalkTimer = 0;
        playerImg = assets.idle_2_crouch;
      } else if (isMoving) {
        crouchWalkFrame = 0; crouchWalkTimer = 0;
        walkTimer++;
        if (walkTimer > (isSprintActive() ? 5 : 8)) { walkTimer = 0; walkFrame = (walkFrame + 1) % 3; }
        playerImg = assets[idleImages[walkFrame]];
      } else {
        playerImg = assets[state.idleImg];
        walkFrame = 0; walkTimer = 0;
        crouchWalkFrame = 0; crouchWalkTimer = 0;
      }
      if (playerImg && playerImg.complete) ctx.drawImage(playerImg, 0, 0, CHAR_W, CHAR_H);
      else { ctx.fillStyle = COL.primary; ctx.fillRect(0, 0, CHAR_W, CHAR_H); }
      if (state.damageFlash > 0) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(255,51,51,${state.damageFlash / 12 * 0.6})`;
        ctx.fillRect(0, 0, CHAR_W, CHAR_H);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.imageSmoothingEnabled = true; ctx.restore();
    }

    // sword swing animation
    if (state.health > 0 && state.swordSwing && state.swordSwing.frame <= 12) {
      const sw = state.swordSwing;
      const scx = state.playerX + CHAR_W / 2 - cam;
      const scy = H - state.playerY - playerHitH() / 2;
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

    // fish boss — procedural wobbly eye (pixelly jelly-bug style)
    if (state.fish.spawned) {
      const fx = state.fish.x - cam, fy = H - state.fish.y;
      const t = frameTick * 0.12;
      const sp = state.fishShootPulse;
      const shootT = sp / 18;
      const shootBulge = Math.sin(shootT * Math.PI) * 0.3;

      const pulse = Math.sin(t) * 0.12;
      const pulse2 = Math.sin(t * 1.7 + 1.0) * 0.08;
      const sxF = 1.0 + pulse + shootBulge;
      const syF = 1.0 - pulse * 0.5 + pulse2 + shootBulge * 0.6;

      const ew = 32, eh = 26;
      const px = 2;

      ctx.save();
      ctx.translate(fx, fy);
      ctx.scale(sxF, syF);
      ctx.imageSmoothingEnabled = false;

      const glowStr = 0.35 + shootBulge * 0.8;
      ctx.shadowColor = `rgba(255,51,51,${glowStr.toFixed(2)})`;
      ctx.shadowBlur = 10 + shootBulge * 18;

      // sclera — stacked rects forming a diamond/eye shape
      const r1 = Math.floor(190 + Math.sin(t * 0.7) * 35 + shootBulge * 55);
      const g1 = Math.floor(35 + Math.sin(t * 1.3) * 15 - shootBulge * 25);
      ctx.fillStyle = `rgb(${r1},${g1},${g1})`;
      ctx.fillRect(-ew * 0.25, -eh / 2, ew * 0.5, px);
      ctx.fillRect(-ew * 0.38, -eh / 2 + px, ew * 0.76, px);
      ctx.fillRect(-ew / 2, -eh / 2 + px * 2, ew, eh - px * 4);
      ctx.fillRect(-ew * 0.38, eh / 2 - px * 2, ew * 0.76, px);
      ctx.fillRect(-ew * 0.25, eh / 2 - px, ew * 0.5, px);

      ctx.shadowBlur = 0;

      // vein detail rects
      const vr = Math.floor(150 + Math.sin(t * 2.3) * 30);
      ctx.fillStyle = `rgba(${vr},15,15,0.3)`;
      const vox1 = Math.floor(Math.sin(t * 1.2) * 2);
      const voy1 = Math.floor(Math.cos(t * 0.9) * 1);
      ctx.fillRect(-ew / 2 + px + vox1, -px + voy1, px, px);
      ctx.fillRect(ew / 2 - px * 2 - vox1, px + voy1, px, px);
      ctx.fillRect(-ew / 2 + px * 2 - voy1, -eh / 2 + px * 2 + vox1, px, px);
      ctx.fillRect(ew / 2 - px * 3 + voy1, eh / 2 - px * 3 - vox1, px, px);
      ctx.fillRect(-px * 3 + vox1, -eh / 2 + px * 2, px, px);
      ctx.fillRect(px * 2 - vox1, eh / 2 - px * 3, px, px);

      // iris — inner colored block that wobbles
      const iw = Math.floor(14 + shootBulge * 4);
      const ih = Math.floor(12 + shootBulge * 3);
      const iwx = Math.floor(Math.sin(t * 1.5) * 2);
      const iwy = Math.floor(Math.cos(t * 1.8) * 1.5);
      const iR2 = Math.floor(170 + shootBulge * 60);
      ctx.fillStyle = `rgb(${iR2},20,0)`;
      ctx.fillRect(-iw / 2 + iwx, -ih / 2 + iwy, iw, ih);

      // iris inner sub-blocks (like the bug's inner pulse rects)
      const innerPulse = Math.sin(t * 2.3) * 0.4 + 0.5;
      ctx.fillStyle = `rgba(255,60,0,${(0.15 + innerPulse * 0.15).toFixed(2)})`;
      const sox = Math.floor(Math.sin(t * 1.8) * 1.5);
      const soy = Math.floor(Math.cos(t * 2.1) * 1);
      ctx.fillRect(-iw * 0.2 + iwx + sox, -ih * 0.2 + iwy + soy, iw * 0.35, ih * 0.35);
      ctx.fillRect(iwx - sox, iwy - soy + 1, iw * 0.25, ih * 0.25);

      // iris border
      const g2 = Math.floor(60 + Math.sin(t * 0.7) * 20);
      ctx.strokeStyle = `rgb(${g2},5,0)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(-iw / 2 + iwx, -ih / 2 + iwy, iw, ih);

      // pupil — small dark block, contracts on shoot, tracks player
      const pw = Math.max(px, Math.floor(6 - shootBulge * 3));
      const ph = Math.max(px, Math.floor(6 - shootBulge * 2));
      const lookAngle = state.fish.rotation || 0;
      const lookDist = 2 + Math.sin(t * 0.8) * 0.5;
      const pupX = Math.floor(iwx + Math.cos(lookAngle) * lookDist);
      const pupY = Math.floor(iwy - Math.sin(lookAngle) * lookDist);
      ctx.fillStyle = '#0a0000';
      ctx.fillRect(pupX - pw / 2, pupY - ph / 2, pw, ph);

      // specular highlight pixel
      ctx.fillStyle = `rgba(255,200,180,${(0.5 + Math.sin(t * 1.1) * 0.15).toFixed(2)})`;
      ctx.fillRect(pupX - pw / 2 - 1, pupY - ph / 2 - 1, px, px);

      // outer border
      const br = Math.floor(100 + Math.sin(t * 0.6) * 25);
      ctx.strokeStyle = `rgb(${br},8,8)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(-ew / 2, -eh / 2 + px * 2, ew, eh - px * 4);

      // shoot flash — expanding pixel ring
      if (sp > 0) {
        const flashAlpha = shootT * 0.6;
        const flashOff = Math.floor((1 - shootT) * 6);
        ctx.fillStyle = `rgba(255,100,50,${flashAlpha.toFixed(2)})`;
        ctx.fillRect(-ew / 2 - px - flashOff, -px, px, px * 2);
        ctx.fillRect(ew / 2 + flashOff, -px, px, px * 2);
        ctx.fillRect(-px, -eh / 2 - px - flashOff, px * 2, px);
        ctx.fillRect(-px, eh / 2 + flashOff, px * 2, px);
        ctx.fillRect(-ew / 2 + px - flashOff, -eh / 2 + px - flashOff, px, px);
        ctx.fillRect(ew / 2 - px + flashOff, -eh / 2 + px - flashOff, px, px);
        ctx.fillRect(-ew / 2 + px - flashOff, eh / 2 - px + flashOff, px, px);
        ctx.fillRect(ew / 2 - px + flashOff, eh / 2 - px + flashOff, px, px);
      }

      ctx.imageSmoothingEnabled = true;
      ctx.restore();

      // HP bar above the eye
      const fhpW = 30, fhpH = 3;
      const barYOff = (eh / 2) * syF + 8;
      const fhpX = fx - fhpW / 2, fhpY = fy - barYOff - fhpH;
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

    // hit particles — pixelly squares that fade out
    for (const pt of state.particles) {
      const alpha = pt.life / pt.maxLife;
      const ptx = pt.x - cam - pt.size / 2, pty = H - pt.y - pt.size / 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = pt.color; ctx.shadowBlur = 4 * alpha;
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.floor(ptx), Math.floor(pty), pt.size, pt.size);
      ctx.restore();
    }

    // ice shards — glowing cyan diamond
    for (const s of state.iceShards) {
      const sx = s.x - cam, sy = H - s.y;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(s.vy, s.vx));
      ctx.shadowColor = 'rgba(0,255,204,0.7)'; ctx.shadowBlur = 12;
      ctx.fillStyle = COL.cyan;
      ctx.beginPath();
      ctx.moveTo(8, 0); ctx.lineTo(0, -3); ctx.lineTo(-4, 0); ctx.lineTo(0, 3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(1, -1.5); ctx.lineTo(-1, 0); ctx.lineTo(1, 1.5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // laser — one red circle per shot (sim stores position + velocity; life is seconds)
    for (const l of state.laserBeams) {
      const lx = l.x - cam, ly = H - l.y;
      const alpha = Math.min(1, l.life * 2);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = 'rgba(255,50,50,0.65)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = COL.red;
      ctx.beginPath();
      ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // frozen ring around individually frozen bugs
    for (const b of state.bugs) {
      if (b.frozen > 0) {
        const bx = b.x + 7 - cam, by = H - b.y - 6;
        ctx.save();
        ctx.strokeStyle = COL.cyan; ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(0,255,204,0.5)'; ctx.shadowBlur = 8;
        ctx.globalAlpha = 0.4 + Math.sin(frameTick * 0.15) * 0.3;
        ctx.beginPath(); ctx.arc(bx, by, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.font = '8px ' + FONT_MONO; ctx.fillStyle = COL.cyan; ctx.textAlign = 'center';
        ctx.fillText('\u2744', bx, by - 14);
        ctx.textAlign = 'left';
        ctx.restore();
      }
    }

    // frozen ring around individually frozen danglies
    for (const d of state.danglies) {
      if (d.frozen > 0) {
        const dx = d.x + 9 - cam, dy = H - d.y - 17;
        ctx.save();
        ctx.strokeStyle = COL.cyan; ctx.lineWidth = 1.5;
        ctx.shadowColor = 'rgba(0,255,204,0.5)'; ctx.shadowBlur = 8;
        ctx.globalAlpha = 0.4 + Math.sin(frameTick * 0.15) * 0.3;
        ctx.beginPath(); ctx.arc(dx, dy, 20, 0, Math.PI * 2); ctx.stroke();
        ctx.font = '10px ' + FONT_MONO; ctx.fillStyle = COL.cyan; ctx.textAlign = 'center';
        ctx.fillText('\u2744', dx, dy - 22);
        ctx.textAlign = 'left';
        ctx.restore();
      }
    }

    ctx.restore();

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
      ctx.fillText(multiplayer.active ? 'MATCH MENU' : 'PAUSED', W / 2, panelY + 74); ctx.restore();

      const hintPx = W < 360 ? 9 : W < 480 ? 10 : 12;
      ctx.font = hintPx + 'px ' + FONT_MONO;
      ctx.textAlign = 'center';
      const exitLabel = multiplayer.active ? 'LEAVE MATCH' : 'MAIN MENU';
      if (isMobilePauseHints()) {
        ctx.fillStyle = COL.mid;
        ctx.fillText('OUTSIDE / ESC / \u2630  \u2500  RESUME', W / 2, panelY + 115);
        ctx.fillStyle = COL.dim;
        ctx.fillText('TAP BOX  \u2500  ' + exitLabel, W / 2, panelY + 138);
      } else {
        ctx.fillStyle = COL.mid;
        ctx.fillText('OUTSIDE / ESC / ENTER / SPACE  \u2500  RESUME', W / 2, panelY + 115);
        ctx.fillStyle = COL.dim;
        ctx.fillText('PANEL / Q  \u2500  ' + exitLabel, W / 2, panelY + 138);
      }

      const elapsed = Math.floor((state.pauseStart - state.gameStartTime) / 1000);
      ctx.fillStyle = COL.shadow; ctx.font = '10px ' + FONT_MONO;
      ctx.fillText('T+' + String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0') + '  \u2502  SCORE: ' + state.score, W / 2, panelY + 168);
      ctx.textAlign = 'left';
    }

    presentCrtFrame();
  }

  // HUD — health bar, score, active upgrade tags, timer, coords
  function drawHUD() {
    const x = 10, y = 8;
    const hp = Math.max(0, state.health);
    const barW = 120, barH = 12;

    const hudMobile = isMobilePauseHints();
    const mpConnected = multiplayer.active && multiplayer.connected;
    const scoreSecondRow = hudMobile && mpConnected;
    const tagRightPad = mpConnected ? 220 : 10;

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
    const hpPctX = x + 22 + barW + 6;
    ctx.fillText(hp + '%', hpPctX, y + 10);
    const hpRowTagStart = hpPctX + ctx.measureText(hp + '%').width + 16;

    const scoreBaselineY = scoreSecondRow ? y + 22 : y + 10;
    const scoreX = x + 22 + barW + 50;
    if (scoreSecondRow) {
      const scoreLeft = x + 22;
      const maxRight = W - tagRightPad;
      let px = 10;
      for (; px >= 8; px--) {
        ctx.font = px + 'px ' + FONT_MONO;
        const numX = scoreLeft + ctx.measureText('SCORE:').width + 4;
        const totalRight = numX + ctx.measureText(String(state.score)).width;
        if (totalRight <= maxRight || px === 8) break;
      }
      ctx.fillStyle = COL.mid;
      ctx.fillText('SCORE:', scoreLeft, scoreBaselineY);
      ctx.fillStyle = COL.bright;
      ctx.save(); ctx.shadowColor = COL.glowWeak; ctx.shadowBlur = 6;
      ctx.fillText(String(state.score), scoreLeft + ctx.measureText('SCORE:').width + 4, scoreBaselineY);
      ctx.restore();
    } else {
      ctx.font = '10px ' + FONT_MONO;
      ctx.fillStyle = COL.mid;
      ctx.fillText('SCORE:', scoreX, scoreBaselineY);
      ctx.fillStyle = COL.bright;
      ctx.save(); ctx.shadowColor = COL.glowWeak; ctx.shadowBlur = 6;
      ctx.fillText(String(state.score), scoreX + 52, scoreBaselineY);
      ctx.restore();
    }

    ctx.font = '10px ' + FONT_MONO;
    let tagX = scoreSecondRow
      ? hpRowTagStart
      : scoreX + 52 + ctx.measureText(String(state.score)).width + 16;
    let tagY = y;
    const tagGap = 16;
    const tagLineH = scoreSecondRow ? 18 : 15;
    const tagWrapX = x;
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
      if (!state.activeUpgrades[key]) continue;
      const tw = ctx.measureText(label).width + 8;
      if (tagX + tw > W - tagRightPad) {
        tagX = tagWrapX;
        tagY += tagLineH;
      }
      drawTag(tagX, tagY, label, bc, tc);
      tagX += ctx.measureText(label).width + tagGap;
    }

    ctx.fillStyle = COL.shadow; ctx.font = '9px ' + FONT_MONO;
    const elapsed = Math.floor((Date.now() - state.gameStartTime) / 1000);
    ctx.fillText('T+' + String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0'), 10, H - 8);
    ctx.textAlign = 'right';
    ctx.fillText('X:' + Math.floor(state.playerX) + ' Y:' + Math.floor(state.playerY), W - 10, H - 8);
    ctx.textAlign = 'left';

    drawMultiplayerStats();
  }

  // Top-right multiplayer HUD: plain text, no panel. Left column = player count +
  // names; right column = net stats (flush to screen right).
  function drawMultiplayerStats() {
    if (!multiplayer.active || !multiplayer.connected) return;
    if (!session.handle || typeof session.handle.getStats !== 'function') return;

    const stats = session.handle.getStats();
    const snap = multiplayer.snapshot;

    const rawPlayers = snap ? Object.values(snap.players || {}) : [];
    const connected = rawPlayers.filter(p => p.connected).length;
    const total = stats.playerCount || rawPlayers.length;
    const connectedDisplay = Math.max(connected, stats.connectedCount || 0);

    const pingMs = stats.pingMs >= 0 ? Math.round(stats.pingMs) : null;
    const snapHz = stats.snapshotHz ? stats.snapshotHz.toFixed(0) : '--';
    const fps = fpsMeter.value ? Math.round(fpsMeter.value) : null;
    const room = (multiplayer.roomCode || snap?.roomId || '').toUpperCase();
    const modeLabel = (snap?.mode || multiplayer.mode || 'COOP').toUpperCase();
    const hostId = snap?.hostId;

    const pingColor = pingMs == null ? COL.shadow
      : pingMs < 80 ? COL.primary
      : pingMs < 160 ? COL.amberPri
      : COL.red;
    const fpsColor = fps == null ? COL.shadow
      : fps >= 55 ? COL.primary
      : fps >= 30 ? COL.amberPri
      : COL.red;
    const netColor = stats.snapshotAgeMs > 1500 ? COL.amberPri
      : stats.snapshotAgeMs > 500 ? COL.mid
      : COL.primary;

    const font = '9px ' + FONT_MONO;
    const lineH = 11;
    const rightPad = 10;
    const colGap = 20;
    const topBaseline = 10;

    const sortedPlayers = rawPlayers.slice().sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
    );

    ctx.save();
    ctx.font = font;
    ctx.textAlign = 'right';

    const statRows = [
      ['ROOM', room || '------', COL.bright],
      ['MODE', modeLabel, COL.primary],
      ['PING', pingMs == null ? '---MS' : pingMs + 'MS', pingColor],
      ['NET', snapHz + 'HZ', netColor],
      ['FPS', fps == null ? '--' : String(fps), fpsColor],
    ];

    const countLine = connectedDisplay + '/' + total + ' PLAYERS';
    let playersColW = ctx.measureText(countLine).width;
    for (const p of sortedPlayers) {
      let line = String(p.name || 'ANON').toUpperCase().slice(0, 18);
      if (p.id === multiplayer.localId) line += ' [YOU]';
      if (hostId && p.id === hostId) line += ' [HOST]';
      playersColW = Math.max(playersColW, ctx.measureText(line).width);
    }

    let statsColW = 0;
    for (const [label, value] of statRows) {
      statsColW = Math.max(statsColW, ctx.measureText(label + '  ' + value).width);
    }

    const statsRight = W - rightPad;
    const playersRight = statsRight - statsColW - colGap;

    function drawLabeledRow(label, value, valueColor, rightX, baseline) {
      ctx.font = font;
      ctx.fillStyle = valueColor;
      ctx.textAlign = 'right';
      ctx.fillText(value, rightX, baseline);
      const vw = ctx.measureText(value).width;
      ctx.fillStyle = COL.mid;
      ctx.fillText(label + '  ', rightX - vw, baseline);
    }

    let y = topBaseline;
    ctx.fillStyle = COL.mid;
    ctx.textAlign = 'right';
    ctx.fillText(countLine, playersRight, y);
    y += lineH;

    for (const p of sortedPlayers) {
      let line = String(p.name || 'ANON').toUpperCase().slice(0, 18);
      if (p.id === multiplayer.localId) line += ' [YOU]';
      if (hostId && p.id === hostId) line += ' [HOST]';
      const isYou = p.id === multiplayer.localId;
      ctx.fillStyle = isYou ? COL.bright : COL.primary;
      ctx.textAlign = 'right';
      ctx.fillText(line, playersRight, y);
      y += lineH;
    }

    const now = Date.now();
    const liveNotifs = multiplayer.playerNotifs.filter(n => now - n.joinedAt < NOTIF_DURATION_MS);
    multiplayer.playerNotifs = liveNotifs;
    if (liveNotifs.length > 0) {
      y += 4;
      for (const notif of liveNotifs) {
        const age = now - notif.joinedAt;
        const fadeStart = NOTIF_DURATION_MS * 0.6;
        const alpha = age > fadeStart
          ? 1 - (age - fadeStart) / (NOTIF_DURATION_MS - fadeStart)
          : 1;
        const baseColor = notif.type === 'join' ? '255,255,85' : '170,170,170';
        ctx.fillStyle = 'rgba(' + baseColor + ',' + alpha.toFixed(2) + ')';
        ctx.textAlign = 'right';
        ctx.fillText(notif.text, playersRight, y);
        y += lineH;
      }
    }

    y = topBaseline;
    for (const [label, value, valueColor] of statRows) {
      drawLabeledRow(label, value, valueColor, statsRight, y);
      y += lineH;
    }

    ctx.textAlign = 'left';
    ctx.restore();
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

    normalizeMenuSelection();
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

    if (menu.multiplayerMode) {
      const mpStartIndex = items.indexOf('mp_room');
      const mpEndIndex = items.indexOf('mp_status');
      if (mpStartIndex >= 0 && mpEndIndex >= mpStartIndex) {
        const startRow = layout[mpStartIndex];
        const endRow = layout[mpEndIndex];
        const startHalf = getMenuRowHeight(items[mpStartIndex]) / 2;
        const endHalf = getMenuRowHeight(items[mpEndIndex]) / 2;
        const panelTop = startRow.y - startHalf - 28;
        const panelBottom = endRow.y + endHalf + 10;
        const panelH = panelBottom - panelTop;
        ctx.fillStyle = 'rgba(38, 28, 0, 0.92)';
        ctx.fillRect(rowX - 4, panelTop, rowW + 8, panelH);
        ctx.strokeStyle = 'rgba(255, 204, 0, 0.42)';
        ctx.lineWidth = 1;
        ctx.strokeRect(rowX - 4, panelTop, rowW + 8, panelH);
        ctx.fillStyle = 'rgba(255, 204, 0, 0.08)';
        ctx.fillRect(rowX - 3, panelTop + 1, rowW + 6, 22);
        ctx.strokeStyle = 'rgba(255, 204, 0, 0.22)';
        ctx.beginPath();
        ctx.moveTo(rowX - 3, panelTop + 23);
        ctx.lineTo(rowX + rowW + 3, panelTop + 23);
        ctx.stroke();
      }
    }

    for (let i = 0; i < items.length; i++) {
      const row = layout[i], item = items[i];
      const selectable = isSelectableMenuItem(item);
      const selected = selectable && i === menu.selectedIndex;
      const isCat = item.startsWith('cat_');
      const isCheat = item.startsWith('cheat_');
      const labelX = colL + (selected ? 12 : 0);
      const isSmall = isCheat;
      const rowH = getMenuRowHeight(item);
      const rowHalf = rowH / 2;

      if (item === 'name') {
        ctx.fillStyle = COL.dim; ctx.font = '11px ' + FONT_MONO; ctx.textAlign = 'center';
        ctx.fillText('\u2500\u2500  PLAYER  \u2500\u2500', cx, row.y - 18);
      } else if (item === 'mp_room') {
        ctx.fillStyle = COL.amber; ctx.font = 'bold 11px ' + FONT_MONO; ctx.textAlign = 'center';
        ctx.fillText('\u2500\u2500  MULTIPLAYER  \u2500\u2500', cx, row.y - 29);
      }

      if (selected && item !== 'mode') {
        const mpSelected = isMultiplayerMenuItem(item);
        ctx.fillStyle = mpSelected ? 'rgba(255, 204, 0, 0.10)' : COL.ghost;
        ctx.fillRect(rowX, row.y - rowHalf, rowW, rowH);
        ctx.strokeStyle = mpSelected ? 'rgba(255, 204, 0, 0.26)' : COL.shadow;
        ctx.lineWidth = 1;
        ctx.strokeRect(rowX, row.y - rowHalf, rowW, rowH);
        ctx.fillStyle = mpSelected ? COL.amber : COL.bright;
        ctx.font = (isSmall ? '11' : '14') + 'px ' + FONT_MONO; ctx.textAlign = 'left';
        ctx.fillText('>', colL - 2, row.y + (isSmall ? 4 : 5));
      }

      const textColor = isMultiplayerMenuItem(item)
        ? (selected ? COL.amber : COL.amberPri)
        : (selected ? COL.bright : COL.mid);

      if (item === 'mode') {
        const segLeft = rowX;
        const segW = rowW;
        const segHalf = segW / 2;
        const top = row.y - rowHalf + 3;
        const h = rowH - 6;
        const soloOn = !menu.multiplayerMode;
        const mpOn = menu.multiplayerMode;
        let innerPadX = Math.max(3, Math.min(7, Math.floor(segHalf * 0.12)));
        innerPadX = Math.min(innerPadX, Math.max(0, Math.floor((segHalf - 4) / 2)));
        innerPadX = Math.max(2, innerPadX - 1);
        const innerPadY = 5;

        ctx.fillStyle = 'rgba(0, 10, 0, 0.5)';
        ctx.fillRect(segLeft, top, segHalf, h);
        ctx.fillStyle = 'rgba(20, 14, 0, 0.45)';
        ctx.fillRect(segLeft + segHalf, top, segHalf, h);

        if (soloOn && innerPadX * 2 < segHalf - 2 && innerPadY * 2 < h - 2) {
          ctx.fillStyle = selected ? 'rgba(51, 255, 51, 0.24)' : 'rgba(51, 255, 51, 0.12)';
          ctx.fillRect(segLeft + innerPadX, top + innerPadY, segHalf - innerPadX * 2, h - innerPadY * 2);
          ctx.strokeStyle = selected ? 'rgba(51, 255, 51, 0.45)' : 'rgba(51, 255, 51, 0.22)';
          ctx.lineWidth = 1;
          ctx.strokeRect(segLeft + innerPadX + 0.5, top + innerPadY + 0.5, segHalf - innerPadX * 2 - 1, h - innerPadY * 2 - 1);
        }
        if (mpOn && innerPadX * 2 < segHalf - 2 && innerPadY * 2 < h - 2) {
          ctx.fillStyle = selected ? 'rgba(255, 204, 0, 0.22)' : 'rgba(255, 204, 0, 0.11)';
          ctx.fillRect(segLeft + segHalf + innerPadX, top + innerPadY, segHalf - innerPadX * 2, h - innerPadY * 2);
          ctx.strokeStyle = selected ? 'rgba(255, 204, 0, 0.5)' : 'rgba(255, 204, 0, 0.25)';
          ctx.lineWidth = 1;
          ctx.strokeRect(segLeft + segHalf + innerPadX + 0.5, top + innerPadY + 0.5, segHalf - innerPadX * 2 - 1, h - innerPadY * 2 - 1);
        }

        ctx.strokeStyle = selected ? COL.primary : COL.shadow;
        ctx.lineWidth = selected ? 2 : 1;
        ctx.strokeRect(rowX, top, rowW, h);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(segLeft + segHalf, top);
        ctx.lineTo(segLeft + segHalf, top + h);
        ctx.stroke();

        const mpLabel = rowW < 300 ? 'MULTI' : 'MULTIPLAYER';
        ctx.font = (rowW < 280 ? '11px ' : '13px ') + FONT_MONO;
        ctx.textAlign = 'center';
        ctx.fillStyle = soloOn ? COL.bright : COL.dim;
        ctx.save();
        if (soloOn && selected) { ctx.shadowColor = COL.glowStrong; ctx.shadowBlur = 10; }
        ctx.fillText('SOLO', segLeft + segHalf * 0.5, row.y + 5);
        ctx.restore();
        ctx.fillStyle = mpOn ? COL.amber : COL.amberDim;
        ctx.save();
        if (mpOn && selected) { ctx.shadowColor = 'rgba(255,204,0,0.4)'; ctx.shadowBlur = 10; }
        ctx.fillText(mpLabel, segLeft + segHalf * 1.5, row.y + 5);
        ctx.restore();
      } else if (item === 'start') {
        const startLabel = getStartMenuLabel();
        let startPx = compact ? 15 : 18;
        if (rowW < 260) startPx = 13;
        if (rowW < 200) startPx = 11;
        ctx.textAlign = 'center';
        ctx.fillStyle = menu.multiplayerMode ? (selected ? COL.amber : COL.amberPri) : textColor;
        for (;;) {
          ctx.font = startPx + 'px ' + FONT_MONO;
          if (ctx.measureText(startLabel).width <= rowW - 16 || startPx <= 9) break;
          startPx--;
        }
        ctx.save(); if (selected) { ctx.shadowColor = menu.multiplayerMode ? 'rgba(255,204,0,0.35)' : COL.glowStrong; ctx.shadowBlur = 10; }
        ctx.fillText(startLabel, cx, row.y + 7); ctx.restore();
      } else if (isCat) {
        const catId = item.slice(4);
        const cat = CHEAT_CATEGORIES.find(c => c.id === catId);
        const cc = getCatColor(catId);
        const expanded = menu.expanded[catId];
        const arrow = expanded ? '\u25BC' : '\u25B6';
        const onCount = cat.keys.filter(k => menu.cheats[k]).length;
        ctx.fillStyle = selected ? COL.bright : cc.pri;
        ctx.font = (rowW < 280 ? '11px ' : '13px ') + FONT_MONO; ctx.textAlign = 'left';
        ctx.fillText(arrow + ' ' + cat.label, labelX, row.y + 5);
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
        const nameX = labelX;
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
        ctx.fillText('NAME:', labelX, row.y + 6);
        const nameVal = menu.playerName || (menu.activeField === 'name' ? '' : 'ANONYMOUS');
        ctx.fillStyle = menu.playerName ? textColor : (selected ? COL.dim : COL.shadow);
        const cursorChar = menu.activeField === 'name' && frameTick % 50 < 25 ? '\u2588' : '';
        let base = menu.activeField === 'name' ? menu.playerName.toUpperCase() : nameVal;
        const nameStartX = labelX + ctx.measureText('NAME: ').width;
        const maxNm = colR - nameStartX;
        while (base.length > 0 && ctx.measureText(base + cursorChar).width > maxNm) base = base.slice(0, -1);
        ctx.fillText(base + cursorChar, nameStartX, row.y + 6);
      } else if (item === 'mp_room') {
        const roomLocked = multiplayer.active;
        ctx.fillStyle = roomLocked ? COL.amberDim : textColor;
        ctx.font = (rowW < 300 ? '12px ' : '14px ') + FONT_MONO; ctx.textAlign = 'left';
        ctx.fillText('ROOM:', labelX, row.y + 6);
        const roomVal = multiplayer.roomCode || (menu.activeField === 'mp_room' ? '' : 'AUTO');
        ctx.fillStyle = roomLocked ? COL.amberDim : (multiplayer.roomCode ? (selected ? COL.amber : COL.amberPri) : COL.amberDim);
        const cursorChar = menu.activeField === 'mp_room' && frameTick % 50 < 25 ? '\u2588' : '';
        let base = menu.activeField === 'mp_room' ? multiplayer.roomCode : roomVal;
        const startX = labelX + ctx.measureText('ROOM: ').width;
        const maxVal = colR - startX;
        while (base.length > 0 && ctx.measureText(base + cursorChar).width > maxVal) base = base.slice(0, -1);
        ctx.fillText(base + cursorChar, startX, row.y + 6);
      } else if (item === 'mp_host') {
        const hostLocked = multiplayer.active;
        ctx.fillStyle = hostLocked ? COL.amberDim : textColor;
        ctx.font = (rowW < 300 ? '12px ' : '14px ') + FONT_MONO; ctx.textAlign = 'left';
        ctx.fillText('HOST:', labelX, row.y + 6);
        const hostVal = multiplayer.host || (menu.activeField === 'mp_host' ? '' : location.host);
        ctx.fillStyle = hostLocked ? COL.amberDim : (selected ? COL.amber : COL.amberPri);
        const cursorChar = menu.activeField === 'mp_host' && frameTick % 50 < 25 ? '\u2588' : '';
        let base = menu.activeField === 'mp_host' ? (multiplayer.host || '') : hostVal;
        const startX = labelX + ctx.measureText('HOST: ').width;
        const maxVal = colR - startX;
        while (base.length > 0 && ctx.measureText(base + cursorChar).width > maxVal) base = base.slice(0, -1);
        ctx.fillText(base + cursorChar, startX, row.y + 6);
      } else if (item === 'mp_matchmode') {
        const modeLocked = isMatchModeLocked();
        const liveMode = modeLocked && multiplayer.snapshot && multiplayer.snapshot.mode
          ? multiplayer.snapshot.mode
          : multiplayer.mode;
        const modeLabel = liveMode === 'pvp' ? 'PVP' : 'CO-OP';
        ctx.fillStyle = modeLocked ? COL.amberDim : textColor;
        ctx.font = (rowW < 300 ? '12px ' : '14px ') + FONT_MONO; ctx.textAlign = 'left';
        ctx.fillText('MATCH TYPE', labelX, row.y + 6);
        if (modeLocked) {
          ctx.fillStyle = COL.amberDim;
        } else {
          ctx.fillStyle = liveMode === 'pvp' ? COL.red : COL.amber;
        }
        ctx.font = 'bold 11px ' + FONT_MONO; ctx.textAlign = 'right';
        ctx.fillText(modeLabel, colMidR, row.y + 4);
      } else if (item === 'mp_join') {
        const joinLocked = multiplayer.active;
        ctx.fillStyle = joinLocked ? COL.amberDim : textColor;
        ctx.font = (rowW < 300 ? '12px ' : '14px ') + FONT_MONO; ctx.textAlign = 'left';
        ctx.fillText('JOIN ROOM', labelX, row.y + 6);
        if (!joinLocked) {
          ctx.fillStyle = multiplayer.roomCode ? COL.amberPri : COL.amberDim;
          ctx.font = 'bold 10px ' + FONT_MONO; ctx.textAlign = 'right';
          ctx.fillText(multiplayer.roomCode ? 'READY' : 'NEEDS CODE', colMidR, row.y + 5);
        }
      } else if (item === 'mp_leave') {
        ctx.fillStyle = multiplayer.active ? textColor : COL.amberDim;
        ctx.font = (rowW < 300 ? '12px ' : '14px ') + FONT_MONO; ctx.textAlign = 'left';
        ctx.fillText('LEAVE LOBBY', labelX, row.y + 6);
        ctx.fillStyle = multiplayer.active ? COL.amberPri : COL.amberDim;
        ctx.font = 'bold 10px ' + FONT_MONO; ctx.textAlign = 'right';
        ctx.fillText(multiplayer.active ? 'ACTIVE' : 'IDLE', colMidR, row.y + 5);
      } else if (item === 'mp_status') {
        const lines = getMultiplayerStatusDisplayLines();
        ctx.strokeStyle = 'rgba(255, 204, 0, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rowX + 6, row.y - rowHalf + 2);
        ctx.lineTo(rowX + rowW - 6, row.y - rowHalf + 2);
        ctx.stroke();
        ctx.fillStyle = COL.amberDim;
        ctx.font = '10px ' + FONT_MONO;
        ctx.textAlign = 'left';
        for (let j = 0; j < lines.length; j++) {
          ctx.fillText(lines[j], colL, row.y - rowHalf + 16 + j * 12);
        }
      } else if (item === 'crt') {
        const status = menu.crtSupported ? (menu.crtEnabled ? 'ON' : 'OFF') : 'N/A';
        const statusCol = !menu.crtSupported ? COL.shadow : (menu.crtEnabled ? COL.bright : COL.dim);
        ctx.fillStyle = textColor; ctx.font = (rowW < 300 ? '12px ' : '14px ') + FONT_MONO; ctx.textAlign = 'left';
        ctx.fillText('CRT SHADER', labelX, row.y + 6);
        ctx.fillStyle = COL.shadow; ctx.font = '9px ' + FONT_MONO;
        ctx.fillText(menu.crtSupported ? 'WEBGL POST FX' : 'WEBGL NOT SUPPORTED', colMidL, row.y + 5);
        ctx.fillStyle = statusCol; ctx.font = 'bold 11px ' + FONT_MONO; ctx.textAlign = 'right';
        ctx.fillText(status, colMidR, row.y + 4);
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
    // Compact menu draws instruction lines at footBase-34 / footBase-20 (8px font) — reserve space so the panel
    // ends above that block (baselines minus ascent, plus a gap).
    const menuLbBottomReserve = compact ? padY + 34 + 12 + 10 : 50;

    if (leaderboardApi.enabled) {
      const menuRight = (W + rowW) / 2;
      const sideSpace = W - menuRight - padX - 50;
      const isSide = sideSpace >= 120;

      let lbX, lbY, lbW, lbH;
      if (isSide) {
        lbW = Math.min(216, sideSpace);
        const gap = W - padX - menuRight;
        lbX = menuRight + (gap - lbW) / 2;
        lbY = titleY - 10;
        lbH = Math.min(H - lbY - (compact ? menuLbBottomReserve : 60), 340);
      } else {
        lbW = Math.min(rowW, W - 2 * padX - 20);
        lbX = (W - lbW) / 2;
        const lastRow = layout.length > 0 ? layout[layout.length - 1] : null;
        const lastRowScreenY = lastRow ? lastRow.y - scrollY : titleY + 120;
        // Leave room below last row; if cheat warning is shown, start LB under both lines (they sit at +48 / +66).
        let menuBottom = lastRowScreenY + 44;
        if (hasCheatsEnabled()) {
          const warnBlockBottom = lastRowScreenY + 48 + 18 + 10;
          menuBottom = Math.max(menuBottom, warnBlockBottom);
        }
        lbY = menuBottom + 12;
        lbH = Math.min(H - lbY - menuLbBottomReserve, 180);
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
      ctx.fillText('\u2191\u2193 NAVIGATE    ENTER SELECT    A/D MOVE  2xA/D DASH    SPACE JUMP    SHIFT SPRINT    ESC PAUSE', cx, footBase - 36);
      ctx.fillText('1-9 TOOLS    SCROLL CYCLE    CLICK+DRAG PLATFORMS    HOLD JUMP TO GLIDE', cx, footBase - 22);
    }
    ctx.textAlign = 'left';
  }

  // main loop — simulation lives in the active Session (LocalSession or NetworkSession);
  // this thread just keeps repainting whatever snapshot the session last published.
  function loop() { render(); requestAnimationFrame(loop); }
  loadAssets(() => { loop(); });
})();
