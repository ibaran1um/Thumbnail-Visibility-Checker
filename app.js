/*
 * サムネ視認性チェッカー
 * MIT License
 * すべての処理はブラウザ内で完結し、画像を外部へ送信しません。
 */
(() => {
  'use strict';

  // ---------- 色の計算 ----------

  // sRGB(0-255) → 線形RGB(0-1)
  const SRGB_TO_LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  // 線形RGB(0-1) → sRGB(0-255)（4096段階のテーブル）
  const LIN_STEPS = 4096;
  const LIN_TO_SRGB = new Uint8ClampedArray(LIN_STEPS + 1);
  for (let i = 0; i <= LIN_STEPS; i++) {
    const c = i / LIN_STEPS;
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    LIN_TO_SRGB[i] = Math.round(s * 255);
  }
  const linToSrgb = (v) => LIN_TO_SRGB[v <= 0 ? 0 : v >= 1 ? LIN_STEPS : Math.round(v * LIN_STEPS)];

  // WCAG 2.x の相対輝度
  function relativeLuminance(r, g, b) {
    return 0.2126 * SRGB_TO_LIN[r] + 0.7152 * SRGB_TO_LIN[g] + 0.0722 * SRGB_TO_LIN[b];
  }
  function contrastRatio(a, b) {
    const la = relativeLuminance(a[0], a[1], a[2]);
    const lb = relativeLuminance(b[0], b[1], b[2]);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  // 1型・2型：Machado, Oliveira & Fernandes (2009) 強度1.0 の変換行列（線形RGBに適用）
  // 原著者ページ Table 1 および DaltonLens (MIT) の値と一致を確認済み
  const CVD = {
    protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
  };

  // 3型：Brettel, Viénot & Mollon (1997)。Machado (2009) は3型の再現性が低いとされるため、こちらを使う。
  // 定数は DaltonLens-Python (MIT License, Copyright (c) 2021 DaltonLens) の
  // Simulator_Brettel1997（sRGB / Smith & Pokorny 1975 の LMS モデル、白を中立点とする設定）から算出
  const BRETTEL_TRITAN = {
    lmsFromRgb: [0.1788595581, 0.439971169898, 0.035965767024, 0.03380393502, 0.275152424014, 0.036206345976, 0.00031087464, 0.00191660736, 0.015280889928],
    rgbFromLms: [8.005328596048955, -12.881954499175828, 11.680649428743669, -0.9782114906043382, 5.269449034168102, -10.183004327358567, -0.040168230105817854, -0.3988505815643625, 66.48078797381677],
    plane1: [-0.0021311449439688967, 0.0547679047976722], // S = a*L + b*M
    plane2: [-0.061954832542766014, 0.16825739943426266],
    sep: [0.34516270501, -0.654796495022], // 分離面の法線（S成分は0）
  };

  function applyBrettelTritan(imageData) {
    const d = imageData.data;
    const A = BRETTEL_TRITAN.lmsFromRgb, B = BRETTEL_TRITAN.rgbFromLms;
    const p1 = BRETTEL_TRITAN.plane1, p2 = BRETTEL_TRITAN.plane2, n = BRETTEL_TRITAN.sep;
    for (let i = 0; i < d.length; i += 4) {
      const r = SRGB_TO_LIN[d[i]], g = SRGB_TO_LIN[d[i + 1]], b = SRGB_TO_LIN[d[i + 2]];
      const L = A[0] * r + A[1] * g + A[2] * b;
      const M = A[3] * r + A[4] * g + A[5] * b;
      const p = (n[0] * L + n[1] * M) < 0 ? p2 : p1;
      const S = p[0] * L + p[1] * M;
      d[i] = linToSrgb(B[0] * L + B[1] * M + B[2] * S);
      d[i + 1] = linToSrgb(B[3] * L + B[4] * M + B[5] * S);
      d[i + 2] = linToSrgb(B[6] * L + B[7] * M + B[8] * S);
    }
    return imageData;
  }

  function applyMatrix(imageData, m) {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = SRGB_TO_LIN[d[i]], g = SRGB_TO_LIN[d[i + 1]], b = SRGB_TO_LIN[d[i + 2]];
      d[i] = linToSrgb(m[0] * r + m[1] * g + m[2] * b);
      d[i + 1] = linToSrgb(m[3] * r + m[4] * g + m[5] * b);
      d[i + 2] = linToSrgb(m[6] * r + m[7] * g + m[8] * b);
    }
    return imageData;
  }
  function applyGray(imageData) {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const y = linToSrgb(0.2126 * SRGB_TO_LIN[d[i]] + 0.7152 * SRGB_TO_LIN[d[i + 1]] + 0.0722 * SRGB_TO_LIN[d[i + 2]]);
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    return imageData;
  }

  const toHex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  function parseHex(s) {
    let h = String(s).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }

  // ---------- キャンバス補助 ----------

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // 半分ずつ縮小して、縮小時のギザギザ・ちらつきを抑える
  function downscale(src, w, h) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    let cur = src;
    let cw = src.width, ch = src.height;
    while (cw / 2 >= w && ch / 2 >= h) {
      const next = makeCanvas(cw / 2, ch / 2);
      const ctx = next.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cur, 0, 0, next.width, next.height);
      cur = next; cw = next.width; ch = next.height;
    }
    const out = makeCanvas(w, h);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, w, h);
    return out;
  }

  // 縮小してから戻す方式のぼかし（ブラウザの filter 対応差に左右されない）
  function blurred(src, factor) {
    const small = downscale(src, src.width / factor, src.height / factor);
    const out = makeCanvas(src.width, src.height);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, out.width, out.height);
    return out;
  }

  function processed(src, kind) {
    if (kind === 'blur') return blurred(src, 6);
    const out = makeCanvas(src.width, src.height);
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    if (kind === 'original') return out;
    const data = ctx.getImageData(0, 0, out.width, out.height);
    if (kind === 'gray') applyGray(data);
    else if (kind === 'tritan') applyBrettelTritan(data);
    else applyMatrix(data, CVD[kind]);
    ctx.putImageData(data, 0, 0);
    return out;
  }

  // ---------- 保存（使えない環境では何もしない） ----------

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できない環境 */ }
    },
  };

  const DEFAULT_SIZES = [
    { label: '小さめの一覧', w: 160 },
    { label: 'スマホの一覧', w: 240 },
    { label: 'PCの一覧', w: 320 },
    { label: '大きめの表示', w: 480 },
  ];
  const DEFAULT_REGIONS = [
    { label: '右下の時間表示（目安）', x: 85, y: 86, w: 13, h: 10 },
    { label: '下端のバー（目安）', x: 0, y: 96, w: 100, h: 4 },
  ];
  const clone = (v) => JSON.parse(JSON.stringify(v));

  const CVD_VIEWS = [
    { kind: 'original', name: '元の画像', sub: '' },
    { kind: 'protan', name: '1型（P型）', sub: '赤の感じ方が弱い特性のシミュレーション' },
    { kind: 'deutan', name: '2型（D型）', sub: '緑の感じ方が弱い特性のシミュレーション' },
    { kind: 'tritan', name: '3型（T型）', sub: '青の感じ方が弱い特性のシミュレーション' },
    { kind: 'gray', name: '明るさのみ', sub: '色を除いた明暗だけの見え方' },
    { kind: 'blur', name: 'ぼかし', sub: '遠目・ピントが合っていないときの見え方' },
  ];

  // ---------- 状態 ----------

  const state = {
    src: null, // 原寸のキャンバス
    srcCtx: null,
    name: '',
    sizes: store.get('tvc.sizes', clone(DEFAULT_SIZES)),
    regions: store.get('tvc.regions', clone(DEFAULT_REGIONS)),
    smallBg: store.get('tvc.smallBg', 'light'),
    cvdWidth: 320,
    pickMode: 'fg',
    sample: 3,
    fg: [255, 255, 255],
    bg: [0, 0, 0],
    marks: { fg: null, bg: null }, // 画像に対する割合 {x, y}
    showRegions: true,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    drop: $('drop'), file: $('file'), pick: $('pick'), loadedName: $('loaded-name'),
    workspace: $('workspace'),
    smallRow: $('small-row'), smallBg: $('small-bg'), sizeList: $('size-list'),
    sizeAdd: $('size-add'), sizeReset: $('size-reset'),
    cvdGrid: $('cvd-grid'), cvdWidth: $('cvd-width'),
    stage: $('stage'), sampleSize: $('sample-size'), showRegions: $('show-regions'),
    hexFg: $('hex-fg'), hexBg: $('hex-bg'), swFg: $('sw-fg'), swBg: $('sw-bg'), swap: $('swap'),
    ratio: $('ratio'), ratioPreview: $('ratio-preview'),
    vAaN: $('v-aa-normal'), vAaaN: $('v-aaa-normal'), vAaL: $('v-aa-large'), vAaaL: $('v-aaa-large'),
    regionList: $('region-list'), regionAdd: $('region-add'), regionReset: $('region-reset'),
    exportBtn: $('export'),
  };

  // ---------- 読み込み ----------

  function loadFile(file) {
    if (!file || !/^image\//.test(file.type)) {
      alert('画像ファイルを選んでください。');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = makeCanvas(img.naturalWidth, img.naturalHeight);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      state.src = c;
      state.srcCtx = ctx;
      state.name = file.name || '貼り付けた画像';
      state.marks = { fg: null, bg: null };
      el.loadedName.textContent = `読み込み中の画像：${state.name}（${c.width}×${c.height}）`;
      el.loadedName.hidden = false;
      el.drop.classList.add('compact');
      el.workspace.hidden = false;
      renderAll();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert('この画像を読み込めませんでした。PNG・JPEG・WebPなどでお試しください。');
    };
    img.src = url;
  }

  el.pick.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', () => { loadFile(el.file.files[0]); el.file.value = ''; });
  el.drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.file.click(); }
  });
  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => {
    e.preventDefault();
    el.drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => {
    if (t === 'dragleave' && e.relatedTarget) return;
    el.drop.classList.remove('over');
  }));
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  document.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        loadFile(it.getAsFile());
        e.preventDefault();
        return;
      }
    }
  });

  // ---------- 1. 縮小表示 ----------

  function renderSmall() {
    el.smallRow.className = 'small-row ' + state.smallBg;
    el.smallRow.textContent = '';
    if (!state.src) return;
    const dpr = window.devicePixelRatio || 1;
    const aspect = state.src.height / state.src.width;
    state.sizes.forEach((s) => {
      const w = Math.max(16, Number(s.w) || 0);
      const h = w * aspect;
      const c = downscale(state.src, w * dpr, h * dpr);
      c.style.width = w + 'px';
      c.style.height = h + 'px';
      c.setAttribute('aria-label', `${s.label}（幅${w}px）`);
      const item = document.createElement('div');
      item.className = 'small-item';
      const cap = document.createElement('div');
      cap.className = 'small-cap';
      cap.textContent = `${s.label}・${w}px`;
      item.append(c, cap);
      el.smallRow.append(item);
    });
  }

  function renderSizeEditor() {
    el.sizeList.textContent = '';
    state.sizes.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'row-item';
      const name = textInput(s.label, '名前', (v) => { s.label = v; saveSizes(); });
      const width = numInput(s.w, '幅', 16, 1280, (v) => { s.w = v; saveSizes(); });
      const del = removeButton(`${s.label}を削除`, () => {
        state.sizes.splice(i, 1);
        saveSizes(); renderSizeEditor();
      });
      row.append(name, width, del);
      el.sizeList.append(row);
    });
    renderCvdWidthOptions();
  }
  function saveSizes() {
    store.set('tvc.sizes', state.sizes);
    renderSmall();
    renderCvdWidthOptions();
  }
  el.sizeAdd.addEventListener('click', () => {
    state.sizes.push({ label: '新しい幅', w: 200 });
    saveSizes(); renderSizeEditor();
  });
  el.sizeReset.addEventListener('click', () => {
    state.sizes = clone(DEFAULT_SIZES);
    saveSizes(); renderSizeEditor();
  });
  el.smallBg.addEventListener('change', () => {
    state.smallBg = el.smallBg.value;
    store.set('tvc.smallBg', state.smallBg);
    renderSmall();
  });

  // ---------- 2. 色覚・明度 ----------

  function renderCvdWidthOptions() {
    const current = state.cvdWidth;
    el.cvdWidth.textContent = '';
    const opts = [{ label: '大きめ', w: 320 }].concat(state.sizes.filter((s) => Number(s.w) !== 320));
    let found = false;
    opts.forEach((s) => {
      const o = document.createElement('option');
      o.value = String(s.w);
      o.textContent = `${s.label}（${s.w}px）`;
      if (Number(s.w) === current) { o.selected = true; found = true; }
      el.cvdWidth.append(o);
    });
    if (!found) { state.cvdWidth = 320; el.cvdWidth.value = '320'; }
  }
  el.cvdWidth.addEventListener('change', () => {
    state.cvdWidth = Number(el.cvdWidth.value) || 320;
    renderCvd();
  });

  function cvdBase(cssWidth) {
    const dpr = window.devicePixelRatio || 1;
    const w = cssWidth * dpr;
    return downscale(state.src, w, w * state.src.height / state.src.width);
  }

  function renderCvd() {
    el.cvdGrid.textContent = '';
    if (!state.src) return;
    const cssW = state.cvdWidth;
    const base = cvdBase(cssW);
    CVD_VIEWS.forEach((v) => {
      const c = processed(base, v.kind);
      c.style.width = cssW + 'px';
      c.setAttribute('aria-label', v.name);
      const fig = document.createElement('figure');
      fig.className = 'cvd-item';
      const cap = document.createElement('figcaption');
      cap.textContent = v.name;
      if (v.sub) {
        const small = document.createElement('small');
        small.textContent = v.sub;
        cap.append(small);
      }
      fig.append(c, cap);
      el.cvdGrid.append(fig);
    });
  }

  // ---------- 3. コントラスト ／ 4. 重なり領域 ----------

  let stageScale = 1; // 原寸 → ステージの倍率
  let stageBase = null;

  function prepareStage() {
    const maxW = 1600;
    const w = Math.min(state.src.width, maxW);
    stageScale = w / state.src.width;
    stageBase = downscale(state.src, w, state.src.height * stageScale);
    el.stage.width = stageBase.width;
    el.stage.height = stageBase.height;
  }

  function drawStage() {
    if (!stageBase) return;
    const ctx = el.stage.getContext('2d');
    const W = el.stage.width, H = el.stage.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(stageBase, 0, 0);
    const unit = Math.max(1, W / 640);
    if (state.showRegions) {
      state.regions.forEach((r) => {
        const x = (r.x / 100) * W, y = (r.y / 100) * H;
        const w = (r.w / 100) * W, h = (r.h / 100) * H;
        ctx.fillStyle = 'rgba(255, 64, 64, 0.28)';
        ctx.fillRect(x, y, w, h);
        ctx.setLineDash([6 * unit, 4 * unit]);
        ctx.lineWidth = 2 * unit;
        ctx.strokeStyle = 'rgba(255, 64, 64, 0.95)';
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        drawTag(ctx, r.label, x + 4 * unit, y + 4 * unit, unit, 'rgba(180, 20, 20, 0.92)');
      });
    }
    ['fg', 'bg'].forEach((k) => {
      const m = state.marks[k];
      if (!m) return;
      const x = m.x * W, y = m.y * H;
      ctx.lineWidth = 3 * unit;
      ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.arc(x, y, 9 * unit, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.5 * unit;
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 9 * unit, 0, Math.PI * 2); ctx.stroke();
      drawTag(ctx, k === 'fg' ? '文字' : '背景', x + 12 * unit, y - 10 * unit, unit, 'rgba(20, 20, 20, 0.85)');
    });
  }

  function drawTag(ctx, text, x, y, unit, bg) {
    ctx.font = `600 ${Math.round(12 * unit)}px system-ui, sans-serif`;
    const pad = 4 * unit;
    const tw = ctx.measureText(text).width;
    const th = 16 * unit;
    // 画像の外にはみ出さないように位置を寄せる
    const W = ctx.canvas.width, H = ctx.canvas.height;
    x = Math.max(0, Math.min(x, W - (tw + pad * 2)));
    y = Math.max(0, Math.min(y, H - th));
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, tw + pad * 2, th);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + pad, y + th / 2 + 0.5);
  }

  function sampleAt(fx, fy) {
    const n = state.sample;
    const cx = Math.floor(fx * state.src.width);
    const cy = Math.floor(fy * state.src.height);
    const half = Math.floor(n / 2);
    const x0 = Math.min(Math.max(0, cx - half), state.src.width - n);
    const y0 = Math.min(Math.max(0, cy - half), state.src.height - n);
    const d = state.srcCtx.getImageData(Math.max(0, x0), Math.max(0, y0), n, n).data;
    let r = 0, g = 0, b = 0, cnt = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; cnt++; }
    return [Math.round(r / cnt), Math.round(g / cnt), Math.round(b / cnt)];
  }

  el.stage.addEventListener('click', (e) => {
    if (!state.src) return;
    const rect = el.stage.getBoundingClientRect();
    const fx = Math.min(0.9999, Math.max(0, (e.clientX - rect.left) / rect.width));
    const fy = Math.min(0.9999, Math.max(0, (e.clientY - rect.top) / rect.height));
    const rgb = sampleAt(fx, fy);
    state[state.pickMode] = rgb;
    state.marks[state.pickMode] = { x: fx, y: fy };
    updateContrast();
    drawStage();
    // 文字色を拾ったら、次は背景色に切り替える
    if (state.pickMode === 'fg') setPickMode('bg');
  });

  function setPickMode(mode) {
    state.pickMode = mode;
    document.querySelectorAll('.seg-btn').forEach((b) => {
      const on = b.dataset.pick === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => setPickMode(b.dataset.pick)));
  el.sampleSize.addEventListener('change', () => { state.sample = Number(el.sampleSize.value) || 1; });
  el.showRegions.addEventListener('change', () => { state.showRegions = el.showRegions.checked; drawStage(); });

  function setVerdict(td, pass) {
    td.textContent = pass ? '合格' : '不足';
    td.className = pass ? 'pass' : 'fail';
  }

  function updateContrast() {
    const r = contrastRatio(state.fg, state.bg);
    const shown = Math.floor(r * 100) / 100; // 切り捨てで表示（基準をぎりぎり満たさない値を合格に見せない）
    el.ratio.textContent = `${shown.toFixed(2)} : 1`;
    el.hexFg.value = toHex(state.fg);
    el.hexBg.value = toHex(state.bg);
    el.hexFg.classList.remove('invalid');
    el.hexBg.classList.remove('invalid');
    el.swFg.style.background = toHex(state.fg);
    el.swBg.style.background = toHex(state.bg);
    el.ratioPreview.style.color = toHex(state.fg);
    el.ratioPreview.style.background = toHex(state.bg);
    setVerdict(el.vAaN, r >= 4.5);
    setVerdict(el.vAaaN, r >= 7);
    setVerdict(el.vAaL, r >= 3);
    setVerdict(el.vAaaL, r >= 4.5);
  }

  function bindHex(input, key) {
    input.addEventListener('input', () => {
      const rgb = parseHex(input.value);
      if (!rgb) { input.classList.add('invalid'); return; }
      state[key] = rgb;
      state.marks[key] = null;
      const pos = input.selectionStart;
      updateContrast();
      input.setSelectionRange(pos, pos);
      drawStage();
    });
    input.addEventListener('blur', () => { input.value = toHex(state[key]); input.classList.remove('invalid'); });
  }
  bindHex(el.hexFg, 'fg');
  bindHex(el.hexBg, 'bg');
  el.swap.addEventListener('click', () => {
    [state.fg, state.bg] = [state.bg, state.fg];
    [state.marks.fg, state.marks.bg] = [state.marks.bg, state.marks.fg];
    updateContrast();
    drawStage();
  });

  function renderRegionEditor() {
    el.regionList.textContent = '';
    state.regions.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'row-item region-item';
      row.append(
        textInput(r.label, '名前', (v) => { r.label = v; saveRegions(); }),
        numInput(r.x, '左', 0, 100, (v) => { r.x = v; saveRegions(); }),
        numInput(r.y, '上', 0, 100, (v) => { r.y = v; saveRegions(); }),
        numInput(r.w, '幅', 0, 100, (v) => { r.w = v; saveRegions(); }),
        numInput(r.h, '高さ', 0, 100, (v) => { r.h = v; saveRegions(); }),
        removeButton(`${r.label}を削除`, () => {
          state.regions.splice(i, 1);
          saveRegions(); renderRegionEditor();
        }),
      );
      el.regionList.append(row);
    });
  }
  function saveRegions() {
    store.set('tvc.regions', state.regions);
    drawStage();
  }
  el.regionAdd.addEventListener('click', () => {
    state.regions.push({ label: '新しい領域', x: 2, y: 2, w: 20, h: 12 });
    saveRegions(); renderRegionEditor();
  });
  el.regionReset.addEventListener('click', () => {
    state.regions = clone(DEFAULT_REGIONS);
    saveRegions(); renderRegionEditor();
  });

  // ---------- 入力部品 ----------

  function textInput(value, label, onChange) {
    const l = document.createElement('label');
    l.textContent = label;
    const i = document.createElement('input');
    i.type = 'text';
    i.value = value;
    i.addEventListener('input', () => onChange(i.value));
    l.append(i);
    return l;
  }
  function numInput(value, label, min, max, onChange) {
    const l = document.createElement('label');
    l.textContent = label;
    const i = document.createElement('input');
    i.type = 'number';
    i.min = String(min);
    i.max = String(max);
    i.step = 'any';
    i.value = String(value);
    i.addEventListener('input', () => {
      const v = Number(i.value);
      if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
    });
    l.append(i);
    return l;
  }
  function removeButton(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn';
    b.textContent = '削除';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------- 比較シートの書き出し ----------

  function exportSheet() {
    if (!state.src) return;
    const PAD = 32, GAP = 20, W = 1400;
    const font = (size, weight) => `${weight || 400} ${size}px system-ui, -apple-system, "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif`;
    const aspect = state.src.height / state.src.width;

    const mainW = 640, mainH = Math.round(mainW * aspect);
    const smallH = Math.max(...state.sizes.map((s) => (Number(s.w) || 0) * aspect), 0);
    const cvdW = Math.floor((W - PAD * 2 - GAP * 2) / 3);
    const cvdH = Math.round(cvdW * aspect);

    const headerH = 64;
    const row1 = Math.max(mainH, 290); // 右側の数値欄が収まる高さを確保
    const row2 = 30 + smallH + 28;
    const row3 = 30 + (cvdH + 30) * 2;
    const H = PAD + headerH + row1 + GAP * 2 + row2 + GAP + row3 + PAD;

    const out = makeCanvas(W, H);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1d1d1f';
    ctx.textBaseline = 'top';

    // 見出し
    ctx.font = font(24, 700);
    ctx.fillText('サムネ視認性チェッカー 比較シート', PAD, PAD);
    ctx.font = font(14);
    ctx.fillStyle = '#5d5b57';
    const now = new Date();
    ctx.fillText(`${state.name}（${state.src.width}×${state.src.height}） ／ ${now.toLocaleString('ja-JP')}`, PAD, PAD + 34);

    // 元画像（重なり領域つき）とコントラスト
    let y = PAD + headerH;
    const main = downscale(state.src, mainW, mainH);
    ctx.drawImage(main, PAD, y);
    if (state.showRegions) {
      state.regions.forEach((r) => {
        ctx.fillStyle = 'rgba(255, 64, 64, 0.28)';
        ctx.fillRect(PAD + (r.x / 100) * mainW, y + (r.y / 100) * mainH, (r.w / 100) * mainW, (r.h / 100) * mainH);
        ctx.strokeStyle = 'rgba(255, 64, 64, 0.95)';
        ctx.lineWidth = 2;
        ctx.strokeRect(PAD + (r.x / 100) * mainW, y + (r.y / 100) * mainH, (r.w / 100) * mainW, (r.h / 100) * mainH);
      });
    }
    const tx = PAD + mainW + 40;
    const ratio = contrastRatio(state.fg, state.bg);
    ctx.fillStyle = '#5d5b57';
    ctx.font = font(15, 600);
    ctx.fillText('文字と背景のコントラスト比（WCAG 2.x）', tx, y);
    ctx.fillStyle = '#1d1d1f';
    ctx.font = font(40, 700);
    ctx.fillText(`${(Math.floor(ratio * 100) / 100).toFixed(2)} : 1`, tx, y + 26);
    [['文字色', state.fg], ['背景色', state.bg]].forEach(([label, rgb], i) => {
      const sy = y + 86 + i * 40;
      ctx.fillStyle = toHex(rgb);
      ctx.fillRect(tx, sy, 30, 30);
      ctx.strokeStyle = '#c9c6bf';
      ctx.lineWidth = 1;
      ctx.strokeRect(tx + 0.5, sy + 0.5, 29, 29);
      ctx.fillStyle = '#1d1d1f';
      ctx.font = font(15);
      ctx.fillText(`${label}  ${toHex(rgb)}`, tx + 42, sy + 6);
    });
    const checks = [
      ['通常の文字 AA（4.5以上）', ratio >= 4.5],
      ['通常の文字 AAA（7以上）', ratio >= 7],
      ['大きい文字 AA（3以上）', ratio >= 3],
      ['大きい文字 AAA（4.5以上）', ratio >= 4.5],
    ];
    checks.forEach(([label, pass], i) => {
      const sy = y + 176 + i * 26;
      ctx.font = font(15);
      ctx.fillStyle = '#1d1d1f';
      ctx.fillText(label, tx, sy);
      ctx.font = font(15, 700);
      ctx.fillStyle = pass ? '#1f7a3d' : '#b42318';
      ctx.fillText(pass ? '合格' : '不足', tx + 250, sy);
    });

    // 縮小表示（等倍）
    y += row1 + GAP * 2;
    ctx.fillStyle = '#1d1d1f';
    ctx.font = font(16, 700);
    ctx.fillText('小さく表示したとき（等倍）', PAD, y);
    const rowBg = state.smallBg === 'dark' ? '#0f0f10' : '#f3f2ee';
    ctx.fillStyle = rowBg;
    ctx.fillRect(PAD, y + 28, W - PAD * 2, smallH + 30);
    let sx = PAD + 14;
    state.sizes.forEach((s) => {
      const w = Number(s.w) || 0;
      if (w < 16 || sx + w > W - PAD) return;
      const h = Math.round(w * aspect);
      ctx.drawImage(downscale(state.src, w, h), sx, y + 32 + (smallH - h));
      ctx.fillStyle = state.smallBg === 'dark' ? '#cfcdc8' : '#5d5b57';
      ctx.font = font(12);
      ctx.fillText(`${s.label}・${w}px`, sx, y + 36 + smallH);
      sx += w + 18;
    });

    // 色の見え方
    y += row2 + GAP;
    ctx.fillStyle = '#1d1d1f';
    ctx.font = font(16, 700);
    ctx.fillText('色の見え方・明るさ', PAD, y);
    const base = downscale(state.src, cvdW, cvdH);
    CVD_VIEWS.forEach((v, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = PAD + col * (cvdW + GAP);
      const yy = y + 30 + row * (cvdH + 30);
      ctx.drawImage(processed(base, v.kind), x, yy);
      ctx.fillStyle = '#1d1d1f';
      ctx.font = font(13, 600);
      ctx.fillText(v.name, x, yy + cvdH + 6);
    });

    out.toBlob((blob) => {
      if (!blob) { alert('画像を作れませんでした。'); return; }
      const a = document.createElement('a');
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      a.download = `visibility-check_${stamp}.png`;
      a.href = URL.createObjectURL(blob);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }
  el.exportBtn.addEventListener('click', exportSheet);

  // ---------- まとめて描画 ----------

  function renderAll() {
    renderSmall();
    renderCvd();
    prepareStage();
    drawStage();
    updateContrast();
  }

  // 画面の拡大率が変わったら縮小表示を描き直す
  let lastDpr = window.devicePixelRatio || 1;
  window.addEventListener('resize', () => {
    const d = window.devicePixelRatio || 1;
    if (d !== lastDpr && state.src) {
      lastDpr = d;
      renderSmall();
      renderCvd();
    }
  });

  // 初期表示
  el.smallBg.value = state.smallBg;
  renderSizeEditor();
  renderRegionEditor();
  updateContrast();

  // テスト用に計算関数を公開
  window.TVC = { contrastRatio, relativeLuminance, parseHex, toHex, CVD, applyMatrix, applyBrettelTritan };
})();
