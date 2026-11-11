/**
 * Word Rush — 前端 API 層
 * 遊戲邏輯只呼叫這裡的函式，不直接碰 fetch。
 * 日後換 Supabase 時，只需重寫本檔，介面保持不變。
 *
 * 需在 HTML 先載入 Google Identity Services：
 *   <script src="https://accounts.google.com/gsi/client" async></script>
 */

const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxL_E02bnKmBZ_07wNKRmRTor-adfaRX2y85zYL0RBN8kaqahxHgS8fco5hw6Ijkbbl/exec',
  CLIENT_ID: '235061104042-lbstnl5ic591aqrtuo28r285div3g9dn.apps.googleusercontent.com',
  VOCAB_BASE: './vocab/',        // exportVocabJson() 匯出的檔案放這裡
  CLIENT_VERSION: '0.1.0',
};

const PENDING_KEY = 'wr_pending_runs';

// ───────────────────────── 天賦效果（價格由伺服器決定） ─────────────────────────

export const TALENT_EFFECTS = {
  breath: { name: '深呼吸',   desc: '初始時間增加',       levels: [3, 5, 10] },    // 秒
  calm:   { name: '冷靜',     desc: '答錯扣時減少',       levels: [2.5, 2] },      // 扣除秒數（基準 3）
  combo:  { name: '熱力連擊', desc: 'Combo 倍率提升',     levels: [1.2, 1.4, 1.6] },
  slowmo: { name: '慢動作',   desc: '曝光預覽時間增加',   levels: [0.5] },         // 秒
};

/** 依玩家天賦等級，換算本局實際參數 */
export function getRunModifiers(talents = {}) {
  const pick = (key, base) => {
    const lv = talents[key] || 0;
    return lv > 0 ? TALENT_EFFECTS[key].levels[lv - 1] : base;
  };
  return {
    startTimeBonus: pick('breath', 0),
    wrongPenalty: pick('calm', 3),
    comboMultiplier: pick('combo', 1),
    previewBonus: pick('slowmo', 0),
  };
}

// ───────────────────────── 錯誤型別 ─────────────────────────

export class ApiError extends Error {
  constructor(code, msg) {
    super(msg || code);
    this.code = code;   // 'auth' | 'busy' | 'rejected' | 'locked' | 'network' | ...
  }
}

// ───────────────────────── 登入 ─────────────────────────

let idToken = null;

/**
 * 顯示 Google 登入按鈕，登入成功後回傳 { profile, levels, progress }。
 * id token 約 1 小時過期；過期時 API 會丟 ApiError('auth')，再呼叫一次 login() 即可。
 */
export function login(buttonEl) {
  return new Promise((resolve, reject) => {
    google.accounts.id.initialize({
      client_id: CONFIG.CLIENT_ID,
      auto_select: true,
      callback: async (resp) => {
        idToken = resp.credential;
        try {
          const data = await call('login');
          await flushPending();
          resolve(data);
        } catch (e) {
          reject(e);
        }
      },
    });
    if (buttonEl) google.accounts.id.renderButton(buttonEl, { theme: 'outline', size: 'large' });
    google.accounts.id.prompt();
  });
}

export function isLoggedIn() {
  return !!idToken;
}

// ───────────────────────── 題庫（靜態 JSON，不經 Apps Script） ─────────────────────────

const vocabCache = new Map();

/** 回傳 [{ id, en, zh, pos, syn, audio }] */
export async function loadVocab(levelId) {
  if (vocabCache.has(levelId)) return vocabCache.get(levelId);
  const res = await fetch(`${CONFIG.VOCAB_BASE}level_${levelId}.json`);
  if (!res.ok) throw new ApiError('vocab', `找不到關卡 ${levelId} 的題庫`);
  const words = await res.json();
  vocabCache.set(levelId, words);
  return words;
}

// ───────────────────────── 局內紀錄 ─────────────────────────

/**
 * 每局建立一個 tracker，結束時 finish() 產生要送出的 payload。
 *
 *   const run = createRunTracker('L01');
 *   run.match(wordId, points, { credited: !isLastPairInWave });
 *   run.miss(firstSelectedWordId);
 *   await submitRun(run.finish());
 *
 * credited=false：每波最後一對靠排除法即可配對，照常得分但不計入熟練度。
 * miss() 的錯誤歸給「先點的那張卡」所屬的單字。
 */
export function createRunTracker(levelId) {
  const t0 = performance.now();
  const words = {};
  let score = 0, correct = 0, wrong = 0, combo = 0, maxCombo = 0;
  const w = (id) => (words[id] = words[id] || { c: 0, w: 0 });

  return {
    match(wordId, points, { credited = true } = {}) {
      correct++;
      combo++;
      maxCombo = Math.max(maxCombo, combo);
      score += points;
      if (credited) w(wordId).c++;
    },
    miss(wordId) {
      wrong++;
      combo = 0;
      w(wordId).w++;
    },
    get combo() { return combo; },
    get score() { return score; },
    finish() {
      return {
        runId: crypto.randomUUID(),
        levelId,
        score: Math.round(score),
        correct,
        wrong,
        maxCombo,
        durationSec: Math.round((performance.now() - t0) / 1000),
        words,
        clientVersion: CONFIG.CLIENT_VERSION,
      };
    },
  };
}

// ───────────────────────── 結算 / 天賦 ─────────────────────────

/**
 * 送出結算。網路失敗或登入過期時，結果會先存在本機，
 * 下次 login() 成功後自動補送（伺服器以 runId 去重，不會重複發金幣）。
 * 回傳 { passed, coinsEarned, newlyUnlocked, level, profile }，或 { queued: true }。
 */
export async function submitRun(run) {
  try {
    return await call('submitRun', { run });
  } catch (e) {
    if (e.code === 'network' || e.code === 'auth' || e.code === 'busy') {
      queuePending(run);
      return { queued: true, reason: e.code };
    }
    throw e;   // rejected / locked 等：不重送
  }
}

/** 回傳 { profile } */
export function upgradeTalent(key) {
  return call('upgradeTalent', { talent: key });
}

// ───────────────────────── 內部 ─────────────────────────

async function call(action, body = {}) {
  if (!idToken) throw new ApiError('auth', '尚未登入');
  let res;
  try {
    res = await fetch(CONFIG.GAS_URL, {
      method: 'POST',
      // text/plain 不會觸發 CORS preflight（Apps Script 不處理 OPTIONS）
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, idToken, ...body }),
    });
  } catch {
    throw new ApiError('network', '無法連線');
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError('network', '伺服器回應格式錯誤');
  }
  if (!data.ok) {
    if (data.err === 'auth') idToken = null;
    throw new ApiError(data.err, data.msg);
  }
  return data;
}

function readPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; } catch { return []; }
}

function writePending(list) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch { /* 無痕模式等 */ }
}

function queuePending(run) {
  const list = readPending();
  if (!list.some((r) => r.runId === run.runId)) list.push(run);
  writePending(list.slice(-20));
}

async function flushPending() {
  const list = readPending();
  const remain = [];
  for (const run of list) {
    try {
      await call('submitRun', { run });
    } catch (e) {
      if (e.code === 'network' || e.code === 'auth' || e.code === 'busy') remain.push(run);
      // 其他錯誤（被拒、資料過舊）直接丟棄
    }
  }
  writePending(remain);
}
