'use strict';
/* ============================================================================
   LUDOW — offline Ludo
   Dice fairness (default "Fair Random"):
     crypto.getRandomValues() is used with REJECTION SAMPLING (no modulo bias):
     we draw a Uint32 and reject values >= floor(2^32 / 6) * 6, then take % 6.
     No outcome is favoured, no seed / history / player is consulted, and the
     result is never adjusted after it is drawn. Other modes in Settings are
     explicitly labelled (Classic / Lucky / Super Lucky / Unlucky / Custom)
     and only change the *weights* before the draw — the draw itself is still
     a single random pick from those weights.
   ========================================================================== */

// ---------- Board data (exact classic 15x15 track) ----------
const TRACK = [[6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0]];
const START = { red: 0, green: 13, yellow: 26, blue: 39 };
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]); // starts + stars
const STAR_IDX = new Set([8, 21, 34, 47]);
const HOME_COL = {
  red:    [[7,1],[7,2],[7,3],[7,4],[7,5]],
  green:  [[1,7],[2,7],[3,7],[4,7],[5,7]],
  yellow: [[7,13],[7,12],[7,11],[7,10],[7,9]],
  blue:   [[13,7],[12,7],[11,7],[10,7],[9,7]]
};
const COLORS = ['red', 'green', 'yellow', 'blue'];
const COLOR_HEX = { red: '#e63946', green: '#2a9d5c', yellow: '#e8b400', blue: '#1e6fd9' };
const COLOR_NAME = { red: 'Red', green: 'Green', yellow: 'Yellow', blue: 'Blue' };
const BASE_YARDS = {
  red:    [[1,1],[1,4],[4,1],[4,4]],
  green:  [[1,10],[1,13],[4,10],[4,13]],
  yellow: [[10,10],[10,13],[13,10],[13,13]],
  blue:   [[10,1],[10,4],[13,1],[13,4]]
};
const BASE_BOX = { red: [0,0], green: [0,9], yellow: [9,9], blue: [9,0] };

