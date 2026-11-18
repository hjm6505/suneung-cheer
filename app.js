// 본판_1 — 문구 고치는 응원 영상(엄마 영상). 폰 안에서 「실제 시간으로 틀면서 그려 담는」 방식.
// 그리기: 영상 요소(활활 타는 불·사그라든 불)를 캔버스에 그림 + scene.js(하늘·불씨) + 글자(줄마다 미리 그려 둔 조각을 스며들게)
// 담기: WebCodecs VideoEncoder(H.264) + AudioEncoder(AAC) → mp4-muxer. 안 되면 MediaRecorder(화면 녹화).
// 값·글자는 모두 cuts.json 한 곳에서 읽는다(좌표는 1080×1920 기준).
(() => {
'use strict';
const { clamp, smooth, lerp, drawSky, fireState, growMask, drawIgnite, pieceAt, drawSpark } = window.SC;
const BW = 1080, BH = 1920, W = 720, H = 1280, S = W / BW;
const DRAFT_KEY = 'cheer-video-draft-v2-', VER_KEY = 'cheer-video-ver', OUT_NAME = '응원영상';
// 세 판 — 판마다 cuts 파일 하나, 초안도 판마다 따로
const VERS = [{ id: 'mom1', name: '엄마 영상 1', file: 'cuts-mom1.json' }, { id: 'mom2', name: '엄마 영상 2', file: 'cuts-mom2.json' }, { id: 'family', name: '교회 가족 영상', file: 'cuts-family.json' }];
const LISTS = {}; let VER = null, TAGS = null, HOLD = 0, FULL = 115.2, TAGSEGS = null;
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mk = (w, h, o) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', o)]; };
const cv = $('cv'), g = cv.getContext('2d');
const [fc, fg] = mk(W, H), [hc, hg] = mk(W, H), [pc, pg] = mk(8, 8, { willReadFrequently: true }), [, mg] = mk(8, 8);
const R = x => { x.setTransform(S, 0, 0, S, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; };
const HASLS = 'letterSpacing' in mg;
let LIST = null, P = null, ST = null, CUTS = [], FPS = 24, TOTAL = 115.2, HI = null, LOW = null;
let busy = false, cancelled = false, sel = 1, dirty = true, outBlob = null, outExt = 'mp4', outURL = null, wentHidden = false;

const logLines = [];
const log = s => { logLines.push(s); $('log').textContent = logLines.join('\n'); };
const say = (s, cls) => { $('status').textContent = s; $('status').className = cls || ''; };

// ── 불 영상 돌려 잇기: 영상 요소 둘이 번갈아 튼다. 끝나기 seamLen초 전에 다음 것을 처음(from)부터 틀어 겹친다(5판과 같은 겹침).
class Loop {
  constructor(url, from) {
    this.from = from || 0; this.cur = 0; this.tail = -1; this.on = false;
    this.v = [0, 1].map(() => { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.preload = 'auto'; v.src = url; return v; });
  }
  load() { return Promise.all(this.v.map(v => new Promise(res => { const done = () => { try { v.currentTime = this.from; } catch (e) {} res(); }; if (v.readyState >= 2) return done(); v.addEventListener('loadeddata', done, { once: true }); v.addEventListener('error', () => res(), { once: true }); v.load(); }))); }
  start(restart) {
    if (restart) { for (const v of this.v) { v.pause(); try { v.currentTime = this.from; } catch (e) {} } this.cur = 0; this.tail = -1; this.on = false; }
    if (this.on) return; this.on = true; this.v[this.cur].play().catch(() => {}); if (this.tail >= 0) this.v[this.tail].play().catch(() => {});
  }
  stop() { if (!this.on) return; this.on = false; for (const v of this.v) v.pause(); }
  tick() {
    if (!this.on) return; const SL = P.seamLen, c = this.v[this.cur], d = c.duration || 0;
    if (this.tail < 0 && d && (c.currentTime >= d - SL || c.ended)) { this.tail = this.cur; this.cur = 1 - this.cur; this.v[this.cur].play().catch(() => {}); }
    if (this.tail >= 0 && this.v[this.cur].currentTime - this.from >= SL) { const tl = this.v[this.tail]; tl.pause(); try { tl.currentTime = this.from; } catch (e) {} this.tail = -1; }
  }
  frames() { const c = this.v[this.cur]; if (this.tail < 0) return [[c, 1]]; return [[this.v[this.tail], 1], [c, smooth((c.currentTime - this.from) / P.seamLen)]]; }
}
// 그 때(t)에 어느 불 영상이 돌아야 하나
function need(t) { return { hi: t < P.pieceFade + P.pieceFadeLen + 0.2 || t >= P.igniteAt - 0.6, low: t >= P.downStart - 0.6 }; }
function ensure(t) { const n = need(t); if (n.hi) HI.start(); else HI.stop(); if (n.low) LOW.start(); else LOW.stop(); HI.tick(); LOW.tick(); }

function put(ctx, v, z) { const vw = v.videoWidth, vh = v.videoHeight; if (!vw) return; const C = P.fireCenter || [0.5, 0.6], k = Math.max(BW / vw, BH / vh) * z, w = vw * k, h = vh * k; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(v, BW * C[0] - w * C[0], BH * C[1] - h * C[1], w, h); }
function drawLoop(ctx, loop, z) { for (const [v, a] of loop.frames()) { if (v.readyState < 2) continue; ctx.globalAlpha = a; put(ctx, v, z); } ctx.globalAlpha = 1; }
function drawFire(t, s) {
  R(fg); fg.clearRect(0, 0, BW, BH);
  if (s.kind === 'up') drawLoop(fg, HI, s.z);
  else {
    drawLoop(fg, LOW, s.z);
    if (s.G > 0) { // 자라는 불: 활활 타는 불을 둥근 지붕 꼴 안에만 얹는다
      const m = growMask(s.G, P); R(hg); hg.clearRect(0, 0, BW, BH); drawLoop(hg, HI, s.z);
      hg.globalCompositeOperation = 'destination-in'; const top = m.amb, bot = Math.max(m.amb, m.core);
      hg.save(); hg.translate(m.cx, m.cy); hg.scale(m.rx, m.ry); const gr = hg.createRadialGradient(0, 0, 0.42, 0, 0, 1);
      gr.addColorStop(0, `rgba(0,0,0,${bot})`); gr.addColorStop(0.5, `rgba(0,0,0,${lerp(top, bot, 0.6)})`); gr.addColorStop(1, `rgba(0,0,0,${top})`);
      hg.fillStyle = gr; hg.fillRect(-BW * 4 / m.rx, -BH * 4 / m.ry, BW * 8 / m.rx, BH * 8 / m.ry); hg.restore();
      R(fg); fg.drawImage(hc, 0, 0, BW, BH);
    }
  }
  if (s.dark > 0) { fg.fillStyle = `rgba(4,2,1,${s.dark})`; fg.fillRect(0, 0, BW, BH); }
  if (s.mask > 0) { fg.globalCompositeOperation = 'destination-in'; const m = fg.createLinearGradient(0, 0, 0, BH * 0.5); m.addColorStop(0, `rgba(0,0,0,${1 - s.mask})`); m.addColorStop(1, 'rgba(0,0,0,1)'); fg.fillStyle = m; fg.fillRect(0, 0, BW, BH); fg.globalCompositeOperation = 'source-over'; }
}
// 불꽃 한 조각: 활활 타는 불 영상에서 불꽃 자리만 떼어, 밝고 따뜻한 화소만 물방울 꼴로 남겨 더해 그린다(그린 불이 아니라 영상의 불꽃).
function drawPiece(t) {
  const pp = pieceAt(t, P); if (!pp || pp.a <= 0.003) return; const fr = HI.frames().filter(([v]) => v.readyState >= 2 && v.videoWidth); if (!fr.length) return;
  const [cx, cy, rw, rh] = P.pieceCrop, v0 = fr[0][0], vw = v0.videoWidth, vh = v0.videoHeight, k = Math.max(BW / vw, BH / vh);
  const PW = rw * 2 * vw * k, PH = rh * 2 * vh * k, pw = Math.max(2, Math.round(PW * S)), ph = Math.max(2, Math.round(PH * S)); if (pc.width !== pw || pc.height !== ph) { pc.width = pw; pc.height = ph; }
  pg.setTransform(1, 0, 0, 1, 0, 0); pg.globalCompositeOperation = 'source-over'; pg.clearRect(0, 0, pw, ph); let first = true;
  for (const [f, w] of fr) { pg.globalAlpha = first ? 1 : w; first = false; pg.drawImage(f, (cx - rw) * vw, (cy - rh) * vh, rw * 2 * vw, rh * 2 * vh, 0, 0, pw, ph); } pg.globalAlpha = 1;
  const im = pg.getImageData(0, 0, pw, ph), d = im.data;
  for (let y = 0; y < ph; y++) { const dy = (y / ph - 0.5) * 2; for (let x = 0; x < pw; x++) { const i = (y * pw + x) * 4, dx = (x / pw - 0.5) * 2; const r = d[i], gr = d[i + 1], b = d[i + 2]; let v = (r - b * 0.95 - 70) / 85; v = v < 0 ? 0 : v > 1 ? 1 : v; const lum = (r + gr) / 510; const wx = dx / (0.55 + 0.45 * (dy + 1) / 2); const e = Math.max(0, 1 - Math.pow(wx * wx + dy * dy, 1.5)); d[i + 3] = Math.round(255 * Math.min(1, v * 1.25) * Math.min(1, lum * 1.15) * e); } }
  pg.putImageData(im, 0, 0);
  R(g); g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = pp.a; g.translate(pp.x, pp.y); g.rotate(pp.rot); g.scale(pp.s, pp.s); g.imageSmoothingQuality = 'high';
  g.drawImage(pc, -PW / 2, -PH / 2, PW, PH); g.globalAlpha = pp.a * 0.6; g.drawImage(pc, -PW / 2, -PH / 2, PW, PH); g.restore();
  g.save(); g.globalCompositeOperation = 'lighter'; const R2 = Math.max(PW, PH) * 0.9 * pp.s + 40, gl = g.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, R2); gl.addColorStop(0, `rgba(255,180,90,${0.22 * pp.a})`); gl.addColorStop(1, 'rgba(255,150,60,0)'); g.fillStyle = gl; g.fillRect(pp.x - R2, pp.y - R2, R2 * 2, R2 * 2); g.restore();
}

// ── 글자. 줄 맞춤(5판 규칙): 가장 넓은 줄 ≤ 너비의 78%. 넘치면 ① 자간을 좁히고 ② 장평을 88%까지 ③ 그래도 넘치면 글씨를 줄인다.
const fontOf = px => `400 ${px}px "Bujang", sans-serif`;
function parseItems(cut) { // 강조 줄의 「|」: 한 줄에 넣으면 글씨가 줄어들 때만 그 자리에서 두 줄로 나눈다(5판 규칙)
  const out = []; let nMain = cut.lines.filter(o => !(typeof o === 'string' && o.startsWith('~'))).length;
  for (const o of cut.lines) { const s = typeof o === 'string' ? o : o.t; let k = 'body', t = s; if (s.startsWith('~')) { k = 'small'; t = s.slice(1); } else if (s.startsWith('**')) { k = 'big'; t = s.split('**').join(''); }
    if (t.includes('|')) { const whole = { k, t: t.split('|').join(' '), cs: cut.scale || 1 }; fitLine(whole); if (whole.sc < 1 && k === 'big' && nMain < 4) { for (const q of t.split('|')) out.push({ k, t: q.trim() }); nMain++; continue; } t = whole.t; }
    out.push({ k, t, atFix: (typeof o === 'object' && o.at != null) ? o.at : null, gap: (typeof o === 'object' && o.gap) || 0 }); }
  return out.map((it, i) => ({ k: it.k, t: it.t, t0: it.t, orig: true, at: it.atFix != null ? it.atFix : +(cut.first + i * cut.step).toFixed(3), gap: it.gap || 0 }));
}
function measLine(ln) { const px = ST[ln.k].px * ln.sc * ln.cs; mg.font = fontOf(px); if (HASLS) mg.letterSpacing = (px * ln.ls) + 'px'; ln.nat = mg.measureText(ln.t).width; ln.w = ln.nat * ln.sx; return ln.nat; }
function fitLine(ln) { const MAXW = BW * ST.maxWidthRatio; ln.ls = ST.ls; ln.sx = 1; ln.sc = 1; let w = measLine(ln); if (w <= MAXW) return; ln.ls = ST.lsTight; w = measLine(ln); if (w <= MAXW) return; ln.sx = Math.max(ST.minSX, MAXW / w); if (w * ln.sx > MAXW) ln.sc = MAXW / (w * ln.sx) * 0.999; measLine(ln); }
function layout(cut) {
  if (cut._L) return cut._L; const L = [];
  for (const it of cut.items) { const t = it.t.trim(); if (!t) continue; const ln = { k: it.k, t, at: it.at, gap: it.gap || 0, cs: cut.scale || 1, it, c: null }; ln.lh = ST[ln.k].lh * ln.cs; fitLine(ln); L.push(ln); }
  const bigs = L.filter(ln => ln.k === 'big'); if (bigs.length > 1) { const sx = Math.min(...bigs.map(b => b.sx)), sc = Math.min(...bigs.map(b => b.sc)), ls = Math.min(...bigs.map(b => b.ls)); for (const b of bigs) { b.sx = sx; b.sc = sc; b.ls = ls; measLine(b); } } // 한 화면의 강조 줄들은 장평·크기를 같게
  let hsum = 0; for (const ln of L) hsum += ln.lh + ln.gap; const top = cut.top; let y = top; for (const ln of L) { y += ln.gap; ln.base = y + ln.lh * 0.7; y += ln.lh; }
  return cut._L = { L, top, bot: top + hsum };
}
// 한 줄을 작은 캔버스에 미리 그려 둔다(그림자·테 포함) — 장면마다 다시 그리지 않아 폰에서 가볍다.
function lineCanvas(ln) {
  if (ln.c) return ln.c; const px = ST[ln.k].px * ln.sc * ln.cs, pad = px * 0.75; ln.pad = pad; ln.hB = ln.lh + pad * 2;
  const [c, x] = mk(W, Math.ceil(ln.hB * S)); x.setTransform(S, 0, 0, S, 0, 0); x.translate(BW / 2, pad + ln.lh * 0.7); x.scale(ln.sx, 1); x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.font = fontOf(px); if (HASLS) x.letterSpacing = (px * ln.ls) + 'px';
  const col = ST[ln.k].color, X = -ln.nat / 2;
  if (ln.k === 'big') { x.shadowColor = 'rgba(236,140,50,0.5)'; x.shadowBlur = px * 0.42 * S; x.shadowOffsetY = 0; x.fillStyle = col; x.fillText(ln.t, X, 0); }
  x.shadowColor = 'rgba(0,0,0,0.72)'; x.shadowBlur = px * 0.26 * S; x.shadowOffsetY = 2 * S; x.fillStyle = col; x.fillText(ln.t, X, 0); x.shadowColor = 'transparent'; x.fillText(ln.t, X, 0);
  const sw = (ST.stroke && ST.stroke[ln.k]) || 0; if (sw > 0) { x.lineJoin = 'round'; x.lineWidth = px * sw; x.strokeStyle = col; x.strokeText(ln.t, X, 0); }
  return ln.c = c;
}
let lastTextCut = null;
function drawText(t) {
  for (const cut of CUTS) {
    if (t < cut.first || t > cut.out) continue; const { L, top, bot } = layout(cut); if (!L.length) continue;
    if (lastTextCut && lastTextCut !== cut && lastTextCut._L) for (const ln of lastTextCut._L.L) ln.c = null; lastTextCut = cut; // 지난 컷의 글자 조각은 놓아 준다
    const outA = 1 - smooth((t - (cut.out - ST.fadeOut)) / ST.fadeOut); const al = L.map(ln => smooth((t - ln.at) / ST.fadeIn) * outA); const mx = Math.max(...al);
    if (cut.veil && mx > 0) { const y0 = top - 240, y1 = bot + 240, vg = g.createLinearGradient(0, y0, 0, y1), v = cut.veil * mx; vg.addColorStop(0, 'rgba(5,4,9,0)'); vg.addColorStop(0.32, `rgba(5,4,9,${v})`); vg.addColorStop(0.68, `rgba(5,4,9,${v})`); vg.addColorStop(1, 'rgba(5,4,9,0)'); g.fillStyle = vg; g.fillRect(0, y0, BW, y1 - y0); }
    L.forEach((ln, i) => { const a = al[i]; if (a <= 0.003) return; const c = lineCanvas(ln), y = ln.base + (1 - a) * 10 * (outA >= 1 ? 1 : 0); g.globalAlpha = a; g.drawImage(c, 0, y - (ln.pad + ln.lh * 0.7), BW, c.height / S); }); g.globalAlpha = 1;
  }
}
// ── 이름표(교회 가족 영상): 왼쪽 위의 작은 둥근 표. 같은 사람이 이어지는 컷은 한 덩이로 머물고, 사람이 바뀌면 스며 나가고 스며든다(5판과 같음).
function tagSegs() { if (TAGSEGS) return TAGSEGS; TAGSEGS = []; for (const c of CUTS) { if (!c.tag) continue; const last = TAGSEGS[TAGSEGS.length - 1], from = (c.tagFrom ?? c.first) - 0.4, to = c.out + 0.15; if (last && last.tag === c.tag && from - last.to < 3.5) last.to = to; else TAGSEGS.push({ tag: c.tag, from, to }); } return TAGSEGS; }
function rrect(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
// 이름표 너비를 잰다. 화면 너비(양옆 x만큼 남김)를 넘으면 k(<1)만큼 통째로 줄여 그린다.
function tagFit(p) { const T = TAGS, px = T.px, label = (p.label || '').trim(); mg.font = fontOf(px); if (HASLS) mg.letterSpacing = (px * 0.02) + 'px'; const pre = p.n ? T.prefix + ' ' : '', wPre = pre ? mg.measureText(pre).width : 0, cr = p.n ? px * 0.36 : 0, wNum = p.n ? cr * 2 + px * 0.2 : 0, wName = mg.measureText(label).width, w = T.pad * 2 + wPre + wNum + wName; return { label, pre, wPre, cr, wNum, wName, w, k: Math.min(1, (BW - T.x * 2) / w) }; }
function drawTags(t) {
  const T = TAGS; if (!T) return;
  for (const sg of tagSegs()) { if (t < sg.from || t > sg.to) continue; const a = smooth((t - sg.from) / T.fade) * (1 - smooth((t - (sg.to - T.fade)) / T.fade)); if (a <= 0.003) continue; const p = T.people[sg.tag]; if (!p || p.hide) continue; const F = tagFit(p); if (!F.label) continue;
    const px = T.px, f = fontOf(px), w = F.w, h = T.h; g.save(); g.translate(T.x, T.y - (1 - a) * 8); g.scale(F.k, F.k); g.globalAlpha = a; g.font = f; if (HASLS) g.letterSpacing = (px * 0.02) + 'px'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 18 * S; g.shadowOffsetY = 4 * S; rrect(0, 0, w, h, T.r); g.fillStyle = `rgba(${p.fill[0]},${p.fill[1]},${p.fill[2]},${T.alpha})`; g.fill(); g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,236,200,0.38)'; rrect(1, 1, w - 2, h - 2, T.r - 1); g.stroke();
    const base = h / 2 + px * 0.3; let cx = T.pad; g.fillStyle = T.color; g.lineJoin = 'round'; g.lineWidth = px * 0.012; g.strokeStyle = T.color; if (F.pre) { g.fillText(F.pre, cx, base); g.strokeText(F.pre, cx, base); cx += F.wPre; }
    if (p.n) { const cr = F.cr; g.lineWidth = 2.4; g.beginPath(); g.arc(cx + cr, h / 2, cr, 0, 6.283); g.stroke(); g.font = fontOf(px * 0.62); g.textAlign = 'center'; if (HASLS) g.letterSpacing = '0px'; g.fillText(String(p.n), cx + cr, h / 2 + px * 0.62 * 0.3); g.font = f; g.textAlign = 'left'; if (HASLS) g.letterSpacing = (px * 0.02) + 'px'; cx += F.wNum; }
    g.lineWidth = px * 0.012; g.fillText(F.label, cx, base); g.strokeText(F.label, cx, base); g.restore(); if (HASLS) g.letterSpacing = '0px'; }
}
// ── 말 상자: 글자 아래의 밝고 둥근 상자. 딸깍딸깍 — 왼쪽·오른쪽으로 기울어 잠깐 머물다 넘어간다. 번쩍임 없음(5판과 같음).
function bubbleFit(B) { const px = B.px, t = (B.t || '').trim(); mg.font = fontOf(px); if (HASLS) mg.letterSpacing = (px * 0.03) + 'px'; const tw = mg.measureText(t).width, w = tw + B.padX * 2; return { t, tw, w, k: Math.min(1, BW * 0.86 / w) }; }
function drawBubbles(t) {
  for (const cut of CUTS) { const B = cut.bubble; if (!B || t < B.at || t > cut.out) continue; const F = bubbleFit(B); if (!F.t) continue; const { bot } = layout(cut); const outA = 1 - smooth((t - (cut.out - ST.fadeOut)) / ST.fadeOut); const u = clamp((t - B.at) / 0.45), a = smooth(u * 1.6) * outA; if (a <= 0.003) continue;
    const pop = 1 - Math.pow(1 - u, 3) * (1 - 0.82) - 0.06 * Math.sin(u * Math.PI) * (1 - u); const px = B.px, w = F.w, h = px * 1.42, cx = BW / 2, cy = bot + B.gapTop + h * F.k / 2;
    const ang = (B.angle * Math.PI / 180) * Math.tanh(3.2 * Math.sin(6.283 * B.hz * (t - B.at - 0.45))) / Math.tanh(3.2) * smooth((t - B.at - 0.3) / 0.4);
    g.save(); g.font = fontOf(px); if (HASLS) g.letterSpacing = (px * 0.03) + 'px'; g.translate(cx, cy + h * F.k * 0.5); g.rotate(ang); g.translate(0, -h * F.k * 0.5); g.scale(pop * F.k, pop * F.k); g.globalAlpha = a;
    g.shadowColor = 'rgba(40,16,4,0.45)'; g.shadowBlur = 22 * S; g.shadowOffsetY = 6 * S; rrect(-w / 2, -h / 2, w, h, h * 0.46); g.fillStyle = B.fill; g.fill(); g.beginPath(); g.moveTo(-w * 0.2, -h / 2 + 2); g.lineTo(-w * 0.2 + 26, -h / 2 - 30); g.lineTo(-w * 0.2 + 58, -h / 2 + 2); g.closePath(); g.fill();
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = B.color; g.fillText(F.t, 0, px * 0.32); g.lineJoin = 'round'; g.lineWidth = px * 0.014; g.strokeStyle = B.color; g.strokeText(F.t, 0, px * 0.32); g.restore(); if (HASLS) g.letterSpacing = '0px'; }
}
function draw(t) {
  const s = fireState(t, P); R(g); g.fillStyle = '#000'; g.fillRect(0, 0, BW, BH);
  const sky = t >= P.tiltStart && (!s.on || s.a < 1 || s.mask > 0 || s.y > 0); if (sky) drawSky(g, t, P);
  if (s.on && s.a > 0.002) { drawFire(t, s); R(g); g.globalAlpha = s.a; g.drawImage(fc, 0, s.y, BW, BH); g.globalAlpha = 1; }
  drawIgnite(g, t, P); drawText(t); drawBubbles(t); drawPiece(t); R(g); drawSpark(g, t, P); drawTags(t);
}

// ── 소리: 줄마다 꺾은선 크기를 입혀 더한다(5판과 같은 값). 음악 파일이 없으면 장작 소리만, 둘 다 없으면 소리 없는 판.
const GA = d => d <= -90 ? 0 : Math.pow(10, d / 20);
async function buildAudio() {
  const A = LIST['소리']; if (!A || !window.OfflineAudioContext) return null; const SR = 48000, ctx = new OfflineAudioContext(2, Math.max(SR, Math.floor(SR * (TOTAL + HOLD - 0.06))), SR), cache = {}; // 소리는 그림보다 0.06초 짧게(소리 줄이 그림 줄보다 길지 않게)
  // 끝 멈춤(HOLD): 영상 끝(FULL)에서 맺던 줄은 맺는 때를 멈춘 화면 안(FULL+HOLD-0.2)으로 늦춰, 음악·장작 소리가 멈춘 화면 안에서 잦아들게 한다
  const stretch = tr => { const db = tr.db.map(p => p.slice()); const last = db[db.length - 1]; if (HOLD > 0 && last[0] >= FULL - 0.01) { last[0] = FULL + HOLD - 0.2; return { ...tr, db, len: tr.len ? tr.len + HOLD : tr.len }; } return { ...tr, db }; };
  const one = async tr0 => {
    if (!tr0 || !tr0.src) return false; const tr = stretch(tr0);
    if (!(tr.src in cache)) { try { const r = await fetch(tr.src); if (!r.ok) throw new Error('없음'); cache[tr.src] = await ctx.decodeAudioData(await r.arrayBuffer()); } catch (e) { cache[tr.src] = null; log('소리 파일 못 읽음: ' + tr.src + ' (' + (e.message || e.name) + ')'); } }
    const buf = cache[tr.src]; if (!buf) return false; const s = ctx.createBufferSource(); s.buffer = buf; const gg = ctx.createGain(); gg.gain.setValueAtTime(GA(tr.db[0][1]), 0);
    for (let k = 1; k < tr.db.length; k++) { const [t0, d0] = tr.db[k - 1], [t1, d1] = tr.db[k]; const n = Math.max(2, Math.ceil((t1 - t0) * 50)), curve = new Float32Array(n); for (let i = 0; i < n; i++) { const u = i / (n - 1); curve[i] = (d0 <= -90 || d1 <= -90) ? lerp(GA(d0), GA(d1), u * u * (3 - 2 * u)) : GA(lerp(d0, d1, u)); } gg.gain.setValueCurveAtTime(curve, t0, t1 - t0 - 0.0005); }
    s.connect(gg); gg.connect(ctx.destination); if (tr.len) s.start(tr.at, tr.from, Math.min(tr.len, Math.max(0.1, buf.duration - tr.from))); else s.start(tr.at, tr.from || 0); return true;
  };
  const music = await one(A.music); let fire = false; for (const f of (A.fire || [])) fire = (await one(f)) || fire;
  if (!music && !fire) return null; return { buf: await ctx.startRendering(), music, fire };
}

// ── 담기 ①: WebCodecs
async function viaWebCodecs(audio) {
  if (!('VideoEncoder' in window) || typeof Mp4Muxer === 'undefined') throw new Error('이 기기에 VideoEncoder 또는 묶는 도구가 없음');
  let cfg = null;
  for (const codec of ['avc1.42001f', 'avc1.4d001f', 'avc1.640028']) { const c = { codec, width: W, height: H, bitrate: 2_000_000, framerate: FPS }; try { const r = await VideoEncoder.isConfigSupported(c); if (r.supported) { cfg = c; break; } } catch (e) {} }
  if (!cfg) throw new Error('H.264 인코더 설정이 지원되지 않음');
  let acfg = null, amux = null;
  if (audio && 'AudioEncoder' in window) for (const [codec, m] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) { const c = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }; try { const r = await AudioEncoder.isConfigSupported(c); if (r.supported) { acfg = c; amux = m; break; } } catch (e) {} }
  log('그림: ' + cfg.codec + ' · 소리: ' + (acfg ? acfg.codec : (audio ? '담는 도구 없음 → 소리 없는 판' : '없음')));
  const mopt = { target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' };
  if (acfg) mopt.audio = { codec: amux, numberOfChannels: 2, sampleRate: 48000 };
  const muxer = new Mp4Muxer.Muxer(mopt); let err = null, sound = false;
  if (acfg) { // 소리를 먼저 담는다(빠르다)
    try {
      const ae = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: e => { err = e; } }); ae.configure(acfg);
      const Lc = audio.buf.getChannelData(0), Rc = audio.buf.getChannelData(1), N = audio.buf.length, STEP = 4800;
      for (let i = 0; i < N; i += STEP) { if (err) throw err; if (cancelled) { ae.close(); throw new Error('취소'); } const n = Math.min(STEP, N - i), data = new Float32Array(n * 2); data.set(Lc.subarray(i, i + n), 0); data.set(Rc.subarray(i, i + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / 48000 * 1e6), data }); ae.encode(ad); ad.close(); while (ae.encodeQueueSize > 30) await sleep(4); }
      await ae.flush(); ae.close(); if (err) throw err; sound = true;
    } catch (e) { if (cancelled) throw e; throw new Error('소리 담기 실패: ' + (e.message || e.name)); }
  }
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { err = e; } }); enc.configure(cfg);
  const N = Math.round(TOTAL * FPS), NH = Math.round(HOLD * FPS); HI.start(true); LOW.start(true); LOW.stop(); let t0 = performance.now(), late = 0;
  try {
    for (let i = 0; i < N + NH; i++) {
      if (err) throw err; if (cancelled) throw new Error('취소');
      if (i < N) { // 끝난 뒤(i ≥ N)는 마지막 화면을 그대로 둔 채 같은 그림을 더 담는다(끝 멈춤) — 기다리지 않는다
        const due = t0 + i * 1000 / FPS, wait = due - performance.now(); if (wait > 0) await sleep(wait); else if (wait < -250) { t0 -= wait; late++; } // 많이 밀리면 시계를 늦춰 불이 빨리 감기지 않게
        const t = i / FPS; ensure(t); draw(t);
      }
      const f = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) }); enc.encode(f, { keyFrame: i % (FPS * 2) === 0 }); f.close();
      if (i % 12 === 0) progress(Math.min(1, i / N));
      while (enc.encodeQueueSize > 8) await sleep(8);
    }
    await enc.flush(); if (err) throw err; muxer.finalize();
  } finally { try { if (enc.state !== 'closed') enc.close(); } catch (e) {} }
  if (late) log('밀린 적: ' + late + '번(기기가 실제 시간보다 느렸음)');
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4', sound, soundCodec: sound ? acfg.codec : null };
}
// ── 담기 ②: 화면 녹화(MediaRecorder)
async function viaRecorder(audio) {
  if (!('MediaRecorder' in window) || !cv.captureStream) throw new Error('이 기기에 MediaRecorder 또는 captureStream이 없음');
  const type = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('녹화할 수 있는 형식이 없음'); log('화면 녹화 형식: ' + type);
  const stream = cv.captureStream(FPS); let ac = null, src = null, sound = false;
  if (audio) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); const dest = ac.createMediaStreamDestination(); src = ac.createBufferSource(); src.buffer = audio.buf; src.connect(dest); stream.addTrack(dest.stream.getAudioTracks()[0]); sound = true; } catch (e) { log('녹화에 소리 섞기 실패: ' + (e.message || e.name)); } }
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 128000 }), parts = [];
  rec.ondataavailable = e => { if (e.data.size) parts.push(e.data); };
  const done = new Promise((res, rej) => { rec.onstop = res; rec.onerror = e => rej(e.error || new Error('녹화 오류')); });
  HI.start(true); LOW.start(true); LOW.stop(); rec.start(1000); if (src) src.start(); const t0 = performance.now();
  const [holdC, holdG] = mk(W, H); let held = false;
  try { while (true) { const t = (performance.now() - t0) / 1000; if (t >= TOTAL + HOLD || cancelled) break;
      if (t < TOTAL) { ensure(t); draw(t); } else { if (!held) { holdG.drawImage(cv, 0, 0); held = true; HI.stop(); LOW.stop(); } g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.drawImage(holdC, 0, 0); } // 끝 멈춤: 마지막 화면을 그대로 다시 그려 녹화가 이어지게
      progress(Math.min(1, t / TOTAL)); await new Promise(r => requestAnimationFrame(r)); } }
  finally { rec.stop(); await done.catch(() => {}); if (ac) ac.close(); }
  if (cancelled) throw new Error('취소');
  return { blob: new Blob(parts, { type: type.split(';')[0] }), ext: type.includes('mp4') ? 'mp4' : 'webm', sound, soundCodec: sound ? '녹화' : null };
}
let makeT0 = 0;
function progress(u) { const pct = Math.round(u * 100); $('bar').value = pct; const el = (performance.now() - makeT0) / 1000, left = u > 0.03 ? Math.max(0, el / u - el) : TOTAL; say('만드는 중… ' + pct + '% · 남은 시간 약 ' + (left >= 60 ? Math.floor(left / 60) + '분 ' : '') + Math.round(left % 60) + '초'); }

