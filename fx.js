/**
 * Word Rush — 音效、背景音樂、背景與粒子特效
 * 全部用 Web Audio 與 Canvas 即時產生，沒有任何外部音檔或圖片。
 * 瀏覽器規定要使用者操作過頁面才能發聲，所以第一次點擊時由 index.html 呼叫 unlock()。
 */

const REDUCE = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ═══════════════════════════ 音訊 ═══════════════════════════

let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
const prefs = { sfx: true, music: true };

export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.gain.value = 0.9;
      sfxBus = ctx.createGain();
      musicBus = ctx.createGain();
      sfxBus.connect(master);
      musicBus.connect(master);
      master.connect(comp);
      comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      applyPrefs();
    }
    if (ctx.state === 'suspended') ctx.resume();
    startMusic();
  } catch (e) { /* 沒有音訊也要能玩 */ }
}

function applyPrefs() {
  if (!ctx) return;
  const t = ctx.currentTime;
  sfxBus.gain.setTargetAtTime(prefs.sfx ? 0.6 : 0, t, 0.03);
  musicBus.gain.setTargetAtTime(prefs.music ? 0.3 : 0, t, 0.2);
}

export function setPrefs(p) {
  Object.assign(prefs, p);
  applyPrefs();
  if (prefs.music) startMusic(); else stopTimer();
}

document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  try { if (document.hidden) ctx.suspend(); else ctx.resume(); } catch (e) { /* ignore */ }
});

/** 單音：可滑音（to）、可指定絕對時間（at，給音樂排程用） */
function tone({ f, to, type = 'sine', t = 0, at, dur = 0.15, vol = 0.3, bus, a = 0.005 }) {
  if (!ctx) return;
  const t0 = at !== undefined ? at : ctx.currentTime + t;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(bus || sfxBus);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

/** 噪音：可掃頻濾波，做爆破、嘶聲、鼓組 */
function noise({ t = 0, at, dur = 0.1, vol = 0.2, type = 'highpass', f = 6000, to, q = 1, bus }) {
  if (!ctx) return;
  const t0 = at !== undefined ? at : ctx.currentTime + t;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f, t0);
  if (to) flt.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(bus || sfxBus);
  src.start(t0);
  src.stop(t0 + dur + 0.03);
}

// 五聲音階：連擊越高音越高
const PENT = [0, 2, 4, 7, 9];
const pentNote = (i) => 72 + PENT[i % 5] + 12 * Math.floor(i / 5);   // 從 C5 起

const on = (fn) => (...args) => { if (prefs.sfx && ctx) fn(...args); };

export const sfx = {
  click: on(() => tone({ f: 520, to: 780, type: 'triangle', dur: 0.06, vol: 0.18 })),
  tap: on(() => tone({ f: 660, type: 'square', dur: 0.05, vol: 0.12 })),
  match: on((combo = 1) => {
    const m = pentNote(Math.min(Math.max(combo - 1, 0), 12));
    tone({ f: mtof(m), type: 'triangle', dur: 0.22, vol: 0.34 });
    tone({ f: mtof(m + 12), type: 'sine', dur: 0.3, vol: 0.14, t: 0.04 });
    noise({ dur: 0.08, vol: 0.05, f: 7000 });
  }),
  milestone: on((combo = 5) => {
    const base = 67 + Math.min(12, Math.floor(combo / 5) * 2);
    [0, 4, 7, 12, 16].forEach((s, i) => tone({ f: mtof(base + s), type: 'square', dur: 0.14, vol: 0.16, t: i * 0.055 }));
    tone({ f: mtof(base + 24), type: 'sine', dur: 0.5, vol: 0.14, t: 0.28 });
  }),
  miss: on(() => {
    tone({ f: 190, to: 70, type: 'sawtooth', dur: 0.28, vol: 0.3 });
    noise({ dur: 0.18, vol: 0.18, type: 'lowpass', f: 1400, to: 200 });
  }),
  wave: on(() => {
    [0, 7, 12].forEach((s, i) => tone({ f: mtof(76 + s), type: 'triangle', dur: 0.18, vol: 0.22, t: i * 0.07 }));
  }),
  shuffle: on(() => {
    noise({ dur: 0.45, vol: 0.2, type: 'bandpass', f: 300, to: 3200, q: 2 });
  }),
  go: on(() => {
    tone({ f: 330, to: 990, type: 'sawtooth', dur: 0.25, vol: 0.16 });
    tone({ f: 880, type: 'square', dur: 0.18, vol: 0.14, t: 0.22 });
  }),
  warn: on(() => tone({ f: 980, type: 'square', dur: 0.07, vol: 0.13 })),
  coin: on(() => {
    tone({ f: 1318, type: 'square', dur: 0.07, vol: 0.12 });
    tone({ f: 1760, type: 'square', dur: 0.25, vol: 0.12, t: 0.07 });
  }),
  win: on(() => {
    [0, 4, 7, 12, 7, 12, 16, 19].forEach((s, i) => tone({ f: mtof(72 + s), type: 'square', dur: i === 7 ? 0.9 : 0.16, vol: 0.2, t: i * 0.1 }));
    [0, 7, 12].forEach((s) => tone({ f: mtof(48 + s), type: 'triangle', dur: 1.1, vol: 0.2, t: 0.7 }));
    noise({ t: 0.7, dur: 0.5, vol: 0.12, f: 5000 });
  }),
  lose: on(() => {
    [0, -2, -5, -9].forEach((s, i) => tone({ f: mtof(69 + s), to: mtof(69 + s) * 0.94, type: 'triangle', dur: 0.32, vol: 0.26, t: i * 0.22 }));
  }),
};