// ---------- Pure helpers (no DOM — unit-testable) ----------
function trackIndexFor(color, progress) {
  if (progress < 0 || progress > 50) return null;
  return (START[color] + progress) % 52;
}
function cellFor(color, progress) {
  if (progress === -1) return null;
  if (progress >= 0 && progress <= 50) return TRACK[trackIndexFor(color, progress)];
  if (progress >= 51 && progress <= 55) return HOME_COL[color][progress - 51];
  if (progress === 56) return [7, 7];
  return null;
}
function piecesOnTrack(players, trackIdx) {
  const out = [];
  players.forEach((pl, pi) => pl.pieces.forEach((p, idx) => {
    if (p >= 0 && p <= 50 && trackIndexFor(pl.color, p) === trackIdx) out.push({ player: pi, color: pl.color, piece: idx });
  }));
  return out;
}
function countOnTrack(players, color, trackIdx) {
  return piecesOnTrack(players, trackIdx).filter(o => o.color === color).length;
}
// Legal moves for one player given a dice value. Returns piece indices.
function legalMoves(players, playerIdx, dice, settings) {
  const pl = players[playerIdx];
  if (!pl || pl.type === 'off') return [];
  const out = [];
  for (let i = 0; i < 4; i++) {
    const p = pl.pieces[i];
    if (p === 56) continue;
    if (p === -1) {
      if (settings.need6 && dice !== 6) continue;
      // leaving base lands on the (safe) start cell — always allowed
      out.push(i); continue;
    }
    const np = p + dice;
    if (np > 56) continue; // exact finish required
    if (np <= 50) {
      const dest = trackIndexFor(pl.color, np);
      if (!SAFE.has(dest) && settings.block) {
        // cannot land on an opponent block (2+ same colour)
        const occ = piecesOnTrack(players, dest).filter(o => o.color !== pl.color);
        const byColor = {};
        occ.forEach(o => { byColor[o.color] = (byColor[o.color] || 0) + 1; });
        if (Object.values(byColor).some(n => n >= 2)) continue;
      }
    }
    out.push(i);
  }
  return out;
}
// Danger: is a main-track cell threatened by an opponent 1-6 steps behind?
function isInDanger(players, color, trackIdx) {
  if (trackIdx === null || SAFE.has(trackIdx)) return false;
  for (const pl of players) {
    if (pl.color === color || pl.type === 'off') continue;
    for (const p of pl.pieces) {
      if (p < 0 || p > 50) continue;
      const o = trackIndexFor(pl.color, p);
      const dist = (trackIdx - o + 52) % 52;
      if (dist >= 1 && dist <= 6) return true;
    }
  }
  return false;
}
// Score one candidate move for the CPU (higher = better). Pure-ish, works on a
// cloned players array so the real game is never mutated while evaluating.
function scoreMove(players, playerIdx, pieceIdx, dice, settings) {
  const pl = players[playerIdx];
  const p = pl.pieces[pieceIdx];
  const np = p === -1 ? 0 : p + dice;
  let s = 0;
  const oldTrack = p >= 0 && p <= 50 ? trackIndexFor(pl.color, p) : null;
  const wasInDanger = oldTrack !== null && isInDanger(players, pl.color, oldTrack);
  if (p === -1) s += 60;                                  // leave base
  if (np === 56) s += 90;                                 // finish a piece
  if (np >= 51 && np <= 55) s += 45;                      // enter home column
  if (np >= 0 && np <= 50) {
    const dest = trackIndexFor(pl.color, np);
    // Land safe — but NOT double-counted when leaving base: the +60 for
    // leaving base already covers landing on the (safe) start cell, so a
    // capture (+100) must always beat merely leaving base.
    if (SAFE.has(dest) && p !== -1) s += 55;              // land safe
    if (!SAFE.has(dest)) {
      const victims = piecesOnTrack(players, dest).filter(o => o.color !== pl.color);
      if (victims.length) s += 100 * victims.length;      // capture
      if (isInDanger(players, pl.color, dest)) s -= 70;   // landing in danger
    }
    // form a block with one of our own pieces already there
    const own = piecesOnTrack(players, dest).filter(o => o.color === pl.color && o.piece !== pieceIdx);
    if (own.length >= 1) s += 40;
    s += np * 1.2;                                        // progress toward home
  } else if (np >= 51) {
    s += np * 1.2;
  }
  if (wasInDanger) {
    const destSafe = (np >= 51) || (np <= 50 && SAFE.has(trackIndexFor(pl.color, np)));
    if (destSafe) s += 50;                                // escape danger
    else s -= 40;                                         // leave a piece exposed / stay exposed
  }
  // Prefer moving the piece furthest along when nothing else matters
  s += Math.max(0, p) * 0.15;
  return s;
}
function cpuChooseMove(players, playerIdx, dice, settings, difficulty) {
  const moves = legalMoves(players, playerIdx, dice, settings);
  if (!moves.length) return null;
  if (difficulty === 'easy') return moves[Math.floor(Math.random() * moves.length)];
  const scored = moves.map(m => ({ m, s: scoreMove(players, playerIdx, m, dice, settings) }));
  if (difficulty === 'medium') {
    // Medium: usually best, sometimes a random legal move (25%)
    if (Math.random() < 0.25) return moves[Math.floor(Math.random() * moves.length)];
  }
  scored.sort((a, b) => b.s - a.s);
  const best = scored[0].s;
  const tied = scored.filter(x => x.s === best).map(x => x.m);
  return tied[Math.floor(Math.random() * tied.length)];
}

// ---------- Dice RNG ----------
function fairRandomFace() {
  // Crypto RNG with rejection sampling — no modulo bias (see header comment).
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues)
    ? globalThis.crypto : null;
  if (c) {
    const limit = Math.floor(4294967296 / 6) * 6;
    const buf = new Uint32Array(1);
    let v;
    do { c.getRandomValues(buf); v = buf[0]; } while (v >= limit);
    return (v % 6) + 1;
  }
  return Math.floor(Math.random() * 6) + 1;
}
function weightedFace(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < 6; i++) { r -= weights[i]; if (r <= 0) return i + 1; }
  return 6;
}
function rollDiceValue(mode, luck) {
  switch (mode) {
    case 'classic': return Math.floor(Math.random() * 6) + 1;
    case 'lucky': return weightedFace([1, 1, 1, 2, 3, 4]);
    case 'superlucky': return weightedFace([1, 1, 1, 1, 2, 6]);
    case 'unlucky': return weightedFace([4, 3, 2, 1, 1, 1]);
    case 'custom': {
      const f = Math.max(-1, Math.min(1, (luck || 0) / 100));
      const w = [1, 2, 3, 4, 5, 6].map(face => Math.max(0.1, 1 + f * (face - 3.5) * 0.9));
      return weightedFace(w);
    }
    case 'fair':
    default: return fairRandomFace();
  }
}
const DICE_LABEL = { fair: 'Fair Random', classic: 'Classic Random', lucky: 'Lucky', superlucky: 'Super Lucky', unlucky: 'Unlucky', custom: 'Custom Luck' };