async function make() {
  if (busy) return; busy = true; cancelled = false; wentHidden = false; makeT0 = performance.now();
  $('make').hidden = true; $('cancel').hidden = false; $('bar').hidden = false; $('bar').value = 0; $('keep').hidden = false; $('result').hidden = true; $('makebox').classList.add('busy');
  showCards(false); $('out').pause(); setCap('영상을 만들고 있습니다'); $('stage').scrollIntoView({ block: 'start', behavior: 'smooth' });
  let wl = null; try { wl = await navigator.wakeLock?.request?.('screen'); } catch (e) {} log('— 만들기 시작 · 화면 켜 두기: ' + (wl ? '됨' : '안 됨(그대로 진행)'));
  say('소리를 준비하는 중…'); let audio = null; try { audio = await buildAudio(); } catch (e) { log('소리 준비 실패: ' + (e.message || e.name)); }
  log('소리 재료: ' + (audio ? ((audio.music ? '음악 ' : '') + (audio.fire ? '장작' : '')) : '없음'));
  let res = null;
  try { res = await viaWebCodecs(audio); log('길 ①(WebCodecs): 됨'); }
  catch (e) {
    if (!cancelled) { log('길 ①(WebCodecs): 안 됨 — ' + (e.message || e.name));
      if (/소리 담기 실패/.test(e.message || '')) { try { res = await viaWebCodecs(null); log('길 ①(소리 없이): 됨'); } catch (e1) { if (!cancelled) log('길 ①(소리 없이): 안 됨 — ' + (e1.message || e1.name)); } }
      if (!res && !cancelled) { try { makeT0 = performance.now(); res = await viaRecorder(audio); log('길 ②(화면 녹화): 됨'); } catch (e2) { if (!cancelled) log('길 ②(화면 녹화): 안 됨 — ' + (e2.message || e2.name)); } } }
  }
  try { await wl?.release?.(); } catch (e) {}
  HI.stop(); LOW.stop(); busy = false; dirty = true;
  $('cancel').hidden = true; $('bar').hidden = true; $('keep').hidden = true; $('makebox').classList.remove('busy');
  if (cancelled) { $('make').hidden = false; showCards(true); select(sel); say('만들기를 그만두었습니다.'); log('취소함'); return; }
  if (!res) { $('make').hidden = false; showCards(true); select(sel); say('이 폰에서는 영상을 만들지 못했습니다. 아래 「만들기 기록」을 보내 주세요.', 'bad'); return; }
  outBlob = res.blob; outExt = res.ext; const secs = (performance.now() - makeT0) / 1000;
  log('결과: ' + outExt + ' · ' + (outBlob.size / 1048576).toFixed(2) + 'MB · 걸린 시간 ' + secs.toFixed(1) + '초 · 소리 ' + (res.sound ? res.soundCodec : '없음') + (wentHidden ? ' · 만드는 동안 화면이 가려진 적 있음' : ''));
  window.__last = { secs, bytes: outBlob.size, ext: outExt, sound: res.sound, soundCodec: res.soundCodec, music: !!(audio && audio.music), wentHidden };
  say(''); $('stage').hidden = true; await showResult(res);
}
// 만드는 동안과 결과 화면에서는 카드를 감춘다(지금 할 일 하나만 보이게)
function showCards(on) { $('cards').hidden = !on; $('cardsTitle').hidden = !on; $('pick').hidden = !on; $('tagsAll').hidden = !on || !TAGS; $('stage').hidden = false; }