// ═══════════════════════════ 背景音樂（程式生成的 chiptune 循環） ═══════════════════════════

// Am – F – C – G，每個和弦一小節（16 個十六分音符）
const CHORDS = [
  { root: 45, notes: [57, 60, 64] },
  { root: 41, notes: [57, 60, 65] },
  { root: 48, notes: [55, 60, 64] },
  { root: 43, notes: [55, 59, 62] },
];
const BASS_GROOVE = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
const LEAD_SCALE = [69, 72, 74, 76, 79, 81, 84];

let wantedMode = null, mode = null, timer = 0, nextT = 0, step = 0, intensity = 0;

function playStep(s, at) {
  const i = s % 16;
  const ch = CHORDS[Math.floor(s / 16) % 4];
  const game = mode === 'game';

  if (game) {
    if (BASS_GROOVE[i]) tone({ f: mtof(ch.root), type: 'triangle', at, dur: 0.2, vol: 0.5, bus: musicBus });
    if (i % 4 === 0) tone({ f: 150, to: 42, type: 'sine', at, dur: 0.16, vol: 0.7, bus: musicBus });
    if (i === 4 || i === 12) noise({ at, dur: 0.12, vol: 0.28, type: 'bandpass', f: 1900, q: 0.8, bus: musicBus });
    if (i % 2 === 0 || (intensity > 0.6 && i % 2 === 1)) noise({ at, dur: 0.035, vol: i % 4 === 2 ? 0.14 : 0.08, f: 8000, bus: musicBus });
    const idx = [0, 1, 2, 1][i % 4];
    tone({ f: mtof(ch.notes[idx] + (i % 8 >= 4 ? 12 : 0)), type: 'square', at, dur: 0.1, vol: 0.09, bus: musicBus });
    if (intensity > 0.35 && i % 2 === 0 && Math.random() < 0.55) {
      const n = LEAD_SCALE[Math.floor(Math.random() * LEAD_SCALE.length)];
      tone({ f: mtof(n), type: 'square', at, dur: 0.16, vol: 0.07, bus: musicBus });
    }
  } else {
    if (i === 0) {
      ch.notes.forEach((n) => tone({ f: mtof(n - 12), type: 'triangle', at, dur: 1.9, vol: 0.14, a: 0.25, bus: musicBus }));
      tone({ f: mtof(ch.root), type: 'sine', at, dur: 1.9, vol: 0.4, a: 0.1, bus: musicBus });
    }
    if (i % 2 === 0) {
      const idx = [0, 1, 2, 1, 2, 1, 0, 1][(i / 2) % 8];
      tone({ f: mtof(ch.notes[idx] + 12), type: 'sine', at, dur: 0.32, vol: 0.12, bus: musicBus });
    }
  }
}