// ---------- Settings ----------
const DEFAULT_SETTINGS = {
  diceMode: 'fair', luck: 0, difficulty: 'hard', theme: 'classic', anim: 'normal',
  sound: true, need6: true, extra6: true, extraCap: true, three6: true, block: true, hints: true
};
function loadSettings() {
  try {
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('ludow-settings-v1') : null;
    if (raw) return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
  } catch (e) {}
  return Object.assign({}, DEFAULT_SETTINGS);
}
function saveSettings(s) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem('ludow-settings-v1', JSON.stringify(s)); } catch (e) {}
}

// Export pure logic for node self-tests (browser: window.LudowTest)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TRACK, START, SAFE, HOME_COL, COLORS, trackIndexFor, cellFor, legalMoves, scoreMove, cpuChooseMove, isInDanger, rollDiceValue, fairRandomFace, loadSettings, DEFAULT_SETTINGS };
}
if (typeof window !== 'undefined') {
  window.LudowTest = { TRACK, START, SAFE, HOME_COL, COLORS, trackIndexFor, cellFor, legalMoves, scoreMove, cpuChooseMove, isInDanger, rollDiceValue };
}

/* ================= Browser game (only runs when document exists) ================ */
if (typeof document === 'undefined') { /* node: pure logic only */ }
else (function () {
'use strict';
const $ = id => document.getElementById(id);
const settings = loadSettings();
let audioCtx = null;
let deferredPrompt = null;

// ---------- State ----------
let G = null; // game state
let setupConfig = [
  { color: 'red',    name: 'Player 1', type: 'human' },
  { color: 'green',  name: 'Player 2', type: 'off'   },
  { color: 'yellow', name: 'Player 3', type: 'human' },
  { color: 'blue',   name: 'Player 4', type: 'off'   }
];
let stats = { counts: [0, 0, 0, 0, 0, 0], total: 0 };
let cpuTimer = null, passTimer = null;

function newGame(playersCfg) {
  return {
    players: playersCfg.map(c => ({ color: c.color, name: c.name || COLOR_NAME[c.color], type: c.type, pieces: [-1, -1, -1, -1] })),
    turn: 0, // index into COLORS order (0=red..3=blue), skipping off
    dice: 6, hasRolled: false, sixStreak: 0, movable: [],
    paused: false, over: false, winner: null, log: []
  };
}
function activePlayers() { return G.players.filter(p => p.type !== 'off'); }
function currentPlayer() { return G.players[G.turn]; }
function nextTurnIndex(from) {
  let i = from;
  for (let k = 0; k < 4; k++) { i = (i + 1) % 4; if (G.players[i].type !== 'off') return i; }
  return from;
}

// ---------- Sound (WebAudio, no files) ----------
function tone(freq, dur, type, vol, when) {
  if (!settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime + (when || 0);
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t0); o.stop(t0 + dur);
  } catch (e) {}
}
const sfx = {
  dice: () => { tone(220, .07, 'square', .06); tone(330, .07, 'square', .05, .07); },
  move: () => tone(520, .09, 'sine', .1),
  capture: () => { tone(180, .16, 'sawtooth', .1); tone(120, .2, 'sawtooth', .1, .08); },
  six: () => { tone(660, .1, 'sine', .1); tone(880, .12, 'sine', .1, .09); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .22, 'triangle', .12, i * .14)),
  bad: () => tone(160, .18, 'sawtooth', .08)
};

// ---------- Toast / log ----------
let toastTimer = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function addLog(html) {
  if (!G) return;
  G.log.unshift(html);
  const el = $('move-log'); if (!el) return;
  el.innerHTML = G.log.slice(0, 60).map(x => '<li>' + x + '</li>').join('');
}