// ── 결과: 그 자리에서 크게, 저절로 재생. 큰 단추는 하나(보내기가 되면 보내기, 아니면 저장).
async function showResult(res) {
  if (outURL) URL.revokeObjectURL(outURL); outURL = URL.createObjectURL(outBlob);
  const v = $('out'); v.src = outURL; $('result').hidden = false; $('next').hidden = true; $('sound').hidden = true; $('holdhint').hidden = true;
  $('outcap').textContent = (res.sound ? '' : '이 폰에서는 소리를 담지 못해 소리 없는 영상입니다. ') + (wentHidden ? '만드는 동안 화면이 가려져 불 움직임이 끊겼을 수 있습니다. ' : '');
  v.onloadedmetadata = () => log('만든 영상 열림: ' + v.videoWidth + '×' + v.videoHeight + ' · ' + v.duration.toFixed(1) + '초'); v.onerror = () => log('만든 영상을 이 기기가 틀지 못함');
  v.loop = false; v.onended = () => log('결과 영상 끝남(마지막 화면에 머묾, 되감지 않음)'); // 끝나면 마지막 화면에 머문다 — 되돌려 틀지 않는다
  const file = (() => { try { return new File([outBlob], OUT_NAME + '.' + outExt, { type: outBlob.type || 'video/mp4' }); } catch (e) { return null; } })();
  let canShare = false; try { canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) {}
  let dl = null; try { dl = await window.claude?.use?.('downloads'); } catch (e) {}
  const canSave = !!dl || !window.claude; // claude 자리인데 downloads 가 없으면 저장 단추 없음(길게 눌러 저장)
  log('보내기(공유 창): ' + (canShare ? '됨' : '안 됨') + ' · 저장: ' + (dl ? 'downloads' : (canSave ? '내려받기 링크' : '없음')));
  const bs = $('share'), bv = $('save'); bs.hidden = !canShare; bv.hidden = !canSave; bv.classList.toggle('second', canShare); $('holdhint').hidden = canShare || canSave;
  bs.onclick = async () => { try { await navigator.share({ files: [file] }); log('보내기: 공유 창 닫힘(보냄)'); next('보냈습니다.'); } catch (e) { log('보내기: ' + (e.name || e.message)); if (e.name !== 'AbortError') { next('보내기가 되지 않았습니다. 아래 「이 폰에 저장」을 눌러 주세요.', true); bv.classList.remove('second'); } } };
  bv.onclick = async () => {
    const name = OUT_NAME + '.' + outExt;
    if (dl) { try { await dl.save({ filename: name, data: outBlob }); log('저장: 됨'); next('저장했습니다. 카톡에서 보낼 사람의 채팅방을 열고, 글 쓰는 칸 왼쪽의 「+」를 누르세요. 맨 위 그림 줄에 방금 만든 영상이 보입니다. 그 영상을 누르고 보내면 됩니다.'); } catch (e) { log('저장: 안 됨 — ' + (e.code || e.message)); if (e.code === 'declined') next('저장을 취소했습니다. 다시 누르면 저장됩니다.', true); else { next('저장이 되지 않았습니다. 위 영상을 길게 눌러 저장해 주세요.', true); } } }
    else { const a = document.createElement('a'); a.href = outURL; a.download = name; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove(); log('저장: 내려받기 링크 누름'); next('저장했습니다. 카톡에서 보낼 사람의 채팅방을 열고, 글 쓰는 칸 왼쪽의 「+」를 누르세요. 맨 위 그림 줄에 방금 만든 영상이 보입니다. 그 영상을 누르고 보내면 됩니다.'); }
  };
  // 저절로 재생: 소리 켠 채로 먼저, 막히면 소리 끄고 재생 + 「소리 켜기」
  v.muted = false; let how = '소리 켜고 재생';
  try { await v.play(); } catch (e) { v.muted = true; how = '소리 끄고 재생'; try { await v.play(); if (res.sound) $('sound').hidden = false; } catch (e2) { how = '저절로 재생 안 됨(' + e2.name + ')'; } }
  log('결과 재생: ' + how); window.__last && (window.__last.autoplay = how);
  $('sound').onclick = () => { v.muted = false; v.play().catch(() => {}); $('sound').hidden = true; };
  $('result').scrollIntoView({ block: 'start', behavior: 'smooth' }); try { $('resTitle').focus({ preventScroll: true }); } catch (e) {}
}
function next(s, bad) { const n = $('next'); n.textContent = s; n.style.color = bad ? 'var(--warn)' : ''; n.hidden = false; }