function schedule() {
  if (!ctx || ctx.state !== 'running') { nextT = ctx ? ctx.currentTime + 0.05 : 0; return; }
  while (nextT < ctx.currentTime + 0.15) {
    playStep(step, nextT);
    const bpm = mode === 'game' ? 124 + intensity * 28 : 84;
    nextT += 60 / bpm / 4;
    step++;
  }
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = 0; }
  mode = null;
}

function startMusic() {
  if (!ctx || !prefs.music || !wantedMode) return;
  if (timer && mode === wantedMode) return;
  stopTimer();
  mode = wantedMode;
  step = 0;
  nextT = ctx.currentTime + 0.08;
  timer = setInterval(schedule, 40);
}

export const music = {
  play(m) { wantedMode = m; startMusic(); },
  stop() { wantedMode = null; stopTimer(); },
  setIntensity(x) { intensity = Math.max(0, Math.min(1, x)); },
};

// ═══════════════════════════ 背景與粒子 ═══════════════════════════

let bgEl, bgx, fxEl, fxx, W = 0, H = 0, DPR = 1;
const orbs = [], glyphs = [], parts = [], rings = [];
let glyphWords = ['word', 'rush', 'learn', 'quiz', '詞彙', '衝刺', 'ABC', 'vocab'];
let flashA = 0, flashC = '#ff3b3b', fxDirty = false, lastBg = 0;
const ORB_COLORS = ['#7c3aed', '#06b6d4', '#ec4899', '#3b82f6', '#f59e0b'];

export function initFx(bg, fx) {
  bgEl = bg; fxEl = fx;
  bgx = bg.getContext('2d');
  fxx = fx.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  for (let i = 0; i < 5; i++) {
    orbs.push({ x: Math.random(), y: Math.random(), vx: rand(-0.012, 0.012), vy: rand(-0.01, 0.01), r: rand(0.35, 0.6), c: ORB_COLORS[i % ORB_COLORS.length] });
  }
  for (let i = 0; i < 26; i++) glyphs.push(newGlyph(true));
  requestAnimationFrame(loop);
}

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  DPR = Math.min(2, window.devicePixelRatio || 1);
  fxEl.width = Math.round(W * DPR);
  fxEl.height = Math.round(H * DPR);
  bgEl.width = Math.round(W / 2);     // 背景低解析度即可，節省效能
  bgEl.height = Math.round(H / 2);
}

function newGlyph(anywhere) {
  return {
    t: glyphWords[Math.floor(Math.random() * glyphWords.length)],
    x: Math.random(), y: anywhere ? Math.random() : 1.05,
    v: rand(0.006, 0.02), s: rand(12, 26), a: rand(0.04, 0.11), rot: rand(-0.3, 0.3),
  };
}

export function setGlyphs(list) {
  if (list && list.length) glyphWords = list.slice(0, 80);
}

function drawBg(dt) {
  const w = bgEl.width, h = bgEl.height;
  const g = bgx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#070b1f');
  g.addColorStop(1, '#150f36');
  bgx.globalCompositeOperation = 'source-over';
  bgx.fillStyle = g;
  bgx.fillRect(0, 0, w, h);

  bgx.globalCompositeOperation = 'lighter';
  for (const o of orbs) {
    o.x += o.vx * dt; o.y += o.vy * dt;
    if (o.x < -0.1 || o.x > 1.1) o.vx *= -1;
    if (o.y < -0.1 || o.y > 1.1) o.vy *= -1;
    const r = o.r * Math.max(w, h);
    const rg = bgx.createRadialGradient(o.x * w, o.y * h, 0, o.x * w, o.y * h, r);
    rg.addColorStop(0, o.c + '40');
    rg.addColorStop(1, o.c + '00');
    bgx.fillStyle = rg;
    bgx.fillRect(0, 0, w, h);
  }

  bgx.globalCompositeOperation = 'source-over';
  bgx.textAlign = 'center';
  for (let i = 0; i < glyphs.length; i++) {
    const gl = glyphs[i];
    gl.y -= gl.v * dt;
    if (gl.y < -0.08) glyphs[i] = newGlyph(false);
    bgx.save();
    bgx.translate(gl.x * w, gl.y * h);
    bgx.rotate(gl.rot);
    bgx.globalAlpha = gl.a;
    bgx.fillStyle = '#9fb4ff';
    bgx.font = `700 ${gl.s / 2}px system-ui, sans-serif`;
    bgx.fillText(gl.t, 0, 0);
    bgx.restore();
  }
  bgx.globalAlpha = 1;
}