// ---------- Board rendering ----------
let boardBuilt = false, pieceEls = {};
function buildBoard() {
  const board = $('board'); board.innerHTML = ''; pieceEls = {};
  const trackSet = new Map(); TRACK.forEach((rc, i) => trackSet.set(rc[0] + ',' + rc[1], i));
  const homeSet = new Map();
  Object.keys(HOME_COL).forEach(c => HOME_COL[c].forEach((rc, i) => homeSet.set(rc[0] + ',' + rc[1], { color: c, idx: i })));
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    const d = document.createElement('div');
    d.className = 'cell'; d.dataset.r = r; d.dataset.c = c;
    const key = r + ',' + c;
    // home bases
    let baseColor = null;
    if (r < 6 && c < 6) baseColor = 'red'; else if (r < 6 && c > 8) baseColor = 'green';
    else if (r > 8 && c < 6) baseColor = 'blue'; else if (r > 8 && c > 8) baseColor = 'yellow';
    if (baseColor) {
      const inInner = r % 6 >= 1 && r % 6 <= 4 && (baseColor === 'red' || baseColor === 'blue' ? c >= 1 && c <= 4 : c % 6 >= 1 && c % 6 <= 4);
      // simpler: inner white square is rows/cols 1-4 inside each 6x6 base
      const rr = r < 6 ? r : r - 9, cc = c < 6 ? c : c - 9;
      const inner = rr >= 1 && rr <= 4 && cc >= 1 && cc <= 4;
      d.classList.add(inner ? 'base-inner' : 'base-' + baseColor);
    } else if (r >= 6 && r <= 8 && c >= 6 && c <= 8) {
      d.classList.add('centre-cell');
    } else if (homeSet.has(key)) {
      d.classList.add('home-' + homeSet.get(key).color);
    } else if (trackSet.has(key)) {
      const ti = trackSet.get(key);
      d.classList.add('track');
      if (SAFE.has(ti)) {
        d.classList.add('safe');
        const col = COLORS.find(col => START[col] === ti);
        if (col) { d.classList.add('start-' + col); d.textContent = '➤'; }
        else if (STAR_IDX.has(ti)) d.textContent = '★';
      }
    }
    board.appendChild(d);
  }
  // base overlays (white yard with 4 circles)
  COLORS.forEach(col => {
    const [br, bc] = BASE_BOX[col];
    const ov = document.createElement('div');
    ov.className = 'base-overlay';
    ov.style.cssText = 'left:' + (bc / 15 * 100) + '%;top:' + (br / 15 * 100) + '%;width:' + (6 / 15 * 100) + '%;height:' + (6 / 15 * 100) + '%;background:' + COLOR_HEX[col];
    ov.innerHTML = '<div class="yard"><i></i><i></i><i></i><i></i></div>';
    board.appendChild(ov);
  });
  // centre triangles (SVG)
  const cv = document.createElement('div');
  cv.className = 'centre-overlay';
  cv.style.cssText = 'left:40%;top:40%;width:20%;height:20%';
  cv.innerHTML = '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">'
    + '<polygon points="0,0 100,0 50,50" fill="' + COLOR_HEX.green + '"/>'
    + '<polygon points="100,0 100,100 50,50" fill="' + COLOR_HEX.yellow + '"/>'
    + '<polygon points="0,100 100,100 50,50" fill="' + COLOR_HEX.blue + '"/>'
    + '<polygon points="0,0 0,100 50,50" fill="' + COLOR_HEX.red + '"/>'
    + '<circle cx="50" cy="50" r="9" fill="#fff" stroke="#333" stroke-width="2"/></svg>';
  board.appendChild(cv);
  // piece elements
  COLORS.forEach(col => { for (let i = 0; i < 4; i++) {
    const el = document.createElement('div');
    el.className = 'piece ' + col; el.dataset.color = col; el.dataset.piece = i;
    el.innerHTML = '<div class="tok">' + (i + 1) + '</div>';
    el.addEventListener('click', () => onPieceTap(col, i));
    board.appendChild(el);
    pieceEls[col + i] = el;
  }});
  boardBuilt = true;
}
function pieceCell(color, progress, pieceIdx) {
  if (progress === -1) return BASE_YARDS[color][pieceIdx];
  return cellFor(color, progress);
}
function renderPieces() {
  if (!boardBuilt) return;
  // group by cell to offset stacks
  const groups = {};
  G.players.forEach(pl => pl.pieces.forEach((p, i) => {
    const cell = pieceCell(pl.color, p, i);
    if (!cell) return;
    const k = cell[0] + ',' + cell[1] + ':' + (p === -1 ? 'base' : p === 56 ? 'home' : 'track');
    (groups[k] = groups[k] || []).push({ pl, i, cell });
  }));
  Object.values(groups).forEach(list => list.forEach((item, n) => {
    const el = pieceEls[item.pl.color + item.i];
    const [r, c] = item.cell;
    const off = list.length > 1 ? (n - (list.length - 1) / 2) * 1.1 : 0;
    el.style.left = 'calc(' + (c * 100 / 15) + '% + ' + off.toFixed(2) + '%)';
    el.style.top = 'calc(' + (r * 100 / 15) + '% + ' + (-off * 0.6).toFixed(2) + '%)';
    el.style.display = 'flex';
    const movable = settings.hints && G.movable.includes(item.i) && currentPlayer().color === item.pl.color && G.hasRolled && !G.over;
    el.classList.toggle('movable', !!movable);
  }));
  // hide pieces of Off players
  G.players.forEach(pl => { if (pl.type === 'off') for (let i = 0; i < 4; i++) pieceEls[pl.color + i].style.display = 'none'; });
}
function renderScoreboard() {
  const sb = $('scoreboard'); if (!sb) return;
  sb.innerHTML = G.players.filter(p => p.type !== 'off').map(pl => {
    const home = pl.pieces.filter(p => p === 56).length;
    const base = pl.pieces.filter(p => p === -1).length;
    const play = 4 - home - base;
    return '<div class="score-row' + (currentPlayer() === pl ? ' active' : '') + '">'
      + '<span class="dot" style="background:' + COLOR_HEX[pl.color] + '"></span>'
      + '<span class="nm">' + escapeHtml(pl.name) + (pl.type === 'cpu' ? ' 🤖' : '') + '</span>'
      + '<span class="st">🏠 ' + home + ' · ▶ ' + play + ' · ⬤ ' + base + '</span></div>';
  }).join('');
}
function renderTurn() {
  const pl = currentPlayer();
  $('turn-dot').style.background = COLOR_HEX[pl.color];
  $('turn-text').textContent = pl.name + "'s turn" + (pl.type === 'cpu' ? ' (CPU)' : '');
  $('turn-sub').textContent = G.hasRolled ? 'Rolled ' + G.dice + ' — tap a glowing piece' : (pl.type === 'cpu' ? 'CPU is thinking…' : 'Roll the dice');
  $('dice-player').textContent = pl.name;
  $('dice-player').style.color = COLOR_HEX[pl.color];
  $('dice-mode-label').textContent = 'Dice: ' + DICE_LABEL[settings.diceMode] + (settings.diceMode === 'custom' ? ' (' + (settings.luck > 0 ? '+' : '') + settings.luck + ')' : '');
  const canRoll = !G.hasRolled && !G.over && !G.paused && pl.type === 'human';
  $('btn-roll').disabled = !canRoll;
  $('btn-roll').textContent = G.hasRolled ? '🎲 Rolled ' + G.dice : '🎲 Roll dice';
  renderScoreboard();
}
function renderStats() {
  $('stats-total').textContent = stats.total ? '· ' + stats.total + ' rolls' : '';
  $('dice-stats').innerHTML = [1, 2, 3, 4, 5, 6].map(f =>
    '<div><b>' + f + '</b>' + stats.counts[f - 1] + ' (' + (stats.total ? Math.round(stats.counts[f - 1] / stats.total * 100) : 0) + '%)</div>').join('');
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function setBoardMsg(msg) { $('board-msg').textContent = msg || ''; }

// ---------- Setup screen ----------
function renderSetup() {
  const wrap = $('player-setup'); wrap.innerHTML = '';
  setupConfig.forEach((cfg, idx) => {
    const row = document.createElement('div'); row.className = 'pset-row';
    row.innerHTML = '<span class="dot" style="background:' + COLOR_HEX[cfg.color] + '"></span>'
      + '<input type="text" maxlength="16" value="' + escapeHtml(cfg.name) + '" data-idx="' + idx + '" data-field="name" aria-label="' + COLOR_NAME[cfg.color] + ' player name">'
      + '<select data-idx="' + idx + '" data-field="type" aria-label="' + COLOR_NAME[cfg.color] + ' type">'
      + '<option value="human"' + (cfg.type === 'human' ? ' selected' : '') + '>Human</option>'
      + '<option value="cpu"' + (cfg.type === 'cpu' ? ' selected' : '') + '>CPU</option>'
      + '<option value="off"' + (cfg.type === 'off' ? ' selected' : '') + '>Off</option></select>';
    wrap.appendChild(row);
  });
  wrap.querySelectorAll('input,select').forEach(el => el.addEventListener('change', () => {
    const i = +el.dataset.idx;
    if (el.dataset.field === 'name') setupConfig[i].name = el.value.trim() || COLOR_NAME[setupConfig[i].color];
    else setupConfig[i].type = el.value;
  }));
}
function applyPreset(name) {
  const set = (r, g, y, b) => { setupConfig[0].type = r; setupConfig[1].type = g; setupConfig[2].type = y; setupConfig[3].type = b; };
  if (name === '2p') set('human', 'off', 'human', 'off');
  if (name === '3p') set('human', 'human', 'human', 'off');
  if (name === '4p') set('human', 'human', 'human', 'human');
  if (name === 'cpu1') set('human', 'off', 'cpu', 'off');
  if (name === 'cpu3') set('human', 'cpu', 'cpu', 'cpu');
  if (name === 'cpu2') set('human', 'cpu', 'off', 'cpu');
  document.querySelectorAll('.preset').forEach(b => b.classList.toggle('active', b.dataset.preset === name));
  renderSetup();
}

// ---------- Game flow ----------
function showScreen(which) {
  $('screen-menu').classList.toggle('active', which === 'menu');
  $('screen-game').classList.toggle('active', which === 'game');
}
function startGame() {
  const active = setupConfig.filter(c => c.type !== 'off');
  if (active.length < 2) { $('setup-error').textContent = 'Pick at least 2 players (Human or CPU).'; return; }
  settings.difficulty = $('setup-difficulty').value;
  settings.diceMode = $('setup-dice').value;
  saveSettings(settings); syncSettingsUI(); applyTheme();
  G = newGame(setupConfig);
  stats = { counts: [0, 0, 0, 0, 0, 0], total: 0 }; renderStats();
  if (!boardBuilt) buildBoard();
  clearTimeout(cpuTimer); clearTimeout(passTimer);
  $('btn-pass').hidden = true; setBoardMsg('');
  $('modal-winner').hidden = true;
  showScreen('game');
  renderPieces(); renderTurn(); renderStats();
  addLog('<b>' + escapeHtml(currentPlayer().name) + '</b> starts the game.');
  maybeCpuTurn();
  toast('Game started — ' + currentPlayer().name + ' to roll.');
}
function maybeCpuTurn() {
  if (!G || G.over || G.paused) return;
  const pl = currentPlayer();
  if (pl.type !== 'cpu') return;
  if (!G.hasRolled) {
    cpuTimer = setTimeout(() => { if (!G.paused && !G.over && currentPlayer().type === 'cpu' && !G.hasRolled) rollDice(); }, 700);
  } else if (G.movable.length) {
    cpuTimer = setTimeout(() => { if (G.paused || G.over) return maybeCpuTurn();
      const pick = cpuChooseMove(G.players, G.turn, G.dice, settings, settings.difficulty);
      if (pick !== null && pick !== undefined) movePiece(pick); }, 650 + Math.random() * 300);
  }
}
function rollDice() {
  if (!G || G.over || G.paused || G.hasRolled) return;
  const pl = currentPlayer();
  if (pl.type !== 'human' && !G._cpuRolling) { /* CPU rolls via its own timer */ }
  G._cpuRolling = false;
  const diceEl = $('dice');
  const dur = settings.anim === 'fast' ? 320 : 650;
  diceEl.classList.add('rolling'); sfx.dice();
  $('btn-roll').disabled = true;
  let ticks = 0;
  const iv = setInterval(() => { diceEl.dataset.v = 1 + Math.floor(Math.random() * 6); if (++ticks > 5) clearInterval(iv); }, 90);
  setTimeout(() => {
    diceEl.classList.remove('rolling');
    const v = rollDiceValue(settings.diceMode, settings.luck);
    G.dice = v; G.hasRolled = true;
    diceEl.dataset.v = v;
    stats.counts[v - 1]++; stats.total++; renderStats();
    if (v === 6) { G.sixStreak++; sfx.six(); } else G.sixStreak = 0;
    addLog('<b>' + escapeHtml(pl.name) + '</b> rolled <b>' + v + '</b>');
    // Three 6s forfeit
    if (v === 6 && G.sixStreak >= 3 && settings.three6) {
      setBoardMsg('Three 6s in a row — turn forfeited!');
      toast('Three 6s! Turn forfeited.'); sfx.bad();
      G.movable = []; renderTurn();
      setTimeout(() => { if (G && !G.over) endTurn(); }, 1100);
      return;
    }
    const moves = legalMoves(G.players, G.turn, v, settings);
    G.movable = moves;
    if (!moves.length) {
      setBoardMsg('No move possible — passing…');
      $('btn-pass').hidden = false;
      renderTurn(); renderPieces();
      passTimer = setTimeout(() => { if (G && !G.over && G.hasRolled && !G.movable.length) endTurn(); }, 1100);
      return;
    }
    $('btn-pass').hidden = true;
    setBoardMsg(moves.length === 1 ? 'Tap the glowing piece to move it.' : 'Tap a glowing piece to move it.');
    renderTurn(); renderPieces();
    if (pl.type === 'cpu') maybeCpuTurn();
  }, dur);
}
function onPieceTap(color, idx) {
  if (!G || G.over || G.paused || !G.hasRolled) return;
  if (color !== currentPlayer().color) return;
  if (!G.movable.includes(idx)) { toast('That piece cannot move with a ' + G.dice + '.'); return; }
  movePiece(idx);
}
function movePiece(idx) {
  const pl = currentPlayer();
  const old = pl.pieces[idx];
  const np = old === -1 ? 0 : old + G.dice;
  let captured = 0, capturedNames = [];
  if (np >= 0 && np <= 50) {
    const dest = trackIndexFor(pl.color, np);
    if (!SAFE.has(dest)) {
      G.players.forEach(other => {
        if (other.color === pl.color || other.type === 'off') return;
        other.pieces.forEach((p, pi) => {
          if (p >= 0 && p <= 50 && trackIndexFor(other.color, p) === dest) {
            other.pieces[pi] = -1; captured++; capturedNames.push(other.name);
          }
        });
      });
    }
  }
  pl.pieces[idx] = np;
  const finished = np === 56;
  sfx.move(); if (captured) sfx.capture();
  let msg = '<b>' + escapeHtml(pl.name) + '</b> moved piece ' + (idx + 1) + ' (' + (old === -1 ? 'base' : old) + ' → ' + np + ')';
  if (captured) msg += ' — captured <b>' + escapeHtml(capturedNames.join(', ')) + '</b>!';
  if (finished) msg += ' — piece home! 🏠';
  addLog(msg);
  G.movable = []; G.hasRolled = false;
  setBoardMsg(captured ? 'Captured! Extra turn.' : finished ? 'Piece finished! Extra turn.' : '');
  renderPieces(); renderTurn();
  // Win?
  if (pl.pieces.every(p => p === 56)) { endGame(pl); return; }
  const extra = (G.dice === 6 && settings.extra6) || (captured > 0 && settings.extraCap) || finished;
  // Note: extra-on-6 with the plain "finished" case is covered above; a 6 that
  // also finishes still counts once.
  if (extra) {
    setTimeout(() => { if (!G || G.over) return; setBoardMsg('Extra turn — roll again!'); renderTurn(); maybeCpuTurn(); }, settings.anim === 'fast' ? 250 : 450);
  } else {
    setTimeout(() => { if (!G || G.over) return; endTurn(); }, settings.anim === 'fast' ? 250 : 450);
  }
}
function endTurn() {
  if (!G || G.over) return;
  clearTimeout(passTimer);
  G.turn = nextTurnIndex(G.turn);
  G.hasRolled = false; G.sixStreak = 0; G.movable = [];
  $('btn-pass').hidden = true; setBoardMsg('');
  renderPieces(); renderTurn();
  maybeCpuTurn();
}
function endGame(pl) {
  G.over = true; G.winner = pl; G.movable = [];
  sfx.win();
  $('winner-text').textContent = pl.name + ' (' + COLOR_NAME[pl.color] + ') brought all 4 pieces home and wins the game!';
  $('modal-winner').hidden = false;
  renderTurn(); renderPieces();
  addLog('🏆 <b>' + escapeHtml(pl.name) + '</b> wins the game!');
}
function pauseGame(paused) {
  if (!G) return;
  G.paused = paused;
  $('btn-pause').textContent = paused ? '▶ Resume' : '⏸ Pause';
  toast(paused ? 'Paused — CPU timers stopped.' : 'Resumed.');
  if (!paused) maybeCpuTurn();
  renderTurn();
}

// ---------- Settings UI ----------
function syncSettingsUI() {
  $('set-dice-mode').value = settings.diceMode;
  $('set-luck').value = settings.luck; $('luck-val').textContent = settings.luck;
  $('set-difficulty').value = settings.difficulty;
  $('set-theme').value = settings.theme;
  $('set-anim').value = settings.anim;
  $('set-sound').checked = settings.sound;
  $('set-need6').checked = settings.need6;
  $('set-extra6').checked = settings.extra6;
  $('set-extracap').checked = settings.extraCap;
  $('set-three6').checked = settings.three6;
  $('set-block').checked = settings.block;
  $('set-hints').checked = settings.hints;
  $('setup-difficulty').value = settings.difficulty;
  $('setup-dice').value = settings.diceMode;
  const label = settings.sound ? '🔊 Sound' : '🔇 Muted';
  $('btn-sound').textContent = label; $('btn-sound2').textContent = label;
}
function applyTheme() {
  document.body.classList.remove('theme-dark', 'theme-neon');
  if (settings.theme === 'dark') document.body.classList.add('theme-dark');
  if (settings.theme === 'neon') document.body.classList.add('theme-neon');
}
function bindSettings() {
  const bind = (id, key, parse) => $(id).addEventListener('change', e => {
    settings[key] = parse ? parse(e.target.value) : e.target.value;
    saveSettings(settings); syncSettingsUI(); applyTheme(); if (G) renderTurn();
  });
  bind('set-dice-mode', 'diceMode'); bind('set-difficulty', 'difficulty'); bind('set-theme', 'theme'); bind('set-anim', 'anim');
  $('set-luck').addEventListener('input', e => { settings.luck = +e.target.value; $('luck-val').textContent = settings.luck; saveSettings(settings); if (G) renderTurn(); });
  [['set-sound', 'sound'], ['set-need6', 'need6'], ['set-extra6', 'extra6'], ['set-extracap', 'extraCap'], ['set-three6', 'three6'], ['set-block', 'block'], ['set-hints', 'hints']]
    .forEach(([id, key]) => $(id).addEventListener('change', e => { settings[key] = e.target.checked; saveSettings(settings); syncSettingsUI(); if (G) { renderPieces(); renderTurn(); } }));
}

// ---------- Install (PWA) ----------
function bindInstall() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('btn-install').classList.remove('hidden'); });
  $('btn-install').addEventListener('click', async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); const r = await deferredPrompt.userChoice; deferredPrompt = null; if (r && r.outcome === 'accepted') toast('Ludow installed — enjoy!'); }
    else $('modal-install').hidden = false;
  });
  $('btn-install-close').addEventListener('click', () => { $('modal-install').hidden = true; });
  window.addEventListener('appinstalled', () => toast('Ludow installed!'));
}