// ── 컷 카드
const KIND = { big: '큰 글씨 (호박빛)', body: '본문', small: '작은 글씨' };
const fmtT = t => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return (m ? m + '분 ' : '') + s + '초'; };
function prevTime(cut) { let t = cut.first; for (const it of cut.items) if (it.t.trim()) t = Math.max(t, it.at); if (cut.bubble) t = Math.max(t, cut.bubble.at + 0.6); return Math.min(t + ST.fadeIn + 0.4, cut.out - ST.fadeOut - 0.05, FULL - 0.1); }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function invalidate(cut) { if (cut._L) for (const ln of cut._L.L) ln.c = null; cut._L = null; }
function select(id) { sel = id; dirty = true; for (const c of CUTS) c.card.classList.toggle('sel', c.id === id); setCap('컷 ' + id + ' 장면 — 아래 카드를 누르면 그 컷이 보입니다'); }
function setCap(s) { $('cap').textContent = s; }
function addLineRow(cut, it) {
  const lab = el('label', 'ln ' + it.k); lab.appendChild(el('span', 'kind', KIND[it.k] + (it.orig ? '' : ' · 더한 줄')));
  const inp = el('input'); inp.type = 'text'; inp.value = it.t; inp.maxLength = 40; inp.autocomplete = 'off'; inp.setAttribute('enterkeyhint', 'done'); if (cut.lock) { inp.readOnly = true; inp.setAttribute('aria-readonly', 'true'); }
  const note = el('span', 'note'); note.setAttribute('role', 'status'); lab.appendChild(inp); lab.appendChild(note); it.inp = inp; it.note = note;
  if (cut.id === 1 && it.k === 'small' && it.orig && !cut.lock) lab.appendChild(el('span', 'hint', '이름을 넣어 보세요. 예: 사랑하는 ○○에게'));
  inp.addEventListener('focus', () => select(cut.id));
  inp.addEventListener('input', () => { it.t = inp.value; invalidate(cut); check(cut); select(cut.id); saveDraft(); });
  cut.linesBox.appendChild(lab);
}
function check(cut) { // 글이 길어지면 그 칸에서 바로 알린다(막지는 않음)
  const { L } = layout(cut); for (const it of cut.items) it.note.textContent = '';
  for (const ln of L) if (ln.sc < 0.995) ln.it.note.textContent = '글이 길어 글씨가 ' + Math.round(ln.sc * 100) + '% 크기로 줄어듭니다.';
  const main = L.filter(ln => ln.k !== 'small').length; let msg = '';
  if (!L.length) msg = '이 컷에는 글자가 나오지 않습니다.'; else if (!cut.lock && main > Math.max(4, cut.main0 || 0)) msg = // 말씀 컷처럼 처음부터 넉 줄이 넘는 컷은 처음 줄 수를 넘을 때만 알린다 '넉 줄을 넘었습니다. 화면이 빽빽해 보일 수 있어요.';
  cut.cnote.textContent = msg; cut.cnote.hidden = !msg;
  if (cut.bubble && cut.bnote) { const F = bubbleFit(cut.bubble); cut.bnote.textContent = F.k < 0.995 ? '글이 길어 말 상자가 ' + Math.round(F.k * 100) + '% 크기로 줄어듭니다.' : ''; }
  if (cut.resetBtn) cut.resetBtn.disabled = !cutChanged(cut);
  if (cut.addBtn) cut.addBtn.hidden = cut.items.filter(it => !it.orig).length >= 2;
}
const tagChanged = cut => !!(cut.tag && TAGS && TAGS.people[cut.tag] && (TAGS.people[cut.tag].label !== TAGS.people[cut.tag].label0 || TAGS.people[cut.tag].hide));
const cutChanged = cut => cut.items.some(it => !it.orig || it.t !== it.t0) || !!(cut.bubble && cut.bubble.t !== cut.bubble.t0) || tagChanged(cut);
// 이름표 칸: 같은 사람이 여러 컷에 나오면 한 칸을 고칠 때 다른 컷의 칸도 같이 바뀐다. 길면 통째로 줄여 그리고 그 칸에서 알린다.
function tagBtns(p) { for (const r of (p.rows || [])) if (r.btn) { r.btn.textContent = p.hide ? '감춤 — 눌러서 보이기' : '보임 — 눌러서 감추기'; r.btn.setAttribute('aria-pressed', p.hide ? 'true' : 'false'); r.inp.style.opacity = p.hide ? '0.55' : ''; }
  const all = $('tagsAll'); if (all && TAGS) { const ps = Object.values(TAGS.people), nHid = ps.filter(x => x.hide).length; all.textContent = nHid ? '이름표 모두 보이기 (지금: ' + (nHid === ps.length ? '모두' : nHid + '개') + ' 감춤)' : '이름표 모두 감추기 (지금: 모두 보임)'; all.dataset.next = nHid ? 'show' : 'hide'; } } // 하나라도 감춰져 있으면 「모두 보이기」, 다 보이면 「모두 감추기」