// ── 粒子 ──
function addPart(p) { if (parts.length < 450) parts.push(p); }

export function burst(x, y, color = '#ffd166', n = 16) {
  if (!fxx) return;
  if (REDUCE) n = Math.min(n, 5);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = rand(80, 320);
    addPart({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0, max: rand(0.45, 0.9), size: rand(2, 5), color, g: 520, conf: false });
  }
  fxDirty = true;
}

export function burstAtEl(el, color, n) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, color, n);
}

export function ring(x, y, color = '#38e8ff') {
  if (!fxx || REDUCE) return;
  rings.push({ x, y, r: 10, max: Math.max(120, Math.min(W, H) * 0.32), color, life: 0 });
  fxDirty = true;
}

export function ringAtEl(el, color) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  ring(r.left + r.width / 2, r.top + r.height / 2, color);
}

export function confetti(n = 120) {
  if (!fxx || REDUCE) return;
  const cols = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#c77dff', '#ff9f1c', '#38e8ff'];
  for (let i = 0; i < n; i++) {
    addPart({
      x: rand(0, W), y: rand(-H * 0.2, -10), vx: rand(-60, 60), vy: rand(80, 260), life: 0, max: rand(2.2, 3.6),
      size: rand(5, 10), color: cols[i % cols.length], g: 140, conf: true, rot: rand(0, 6.28), vr: rand(-8, 8),
    });
  }
  fxDirty = true;
}

export function flash(color = '#ff3b3b', alpha = 0.25) {
  if (REDUCE) return;
  flashC = color; flashA = Math.max(flashA, alpha); fxDirty = true;
}

function drawFx(dt) {
  fxx.setTransform(DPR, 0, 0, DPR, 0, 0);
  fxx.clearRect(0, 0, W, H);

  if (flashA > 0.005) {
    fxx.globalAlpha = flashA;
    fxx.fillStyle = flashC;
    fxx.fillRect(0, 0, W, H);
    fxx.globalAlpha = 1;
    flashA *= Math.pow(0.001, dt);   // 約 0.3 秒淡出
  } else flashA = 0;

  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.life += dt;
    const k = r.life / 0.55;
    if (k >= 1) { rings.splice(i, 1); continue; }
    fxx.globalAlpha = (1 - k) * 0.8;
    fxx.strokeStyle = r.color;
    fxx.lineWidth = 4 * (1 - k) + 1;
    fxx.beginPath();
    fxx.arc(r.x, r.y, r.r + (r.max - r.r) * (1 - Math.pow(1 - k, 3)), 0, Math.PI * 2);
    fxx.stroke();
  }

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life += dt;
    if (p.life >= p.max || p.y > H + 40) { parts.splice(i, 1); continue; }
    p.vy += p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    const k = 1 - p.life / p.max;
    fxx.globalAlpha = Math.min(1, k * 1.6);
    fxx.fillStyle = p.color;
    if (p.conf) {
      p.rot += p.vr * dt;
      fxx.save();
      fxx.translate(p.x, p.y);
      fxx.rotate(p.rot);
      fxx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      fxx.restore();
    } else {
      fxx.beginPath();
      fxx.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, Math.PI * 2);
      fxx.fill();
    }
  }
  fxx.globalAlpha = 1;
  fxDirty = parts.length > 0 || rings.length > 0 || flashA > 0;
}

let last = 0;
function loop(ts) {
  const dt = Math.min(0.1, (ts - last) / 1000 || 0.016);
  last = ts;
  if (!document.hidden) {
    if (!REDUCE) {
      if (ts - lastBg > 33) { drawBg((ts - lastBg) / 1000 > 0.2 ? 0.033 : (ts - lastBg) / 1000); lastBg = ts; }
    } else if (!lastBg) { drawBg(0); lastBg = ts; }
    if (fxDirty) drawFx(dt);
  }
  requestAnimationFrame(loop);
}