// ---------- Wire up ----------
function init() {
  renderSetup(); syncSettingsUI(); applyTheme(); bindSettings(); bindInstall(); renderStats();
  $('dice').dataset.v = 6;
  document.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
  $('btn-start').addEventListener('click', startGame);
  $('setup-difficulty').addEventListener('change', e => { settings.difficulty = e.target.value; saveSettings(settings); });
  $('setup-dice').addEventListener('change', e => { settings.diceMode = e.target.value; saveSettings(settings); syncSettingsUI(); });
  $('btn-roll').addEventListener('click', () => { if (G && currentPlayer().type === 'human') rollDice(); });
  $('dice').addEventListener('click', () => { if (G && currentPlayer().type === 'human') rollDice(); });
  $('btn-pass').addEventListener('click', () => endTurn());
  $('btn-restart').addEventListener('click', () => { if (G) { toast('Restarting…'); startGame(); } });
  $('btn-quit').addEventListener('click', () => { clearTimeout(cpuTimer); clearTimeout(passTimer); G = null; showScreen('menu'); });
  $('btn-new').addEventListener('click', () => { if (G) startGame(); else showScreen('menu'); });
  $('btn-menu').addEventListener('click', () => { clearTimeout(cpuTimer); clearTimeout(passTimer); G = null; showScreen('menu'); });
  $('btn-pause').addEventListener('click', () => { if (G) pauseGame(!G.paused); });
  const toggleSound = () => { settings.sound = !settings.sound; saveSettings(settings); syncSettingsUI(); toast(settings.sound ? 'Sound on.' : 'Sound off.'); };
  $('btn-sound').addEventListener('click', toggleSound);
  $('btn-sound2').addEventListener('click', toggleSound);
  const openSettings = () => { syncSettingsUI(); $('modal-settings').hidden = false; };
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-settings2').addEventListener('click', openSettings);
  $('btn-settings-close').addEventListener('click', () => { $('modal-settings').hidden = true; if (G) { renderPieces(); renderTurn(); } });
  const openRules = () => { $('modal-rules').hidden = false; };
  $('btn-rules').addEventListener('click', openRules);
  $('btn-rules2').addEventListener('click', openRules);
  $('btn-rules-close').addEventListener('click', () => { $('modal-rules').hidden = true; });
  $('btn-reset-stats').addEventListener('click', () => { stats = { counts: [0, 0, 0, 0, 0, 0], total: 0 }; renderStats(); });
  $('btn-again').addEventListener('click', () => { $('modal-winner').hidden = true; startGame(); });
  $('btn-winner-menu').addEventListener('click', () => { $('modal-winner').hidden = true; G = null; showScreen('menu'); });
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m && m.id !== 'modal-winner') m.hidden = true; }));
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && $('screen-game').classList.contains('active') && G && !G.over && !G.paused && currentPlayer().type === 'human' && !G.hasRolled) { e.preventDefault(); rollDice(); }
    if (e.key === 'Escape') document.querySelectorAll('.modal').forEach(m => { if (m.id !== 'modal-winner') m.hidden = true; });
  });
  // Service worker (http(s) only — file:// skips silently)
  if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