function setTagHide(p, hide) { p.hide = !!hide; tagCheck(p); for (const r of p.rows) check(r.cut); dirty = true; }
function tagCheck(p) { tagBtns(p); const F = tagFit(p), msg = p.hide ? '이 이름표는 영상에 나오지 않습니다.' : !F.label ? '이름표가 나오지 않습니다.' : (F.k < 0.995 ? '이름표가 길어 ' + Math.round(F.k * 100) + '% 크기로 줄어듭니다.' : ''); for (const r of p.rows) { if (r.inp.value !== p.label) r.inp.value = p.label; r.note.textContent = msg; } }
function addTagRow(cut) {
  const p = TAGS.people[cut.tag]; if (!p) return; p.rows = p.rows || [];
  const box = el('div', 'ln tag'), lab = el('label', 'tagl'); lab.appendChild(el('span', 'kind', '이름표' + (p.n ? ' (응원 ' + p.n + ')' : '')));
  const inp = el('input'); inp.type = 'text'; inp.value = p.label; inp.maxLength = 12; inp.autocomplete = 'off'; inp.setAttribute('enterkeyhint', 'done'); lab.appendChild(inp); box.appendChild(lab);
  const btn = el('button', 'ghost small tagtoggle'); btn.type = 'button'; btn.setAttribute('aria-label', '이름표 보이기/감추기'); box.appendChild(btn); // 같은 사람의 이름표는 함께 감춰진다
  const note = el('span', 'note'); note.setAttribute('role', 'status'); box.appendChild(note); p.rows.push({ inp, note, cut, btn });
  inp.addEventListener('focus', () => select(cut.id));
  inp.addEventListener('input', () => { p.label = inp.value; tagCheck(p); for (const r of p.rows) check(r.cut); select(cut.id); saveDraft(); });
  inp.addEventListener('change', () => queueThumbs(p.rows.map(r => r.cut.id)));
  btn.addEventListener('click', () => { setTagHide(p, !p.hide); select(cut.id); saveDraft(); queueThumbs(p.rows.map(r => r.cut.id)); });
  cut.linesBox.appendChild(box);
}
function addBubbleRow(cut) {
  const B = cut.bubble, lab = el('label', 'ln bubble'); lab.appendChild(el('span', 'kind', '흔들리는 말 상자'));
  const inp = el('input'); inp.type = 'text'; inp.value = B.t; inp.maxLength = 16; inp.autocomplete = 'off'; inp.setAttribute('enterkeyhint', 'done');
  const note = el('span', 'note'); note.setAttribute('role', 'status'); lab.appendChild(inp); lab.appendChild(note); cut.bnote = note; cut.binp = inp;
  inp.addEventListener('focus', () => select(cut.id));
  inp.addEventListener('input', () => { B.t = inp.value; check(cut); select(cut.id); saveDraft(); });
  cut.linesBox.appendChild(lab);
}
function fillRows(cut) { cut.linesBox.textContent = ''; if (cut.tag && TAGS) { const p = TAGS.people[cut.tag]; if (p && p.rows) p.rows = p.rows.filter(r => r.cut !== cut); addTagRow(cut); } for (const it of cut.items) addLineRow(cut, it); if (cut.bubble) addBubbleRow(cut); }
function buildCards() {
  const box = $('cards'); box.textContent = ''; if (TAGS) for (const k in TAGS.people) TAGS.people[k].rows = [];
  for (const cut of CUTS) { cut.thumbLive = false;
    const card = el('article', 'card' + (cut.lock ? ' locked' : '')); cut.card = card; card.setAttribute('aria-label', '컷 ' + cut.id);
    const head = el('header'); head.appendChild(el('span', 'no', '컷 ' + cut.id)); head.appendChild(el('span', 'when', fmtT(cut.start) + '부터'));
    if (!cut.lock) { const rb = el('button', 'ghost small', '원래대로'); rb.type = 'button'; rb.disabled = true; cut.resetBtn = rb; head.appendChild(rb);
      rb.addEventListener('click', () => { cut.items = cut.items.filter(it => it.orig); for (const it of cut.items) it.t = it.t0; if (cut.bubble) cut.bubble.t = cut.bubble.t0; fillRows(cut); if (tagChanged(cut)) { const p = TAGS.people[cut.tag]; p.label = p.label0; p.hide = false; tagCheck(p); for (const r of p.rows) if (r.cut !== cut) check(r.cut); queueThumbs(p.rows.map(r => r.cut.id)); } invalidate(cut); check(cut); select(cut.id); saveDraft(); }); }
    card.appendChild(head);
    const row = el('div', 'row'); const th = el('canvas', 'thumb'); th.width = 144; th.height = 256; th.setAttribute('aria-hidden', 'true'); cut.thumb = th; row.appendChild(th);
    const im = new Image(); im.onload = () => { if (!cut.thumbLive) th.getContext('2d').drawImage(im, 0, 0, 144, 256); }; im.src = 'thumbs/' + VER + '-c' + String(cut.id).padStart(2, '0') + '.jpg';
    th.addEventListener('click', () => { select(cut.id); $('stage').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
    const lines = el('div', 'lines'); cut.linesBox = lines; row.appendChild(lines); card.appendChild(row);
    fillRows(cut);
    cut.cnote = el('div', 'cnote'); cut.cnote.setAttribute('role', 'status'); cut.cnote.hidden = true; card.appendChild(cut.cnote);
    if (cut.verse && !cut.lock) card.appendChild(el('div', 'locknote', '다른 말씀으로 바꿀 수 있습니다. 장절도 함께 고쳐 주세요.'));
    if (cut.lock) card.appendChild(el('div', 'locknote', '성경 본문이라 고치지 않습니다.'));
    else { const ab = el('button', 'ghost small', '줄 더하기'); ab.type = 'button'; cut.addBtn = ab; card.appendChild(ab);
      ab.addEventListener('click', () => { if (cut.items.filter(x => !x.orig).length >= 2) return; const it = { k: 'body', t: '', t0: '', orig: false, at: +(cut.first + cut.items.length * cut.step).toFixed(3), gap: 0 }; cut.items.push(it); addLineRow(cut, it); check(cut); it.inp.focus(); }); }
    box.appendChild(card); check(cut);
  }
  if (TAGS) for (const k in TAGS.people) tagCheck(TAGS.people[k]);
}
// ── 초안(이 폰에만)
function saveDraft() {
  try { const d = {}, tags = {};
    for (const c of CUTS) { const lineCh = !c.lock && c.items.some(it => !it.orig || it.t !== it.t0), bCh = !!(c.bubble && c.bubble.t !== c.bubble.t0); if (!lineCh && !bCh) continue; d[c.id] = {}; if (lineCh) { d[c.id].t = c.items.filter(it => it.orig).map(it => it.t); d[c.id].x = c.items.filter(it => !it.orig).map(it => it.t); } if (bCh) d[c.id].b = c.bubble.t; }
    if (TAGS) for (const k in TAGS.people) if (TAGS.people[k].label !== TAGS.people[k].label0) tags[k] = TAGS.people[k].label;
    const hide = {}; if (TAGS) for (const k in TAGS.people) if (TAGS.people[k].hide) hide[k] = true;
    localStorage.setItem(DRAFT_KEY + VER, JSON.stringify({ v: 2, cuts: d, tags, hide })); } catch (e) {}
}
function loadDraft() {
  try { let j = JSON.parse(localStorage.getItem(DRAFT_KEY + VER) || 'null'); if (!j && VER === 'mom1') { j = JSON.parse(localStorage.getItem('cheer-video-draft-v1') || 'null'); } if (!j || !j.cuts) return;
    for (const c of CUTS) { const d = j.cuts[c.id]; if (!d) continue;
      if (!c.lock) { (d.t || []).forEach((t, i) => { if (c.items[i] && typeof t === 'string') c.items[i].t = t.slice(0, 40); }); (d.x || []).slice(0, 2).forEach(t => { if (typeof t === 'string') c.items.push({ k: 'body', t: t.slice(0, 40), t0: '', orig: false, at: +(c.first + c.items.length * c.step).toFixed(3), gap: 0 }); }); }
      if (c.bubble && typeof d.b === 'string') c.bubble.t = d.b.slice(0, 16); }
    if (TAGS && j.hide) for (const k in j.hide) if (TAGS.people[k] && j.hide[k] === true) TAGS.people[k].hide = true;
    if (TAGS && j.tags) for (const k in j.tags) if (TAGS.people[k] && typeof j.tags[k] === 'string') TAGS.people[k].label = j.tags[k].slice(0, 12);
  } catch (e) {}
}

// ── 미리보기: 지금 고른 컷의 장면. 글자를 고치면 바로 바뀐다. 화면에 보일 때만 불이 일렁인다.
let stageVisible = true, lastDraw = 0; const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
// 작은 그림 다시 그리기 줄: 이름표처럼 여러 컷에 걸친 고침은 그 컷들의 작은 그림을 차례로 새로 그린다(미리보기가 잠깐 그 컷들을 지나간다)
let thumbQ = [], thumbTry = 0;
function queueThumbs(ids) { for (const id of ids) if (id !== sel && !thumbQ.includes(id)) thumbQ.push(id); }
function tick(now) {
  requestAnimationFrame(tick); if (busy || !P) return; const cut = CUTS.find(c => c.id === sel); if (!cut) return;
  if (!dirty && thumbQ.length) { const c = CUTS.find(x => x.id === thumbQ[0]); if (!c) { thumbQ.shift(); return; } const t = prevTime(c); ensure(t); const n = need(t), ok = (!n.hi || HI.v[HI.cur].readyState >= 2) && (!n.low || LOW.v[LOW.cur].readyState >= 2);
    if (ok || ++thumbTry > 40) { draw(t); c.thumbLive = true; const x = c.thumb.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cv, 0, 0, 144, 256); thumbQ.shift(); thumbTry = 0; if (!thumbQ.length) dirty = true; } return; }
  const live = stageVisible && !document.hidden && !calm; if (!dirty && (!live || now - lastDraw < 80)) { if (!live) { HI.stop(); LOW.stop(); } return; }
  const t = prevTime(cut); ensure(t); draw(t); lastDraw = now;
  if (dirty) { const n = need(t), ok = (!n.hi || HI.v[HI.cur].readyState >= 2) && (!n.low || LOW.v[LOW.cur].readyState >= 2); if (ok) { dirty = false; if (cut.thumbLive || cutChanged(cut)) { cut.thumbLive = true; const x = cut.thumb.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cv, 0, 0, 144, 256); } } }
}

// ── 판 고르기: 고르면 카드·미리보기·작은 그림이 그 판으로 바뀐다. 고친 글은 판마다 따로 남는다.
async function loadVersion(id) {
  if (busy) return; const V = VERS.find(v => v.id === id) || VERS[0]; const first = !LISTS[V.id];
  if (first) { const r = await fetch(V.file); if (!r.ok) throw new Error(V.file + ' 없음'); LISTS[V.id] = await r.json(); }
  VER = V.id; LIST = LISTS[VER]; P = LIST['그림']; ST = LIST['글자 모양']; CUTS = LIST.cuts; FPS = LIST.fps; FULL = LIST.total; TOTAL = FULL; HOLD = LIST.hold || 0; TAGS = LIST['이름표'] || null; TAGSEGS = null; lastTextCut = null;
  { const q = +new URLSearchParams(location.search).get('sec'); if (q > 0) TOTAL = Math.min(TOTAL, q); } // 시험용: ?sec=8 이면 앞 8초만 만든다(끝 멈춤은 그대로 붙음)
  if (first) { for (const c of CUTS) { c.items = parseItems(c); c.main0 = c.items.filter(it => it.k !== 'small').length; if (c.bubble) c.bubble.t0 = c.bubble.t; } if (TAGS) for (const k in TAGS.people) TAGS.people[k].label0 = TAGS.people[k].label; loadDraft(); }
  if (!HI) { HI = new Loop(P.fire, P.loopFrom || 0); LOW = new Loop(P.fireLow, P.lowFrom || 0); await Promise.all([HI.load(), LOW.load()]); log('불 영상: ' + HI.v[0].videoWidth + '×' + HI.v[0].videoHeight + ' ' + (HI.v[0].duration || 0).toFixed(2) + '초 · 낮은 불 ' + (LOW.v[0].duration || 0).toFixed(2) + '초'); }
  for (const b of document.querySelectorAll('#pick button')) { const on = b.dataset.ver === VER; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('on', on); }
  $('tagsAll').hidden = !TAGS;
  $('cardsTitle').textContent = V.name + ' — 컷 ' + CUTS.length + '장'; $('keep').textContent = '화면을 켜 두세요. ' + (FULL > 118 ? '2분 조금 넘게' : '2분쯤') + ' 걸립니다. 다른 앱으로 가면 멈출 수 있습니다.';
  buildCards(); select(1); thumbQ = []; queueThumbs(CUTS.filter(c => cutChanged(c)).map(c => c.id)); try { localStorage.setItem(VER_KEY, VER); } catch (e) {}
  log('판: ' + V.name + ' · ' + FULL + '초 + 끝 멈춤 ' + HOLD + '초 · 컷 ' + CUTS.length);
}
async function init() {
  try {
    try { await document.fonts.load('80px "Bujang"'); await document.fonts.load('80px "Bujang"', '가'); } catch (e) {}
    log('글꼴: ' + (document.fonts.check('80px "Bujang"') ? '불러옴' : '못 불러옴(기본 글꼴로 그림)'));
    log('기기: ' + navigator.userAgent);
    log('VideoEncoder: ' + ('VideoEncoder' in window) + ' · AudioEncoder: ' + ('AudioEncoder' in window) + ' · MediaRecorder: ' + ('MediaRecorder' in window) + ' · 묶는 도구: ' + (typeof Mp4Muxer !== 'undefined') + ' · 자간: ' + HASLS);
    if (!('VideoEncoder' in window) || new URLSearchParams(location.search).get('nowc')) $('nowc').hidden = false; // 카톡 안 화면처럼 영상 담는 도구가 없는 곳: 맨 위에 다른 브라우저로 열라는 안내(?nowc=1 은 시험용)
    let want = new URLSearchParams(location.search).get('ver'); if (!want) { try { want = localStorage.getItem(VER_KEY); } catch (e) {} }
    await loadVersion(want || 'mom1');
    for (const b of document.querySelectorAll('#pick button')) b.addEventListener('click', () => { if (busy || b.dataset.ver === VER) return; loadVersion(b.dataset.ver).catch(e => { setCap('그 판을 불러오지 못했습니다.'); log('판 불러오기 실패: ' + (e.message || e.name)); }); });
    $('tagsAll').addEventListener('click', () => { if (busy || !TAGS) return; const hide = $('tagsAll').dataset.next !== 'show'; for (const k in TAGS.people) setTagHide(TAGS.people[k], hide); saveDraft(); select(sel); queueThumbs(CUTS.filter(c => c.tag).map(c => c.id)); });
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { stageVisible = es[0].isIntersecting; }).observe($('stage'));
    document.addEventListener('visibilitychange', () => { if (document.hidden && busy) wentHidden = true; });
    $('make').disabled = false; $('make').addEventListener('click', make);
    $('cancel').addEventListener('click', () => { cancelled = true; say('그만두는 중…'); });
    $('again').addEventListener('click', () => { $('out').pause(); $('result').hidden = true; $('make').hidden = false; say(''); showCards(true); select(sel); $('cardsTitle').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
    requestAnimationFrame(tick);
  } catch (e) { setCap('준비하지 못했습니다. 새로 고쳐 주세요.'); log('준비 실패: ' + (e.message || e.name)); }
}
// 시험용 손잡이(화면에는 영향 없음)
window.__app = { draw, ensure, layout, prevTime, need, loadVersion, get ver() { return VER; }, get cuts() { return CUTS; }, get P() { return P; }, get tags() { return TAGS; }, get blob() { return outBlob; }, loops: () => [HI, LOW], select, setBusy: b => { busy = b; } };
init();
})();
