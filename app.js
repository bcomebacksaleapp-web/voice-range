(() => {
'use strict';
const P = window.Pitch;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LO = 36, HI = 96;                 // C2 .. C7 (ช่วงที่แสดงบนกราฟ)
const GATE = 0.012;                      // RMS ต่ำกว่านี้ถือว่าเงียบ
const COLORS = ['#ff4d8d', '#4cc9f0', '#ffd166', '#6ee7a8', '#b388ff', '#ff9f5a'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};
const uid = () => Math.random().toString(36).slice(2, 9);
const noteLabel = (m) => P.noteName(m) + ' · ' + P.solfege(m);

function fillSelect(sel, lo, hi, val) {
  sel.innerHTML = '';
  for (let m = lo; m <= hi; m++) {
    const o = document.createElement('option');
    o.value = m; o.textContent = noteLabel(m);
    sel.appendChild(o);
  }
  sel.value = val;
}

function fit(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, W: w, H: h };
}

/* =====================================================================
   Engine: ไมค์จริง หรือเสียงสังเคราะห์ -> เฟรม {t, rms, midi, freq, clarity}
   ===================================================================== */
const Engine = {
  ctx: null, stream: null, analyser: null, timer: null, buf: null, osc: null,
  mode: null, onFrame: null, mutedUntil: 0, t0: 0, demoFn: null,

  async start(mode, demoFn) {
    this.stop();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const an = ctx.createAnalyser();
    an.fftSize = 4096; an.smoothingTimeConstant = 0;
    if (mode === 'mic') {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        ctx.close(); throw new Error('NOMIC');
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      ctx.createMediaStreamSource(this.stream).connect(an);
    } else {
      // เสียงสังเคราะห์คล้ายเสียงร้อง: คลื่นฟันเลื่อย + lowpass (ไม่ต่อออกลำโพง)
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
      const gn = ctx.createGain(); gn.gain.value = 0.3;
      o.connect(lp); lp.connect(gn); gn.connect(an);
      o.start(); this.osc = o; this.demoFn = demoFn;
    }
    await ctx.resume();
    this.ctx = ctx; this.analyser = an; this.buf = new Float32Array(an.fftSize);
    this.mode = mode; this.t0 = performance.now();
    this.timer = setInterval(() => this.tick(), 30);
    setChip(mode);
  },

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.osc) { try { this.osc.stop(); } catch (e) { /* ignore */ } this.osc = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
    this.mode = null; this.analyser = null;
    setChip(null);
  },

  tick() {
    if (!this.analyser) return;
    const now = performance.now();
    if (this.osc && this.demoFn) {
      const m = this.demoFn((now - this.t0) / 1000);
      this.osc.frequency.setValueAtTime(P.midiToFreq(m), this.ctx.currentTime);
    }
    this.analyser.getFloatTimeDomainData(this.buf);
    const fr = { t: now, rms: P.rms(this.buf), freq: null, midi: null, clarity: 0, muted: now < this.mutedUntil };
    if (!fr.muted && fr.rms >= GATE) {
      const r = P.yin(this.buf, this.ctx.sampleRate);
      if (r && r.freq >= 60 && r.freq <= 1400 && r.clarity >= 0.85) {
        fr.freq = r.freq; fr.midi = P.freqToMidi(r.freq); fr.clarity = r.clarity;
      }
    }
    if (this.onFrame) this.onFrame(fr);
  },
};

function setChip(mode) {
  const c = $('#chip');
  c.className = 'chip' + (mode === 'mic' ? ' live' : mode === 'demo' ? ' demo' : '');
  c.textContent = mode === 'mic' ? '● กำลังฟังไมค์' : mode === 'demo' ? 'โหมดทดลอง (เสียงสังเคราะห์)' : 'ไมค์ปิดอยู่';
}

function micError(e) {
  if (e && e.message === 'NOMIC') return 'เบราว์เซอร์นี้ใช้ไมค์ไม่ได้ — ต้องเปิดผ่าน https หรือ localhost';
  if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) return 'ไม่ได้รับอนุญาตใช้ไมค์ — กดอนุญาตที่แถบที่อยู่ของเบราว์เซอร์ แล้วลองใหม่';
  if (e && e.name === 'NotFoundError') return 'ไม่พบไมโครโฟนในเครื่องนี้';
  return 'เปิดไมค์ไม่สำเร็จ: ' + ((e && e.message) || e);
}

const setLevel = (el, rms) => {
  const db = rms > 0 ? 20 * Math.log10(rms) : -90;
  el.style.width = Math.max(0, Math.min(1, (db + 60) / 50)) * 100 + '%';
};

/* =====================================================================
   แท็บ
   ===================================================================== */
let currentTab = 'measure';
function showTab(name) {
  Engine.stop();
  Measure.onStop(); Match.onStop();
  currentTab = name;
  $$('.tab').forEach((b) => { b.classList.toggle('on', b.dataset.tab === name); b.setAttribute('aria-selected', b.dataset.tab === name); });
  $$('.pane').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
  if (name === 'measure') Measure.render();
  if (name === 'compare') Compare.render();
  if (name === 'match') Match.render();
  window.scrollTo(0, 0);
}
$$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* =====================================================================
   ① วัดช่วงเสียง
   ===================================================================== */
const DEMO_SEQ = [[57, 1.0], [53, 1.0], [50, 1.4], [55, 0.5], [60, 0.5], [69, 0.8], [76, 1.4], [72, 0.6], [62, 0.6]];
function demoSong(t) {
  const total = DEMO_SEQ.reduce((a, s) => a + s[1], 0);
  let lt = t % total, i = 0;
  while (lt >= DEMO_SEQ[i][1]) { lt -= DEMO_SEQ[i][1]; i++; }
  const prev = DEMO_SEQ[(i + DEMO_SEQ.length - 1) % DEMO_SEQ.length][0];
  const cur = DEMO_SEQ[i][0];
  const m = lt < 0.2 ? prev + (cur - prev) * (lt / 0.2) : cur;
  return m + 0.15 * Math.sin(t * 2 * Math.PI * 5.5);
}

const Measure = {
  step: 0, low: null, high: null, demo: false,
  tracker: P.createTracker(), trace: [], recent: [], liveMidi: null, lastVoiced: 0, view: 60,

  TEXT: {
    0: ['พร้อมวัดช่วงเสียง', 'วัดใน 2 ขั้นตอน: ร้องเสียงต่ำสุด แล้วร้องเสียงสูงสุด อยู่ในที่เงียบ ๆ ถือมือถือห่างปากประมาณหนึ่งฝ่ามือ แล้วกด “เริ่มวัด”'],
    1: ['① ร้องเสียงต่ำสุดที่ร้องได้', 'ร้อง “อา” ไล่เสียงลงมาทีละขั้น แล้วค้างเสียงต่ำสุดไว้ราว ½ วินาที (ไม่ต้องฝืนจนแหบ) เมื่อช่องด้านล่างขึ้นโน้ต ให้กด “ต่อไป”'],
    2: ['② ร้องเสียงสูงสุดที่ร้องได้', 'ร้อง “อา” ไล่เสียงขึ้น แล้วค้างเสียงสูงสุดที่ยังไม่แตกพร่าไว้ราว ½ วินาที เสร็จแล้วกด “ดูผล”'],
    3: ['วัดเสร็จแล้ว', 'ดูช่วงเสียงของคุณด้านล่าง ตั้งชื่อแล้วบันทึกไว้เทียบกับคนอื่นหรือกับเพลงได้'],
  },

  init() {
    $('#btnMain').addEventListener('click', () => this.main());
    $('#btnReset').addEventListener('click', () => this.reset());
    $('#btnDemo').addEventListener('click', () => this.begin(true));
    $('#btnSave').addEventListener('click', () => this.save());
    $('#btnToCompare').addEventListener('click', () => showTab('compare'));
    window.addEventListener('resize', () => { if (currentTab === 'measure') this.draw(); });
  },

  reset() {
    Engine.stop();
    this.step = 0; this.low = null; this.high = null; this.demo = false;
    this.trace = []; this.recent = []; this.liveMidi = null; this.tracker.reset();
    $('#msg').textContent = ''; $('#msg').className = 'msg';
    this.render();
  },

  onStop() { /* เรียกตอนสลับแท็บ */
    if (this.step === 1 || this.step === 2) { this.step = 0; this.low = null; this.high = null; this.trace = []; this.liveMidi = null; }
  },

  async begin(demo) {
    this.low = null; this.high = null; this.trace = []; this.recent = []; this.liveMidi = null; this.tracker.reset();
    try {
      Engine.onFrame = (fr) => this.frame(fr);
      await Engine.start(demo ? 'demo' : 'mic', demoSong);
    } catch (e) {
      $('#msg').className = 'msg'; $('#msg').textContent = micError(e);
      return;
    }
    this.demo = demo; this.step = 1;
    $('#msg').textContent = '';
    this.render();
  },

  main() {
    const msg = $('#msg'); msg.className = 'msg';
    if (this.step === 0) return this.begin(false);
    if (this.step === 1) {
      if (this.low == null) return;
      this.step = 2; this.tracker.reset();
      msg.textContent = '';
    } else if (this.step === 2) {
      if (this.high == null) return;
      if (this.high <= this.low) { msg.textContent = 'เสียงสูงสุดต้องสูงกว่าเสียงต่ำสุด — ลองร้องไล่เสียงขึ้นอีกครั้ง'; this.high = null; this.render(); return; }
      Engine.stop(); this.step = 3;
      this.showResult();
    }
    this.render();
  },

  frame(fr) {
    setLevel($('#level'), fr.rms);
    this.trace.push({ t: fr.t, m: fr.midi });
    if (fr.midi != null) {
      this.recent.push(fr.midi); if (this.recent.length > 5) this.recent.shift();
      this.liveMidi = P.median(this.recent); this.lastVoiced = fr.t;
    } else if (fr.t - this.lastVoiced > 250) { this.liveMidi = null; this.recent.length = 0; }

    const stable = this.tracker.push(fr.t, fr.midi);
    if (stable != null) {
      const s = Math.round(stable);
      if (this.step === 1 && (this.low == null || s < this.low)) { this.low = s; this.updateCaught(); }
      if (this.step === 2 && (this.high == null || s > this.high)) { this.high = s; this.updateCaught(); }
    }
    this.updateLive();
    this.draw();
  },

  updateCaught() {
    $('#chipLow').textContent = this.low != null ? noteLabel(this.low) : '–';
    $('#chipHigh').textContent = this.high != null ? noteLabel(this.high) : '–';
    const b = $('#btnMain');
    if (this.step === 1) b.disabled = this.low == null;
    if (this.step === 2) b.disabled = this.high == null;
  },

  updateLive() {
    const m = this.liveMidi;
    if (m == null) {
      $('#gNote').textContent = '–'; $('#gSolf').innerHTML = '&nbsp;'; $('#gMeta').innerHTML = '&nbsp;';
      return;
    }
    const r = Math.round(m), cents = Math.round((m - r) * 100);
    $('#gNote').textContent = P.noteName(r);
    $('#gSolf').textContent = P.solfege(r);
    $('#gMeta').textContent = Math.round(P.midiToFreq(m)) + ' Hz  ' + (cents >= 0 ? '+' : '') + cents + '¢';
  },

  render() {
    const [t, b] = this.TEXT[this.step];
    $('#mTitle').textContent = t; $('#mBody').textContent = b;
    $$('#stepper li').forEach((li) => {
      const s = +li.dataset.s;
      li.className = this.step === s ? 'on' : (this.step > s ? 'done' : '');
    });
    const main = $('#btnMain');
    main.hidden = this.step === 3;
    main.disabled = false;
    main.textContent = this.step === 0 ? 'เริ่มวัด' : this.step === 1 ? 'ต่อไป →' : 'ดูผล';
    $('#btnReset').hidden = this.step === 0;
    $('#btnDemo').hidden = this.step !== 0;
    $('#result').hidden = this.step !== 3;
    $('#liveBox').style.opacity = this.step === 3 ? .75 : 1;
    this.updateCaught(); this.updateLive();
    this.draw();
  },

  showResult() {
    const lo = this.low, hi = this.high, span = hi - lo;
    $('#rRange').textContent = P.noteName(lo) + ' – ' + P.noteName(hi);
    $('#rSpan').textContent = noteLabel(lo) + ' ถึง ' + noteLabel(hi) + ' · กว้าง ' + P.describeSpan(span) + ' (' + span + ' เซมิโทน)';
    const ms = P.matchVoiceTypes(lo, hi);
    $('#rType').textContent = ms[0].th + ' (' + ms[0].en + ')';
    $('#rTypeNote').textContent = ms[0].note + ' · ช่วงมาตรฐาน ' + P.noteName(ms[0].low) + '–' + P.noteName(ms[0].high);
    $('#rBars').innerHTML = ms.map((m, i) =>
      `<div class="vt-row${i === 0 ? ' top' : ''}"><span>${esc(m.th)}</span><div class="tr"><i style="width:${m.pct}%"></i></div><span>${m.pct}%</span></div>`).join('');
    $('#saveName').value = this.demo ? 'ตัวอย่าง (สังเคราะห์)' : 'ฉัน';
    $('#btnToCompare').hidden = true;
    $('#btnSave').disabled = false; $('#btnSave').textContent = 'บันทึก';
  },

  save() {
    const name = $('#saveName').value.trim() || 'ฉัน';
    const list = store.get('voicerange.profiles.v1', []);
    list.push({ id: uid(), name, low: this.low, high: this.high, ts: Date.now() });
    store.set('voicerange.profiles.v1', list);
    $('#btnSave').disabled = true; $('#btnSave').textContent = 'บันทึกแล้ว ✓';
    $('#btnToCompare').hidden = false;
  },

  draw() {
    this.drawGauge();
    this.drawTrace();
  },

  drawGauge() {
    const f = fit($('#gauge')); if (!f) return;
    const { g, W, H } = f;
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, lw = 18, R = Math.min(W, H) / 2 - 42;
    const A0 = 0.75 * Math.PI, SW = 1.5 * Math.PI;
    const ang = (m) => A0 + SW * Math.max(0, Math.min(1, (m - LO) / (HI - LO)));
    const pt = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];

    g.lineCap = 'round';
    g.lineWidth = lw; g.strokeStyle = '#261d36';
    g.beginPath(); g.arc(cx, cy, R, A0, A0 + SW); g.stroke();

    // ขีดบอก C แต่ละอ็อกเทฟ
    g.font = '11px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let m = 36; m <= 96; m += 12) {
      const a = ang(m);
      const [x1, y1] = pt(a, R + lw / 2 + 3), [x2, y2] = pt(a, R + lw / 2 + 9), [tx, ty] = pt(a, R + lw / 2 + 21);
      g.strokeStyle = '#6a5d86'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.fillStyle = '#9a8fb0'; g.fillText('C' + (m / 12 - 1), tx, ty);
    }

    const lo = this.low, hi = this.high;
    if (lo != null && hi != null && hi > lo) {
      const grad = g.createLinearGradient(0, H, W, 0);
      grad.addColorStop(0, '#4cc9f0'); grad.addColorStop(1, '#ff4d8d');
      g.strokeStyle = grad; g.lineWidth = lw;
      g.beginPath(); g.arc(cx, cy, R, ang(lo), ang(hi)); g.stroke();
    }
    const cap = (m, col) => {
      const [x, y] = pt(ang(m), R);
      g.fillStyle = col; g.beginPath(); g.arc(x, y, lw / 2 + 2, 0, 7); g.fill();
    };
    if (lo != null) cap(lo, '#4cc9f0');
    if (hi != null) cap(hi, '#ff4d8d');

    if (this.liveMidi != null) {
      const [x, y] = pt(ang(this.liveMidi), R);
      g.shadowColor = '#fff'; g.shadowBlur = 14;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, lw / 2 - 1, 0, 7); g.fill();
      g.shadowBlur = 0;
    }
  },

  drawTrace() {
    const f = fit($('#trace')); if (!f) return;
    const { g, W, H } = f;
    g.clearRect(0, 0, W, H);
    const now = performance.now(), SPAN = 6000;
    while (this.trace.length && this.trace[0].t < now - SPAN - 500) this.trace.shift();

    const recent = this.trace.filter((p) => p.m != null && p.t > now - 3000).map((p) => p.m);
    if (recent.length) this.view += (P.median(recent) - this.view) * 0.06;
    const half = 13, lo = this.view - half, hi = this.view + half;
    const y = (m) => H - ((m - lo) / (hi - lo)) * H;

    g.font = '11px "Segoe UI", sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
      const p = ((m % 12) + 12) % 12;
      if (![0, 2, 4, 5, 7, 9, 11].includes(p)) continue;
      const yy = y(m);
      g.strokeStyle = p === 0 ? '#4a3d66' : '#2a2138'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(34, yy); g.lineTo(W, yy); g.stroke();
      if ([0, 4, 7].includes(p)) {            // ป้ายเฉพาะ C/E/G กันตัวหนังสือซ้อนกัน
        g.fillStyle = p === 0 ? '#c9bde0' : '#74698a';
        g.fillText(P.noteName(m), 4, yy);
      }
    }
    const dash = (m, col) => {
      if (m == null || m < lo || m > hi) return;
      g.setLineDash([5, 5]); g.strokeStyle = col; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(34, y(m)); g.lineTo(W, y(m)); g.stroke(); g.setLineDash([]);
    };
    dash(this.low, '#4cc9f0'); dash(this.high, '#ff4d8d');

    g.strokeStyle = '#b388ff'; g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round';
    let prev = null; g.beginPath();
    for (const p of this.trace) {
      if (p.m == null) { prev = null; continue; }
      const x = 34 + ((p.t - (now - SPAN)) / SPAN) * (W - 34), yy = y(p.m);
      if (prev && p.t - prev.t < 120) g.lineTo(x, yy); else g.moveTo(x, yy);
      prev = p;
    }
    g.stroke();
    if (prev && now - prev.t < 200) {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(W - 2, y(prev.m), 4, 0, 7); g.fill();
    }
  },
};

/* =====================================================================
   ② เทียบเสียง
   ===================================================================== */
const Compare = {
  shown: null, // Set ของ id ที่ติ๊กแสดง

  profiles() { return store.get('voicerange.profiles.v1', []); },
  songs() { return store.get('voicerange.songs.v1', []); },

  init() {
    fillSelect($('#addLow'), 36, 84, 48); fillSelect($('#addHigh'), 36, 96, 72);
    fillSelect($('#songLow'), 36, 96, 55); fillSelect($('#songHigh'), 36, 96, 67);
    $('#btnAdd').addEventListener('click', () => this.add());
    $('#btnSong').addEventListener('click', () => this.addSong());
    $('#showTypes').addEventListener('change', () => this.renderChart());
    $('#songProfile').addEventListener('change', () => this.renderSongs());
    $('#btnGoMeasure').addEventListener('click', () => showTab('measure'));
  },

  render() {
    const ps = this.profiles();
    if (!this.shown) this.shown = new Set(ps.map((p) => p.id));
    ps.forEach((p) => { if (!this.knownIds || !this.knownIds.has(p.id)) this.shown.add(p.id); });
    this.knownIds = new Set(ps.map((p) => p.id));
    this.renderList(); this.renderChart(); this.renderSongs();
  },

  color(p) { const i = this.profiles().findIndex((x) => x.id === p.id); return COLORS[i % COLORS.length]; },

  renderList() {
    const ps = this.profiles();
    const ul = $('#profList'); ul.innerHTML = '';
    if (!ps.length) { ul.innerHTML = '<li class="rg">ยังไม่มีรายการ</li>'; return; }
    ps.forEach((p) => {
      const li = document.createElement('li');
      const top = P.matchVoiceTypes(p.low, p.high)[0];
      li.innerHTML = `<input type="checkbox" ${this.shown.has(p.id) ? 'checked' : ''} aria-label="แสดงบนกราฟ">
        <span class="dot" style="background:${this.color(p)}"></span>
        <span class="nm">${esc(p.name)}</span>
        <span class="rg">${P.noteName(p.low)}–${P.noteName(p.high)}</span>
        <span class="tag">${esc(top.th)}</span>
        <button class="del" title="ลบ" aria-label="ลบ ${esc(p.name)}">✕</button>`;
      $('input', li).addEventListener('change', (e) => {
        e.target.checked ? this.shown.add(p.id) : this.shown.delete(p.id);
        this.renderChart();
      });
      $('.del', li).addEventListener('click', () => {
        if (!confirm('ลบ “' + p.name + '” ?')) return;
        store.set('voicerange.profiles.v1', this.profiles().filter((x) => x.id !== p.id));
        this.shown.delete(p.id); this.render();
      });
      ul.appendChild(li);
    });
  },

  renderChart() {
    const ps = this.profiles().filter((p) => this.shown.has(p.id));
    const rows = ps.map((p) => ({ label: p.name, low: p.low, high: p.high, color: this.color(p) }));
    if ($('#showTypes').checked) P.VOICE_TYPES.forEach((t) => rows.push({ label: t.th, low: t.low, high: t.high, color: '#4d4166', dim: true }));
    $('#cmpEmpty').hidden = this.profiles().length > 0;

    const LX = 112, RX = 740, RH = 30, TOP = 24, VW = 760;
    const x = (m) => LX + ((m - LO) / (HI - LO)) * (RX - LX);
    const VH = TOP + rows.length * RH + 8;
    let s = `<svg viewBox="0 0 ${VW} ${VH}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Leelawadee UI, sans-serif">`;
    for (let m = 36; m <= 96; m += 12) {
      s += `<line x1="${x(m)}" y1="${TOP - 6}" x2="${x(m)}" y2="${VH - 4}" stroke="#2d2440"/>`;
      s += `<text x="${x(m)}" y="${TOP - 10}" fill="#9a8fb0" font-size="12" text-anchor="middle">C${m / 12 - 1}</text>`;
    }
    rows.forEach((r, i) => {
      const y0 = TOP + i * RH;
      const lbl = r.label.length > 13 ? r.label.slice(0, 12) + '…' : r.label;
      s += `<text x="${LX - 8}" y="${y0 + RH / 2 + 4}" fill="${r.dim ? '#9a8fb0' : '#f1ecf8'}" font-size="13" text-anchor="end">${esc(lbl)}</text>`;
      const bx = x(r.low), bw = Math.max(6, x(r.high) - x(r.low));
      s += `<rect x="${bx}" y="${y0 + 5}" width="${bw}" height="${RH - 10}" rx="6" fill="${r.color}" opacity="${r.dim ? .55 : .95}"/>`;
      if (bw > 70) s += `<text x="${bx + bw / 2}" y="${y0 + RH / 2 + 4}" fill="${r.dim ? '#d6cde8' : '#10091a'}" font-size="12" font-weight="600" text-anchor="middle">${P.noteName(r.low)} – ${P.noteName(r.high)}</text>`;
    });
    s += '</svg>';
    $('#chartWrap').innerHTML = s;
    $('#chartWrap svg').id = 'chart';
    this.renderOverlap(ps);
  },

  renderOverlap(ps) {
    const el = $('#overlap');
    if (ps.length < 2) { el.textContent = ps.length === 1 ? 'ติ๊กอีกคนเพื่อดูช่วงที่ร้องคู่กันได้' : ''; return; }
    const lo = Math.max(...ps.map((p) => p.low)), hi = Math.min(...ps.map((p) => p.high));
    if (hi >= lo) {
      el.textContent = 'ช่วงที่ทุกคนร้องได้ตรงกัน: ' + P.noteName(lo) + ' – ' + P.noteName(hi) + ' (' + (hi - lo) + ' เซมิโทน) — ร้องคู่/ฮาร์โมนีในช่วงนี้ได้โดยไม่ต้องเปลี่ยนคีย์';
    } else {
      el.textContent = 'ช่วงเสียงไม่ทับกัน (ห่างกัน ' + (lo - hi) + ' เซมิโทน) — ร้องคู่ได้ถ้าเปลี่ยนคีย์ หรือร้องห่างกันเป็นอ็อกเทฟ';
    }
  },

  add() {
    const name = $('#addName').value.trim();
    const low = +$('#addLow').value, high = +$('#addHigh').value;
    if (!name) { $('#addName').focus(); return; }
    if (high <= low) { alert('เสียงสูงสุดต้องสูงกว่าเสียงต่ำสุด'); return; }
    const list = this.profiles(); list.push({ id: uid(), name, low, high, ts: Date.now() });
    store.set('voicerange.profiles.v1', list);
    $('#addName').value = ''; this.render();
  },

  renderSongs() {
    const ps = this.profiles(), sel = $('#songProfile'), keep = sel.value;
    sel.innerHTML = ps.map((p) => `<option value="${p.id}">${esc(p.name)} (${P.noteName(p.low)}–${P.noteName(p.high)})</option>`).join('') || '<option value="">— ยังไม่มีช่วงเสียง —</option>';
    if (ps.some((p) => p.id === keep)) sel.value = keep;
    const me = ps.find((p) => p.id === sel.value);
    const ul = $('#songList'); ul.innerHTML = '';
    this.songs().forEach((sg) => {
      let line = '<span class="fit">เลือกช่วงเสียงด้านบนก่อนเพื่อดูผล</span>', cls = '';
      if (me) {
        const r = P.songFit(me.low, me.high, sg.low, sg.high);
        const dir = r.shift > 0 ? 'ขึ้น' : 'ลง';
        if (r.fits && r.shift === 0) { cls = 'ok'; line = '✓ ร้องได้พอดี ใช้คีย์เดิม'; }
        else if (r.fits) { cls = 'shift'; line = '↕ ร้องได้ ถ้าเปลี่ยนคีย์ ' + dir + ' ' + Math.abs(r.shift) + ' เซมิโทน'; }
        else {
          cls = 'bad';
          const miss = [];
          if (r.lowMiss) miss.push('ต่ำเกิน ' + r.lowMiss);
          if (r.highMiss) miss.push('สูงเกิน ' + r.highMiss);
          line = '✕ เพลงกว้างกว่าช่วงเสียงอยู่ ' + r.over + ' เซมิโทน — เปลี่ยนคีย์ ' + (r.shift === 0 ? 'เดิม' : dir + ' ' + Math.abs(r.shift)) + ' จะขาดน้อยที่สุด (' + miss.join(', ') + ' เซมิโทน)';
        }
      }
      const li = document.createElement('li');
      li.innerHTML = `<span class="nm">${esc(sg.name)}</span><span class="rg">${P.noteName(sg.low)}–${P.noteName(sg.high)}</span>
        <button class="del" title="ลบ" aria-label="ลบ ${esc(sg.name)}">✕</button><span class="fit ${cls}">${line}</span>`;
      $('.del', li).addEventListener('click', () => {
        store.set('voicerange.songs.v1', this.songs().filter((x) => x.id !== sg.id)); this.renderSongs();
      });
      ul.appendChild(li);
    });
    if (!this.songs().length) ul.innerHTML = '<li class="rg">ยังไม่มีเพลง</li>';
  },

  addSong() {
    const name = $('#songName').value.trim();
    const low = +$('#songLow').value, high = +$('#songHigh').value;
    if (!name) { $('#songName').focus(); return; }
    if (high <= low) { alert('โน้ตสูงสุดของเพลงต้องสูงกว่าโน้ตต่ำสุด'); return; }
    const list = this.songs(); list.push({ id: uid(), name, low, high });
    store.set('voicerange.songs.v1', list);
    $('#songName').value = ''; this.renderSongs();
  },
};

/* =====================================================================
   ③ ฝึกตรงโน้ต
   ===================================================================== */
const Match = {
  target: 60, octFree: true, hold: 0, lastT: 0, score: 0, cool: 0, recent: [], listening: false, toneCtx: null,

  init() {
    fillSelect($('#tgtSel'), 36, 84, 60);
    $('#tgtSel').addEventListener('change', (e) => { this.target = +e.target.value; this.hold = 0; this.render(); });
    $('#octFree').addEventListener('change', (e) => { this.octFree = e.target.checked; this.hold = 0; });
    $('#btnPlay').addEventListener('click', () => this.play());
    $('#btnRandom').addEventListener('click', () => this.random());
    $('#btnListen').addEventListener('click', () => this.toggle(false));
    $('#btnMDemo').addEventListener('click', () => this.toggle(true));
  },

  render() {
    $('#tgtBig').textContent = noteLabel(this.target);
    $('#tgtSel').value = this.target;
    $('#score').textContent = this.score;
    $('#btnListen').textContent = this.listening && Engine.mode === 'mic' ? 'หยุดฟัง' : 'เริ่มร้อง';
    $('#btnMDemo').textContent = this.listening && Engine.mode === 'demo' ? 'หยุดทดลอง' : 'ลองด้วยเสียงสังเคราะห์';
    $('#holdBar').style.width = (this.hold / 10) + '%';
  },

  onStop() {
    this.listening = false; this.hold = 0; this.recent = [];
    const n = $('#needle'); if (n) { n.className = 'needle'; n.style.left = '50%'; }
    if ($('#mNow')) { $('#mNow').innerHTML = '&nbsp;'; }
  },

  async toggle(demo) {
    const mode = demo ? 'demo' : 'mic';
    if (this.listening && Engine.mode === mode) { Engine.stop(); this.onStop(); this.setMsg('หยุดฟังแล้ว', ''); this.render(); return; }
    try {
      Engine.onFrame = (fr) => this.frame(fr);
      await Engine.start(mode, (t) => this.target + (t < 3 ? 0.6 : 0.08 * Math.sin(t * 3)) + 0.1 * Math.sin(t * 2 * Math.PI * 5.5));
    } catch (e) { this.setMsg(micError(e), ''); return; }
    this.listening = true; this.hold = 0; this.recent = []; this.lastT = performance.now();
    this.setMsg('ร้องโน้ตเป้าหมายได้เลย', ''); this.render();
  },

  setMsg(t, cls) { const m = $('#mMsg'); m.textContent = t; m.className = 'msg big ' + cls; },

  frame(fr) {
    setLevel($('#level2'), fr.rms);
    const dt = Math.min(100, fr.t - (this.lastT || fr.t)); this.lastT = fr.t;
    const needle = $('#needle');
    if (fr.muted) { this.setMsg('กำลังเล่นเสียงตัวอย่าง… ฟังให้ดีก่อน', ''); needle.className = 'needle'; return; }
    if (fr.t < this.cool) return;

    if (fr.midi == null) {
      this.hold = Math.max(0, this.hold - dt * 2);
      if (fr.t - (this.lastVoiced || 0) > 250) { needle.className = 'needle'; $('#mNow').innerHTML = '&nbsp;'; this.recent.length = 0; }
      $('#holdBar').style.width = (this.hold / 10) + '%';
      return;
    }
    this.lastVoiced = fr.t;
    this.recent.push(fr.midi); if (this.recent.length > 5) this.recent.shift();
    const m = P.median(this.recent);
    let d = m - this.target;
    if (this.octFree) d = (((d % 12) + 18) % 12) - 6;
    const cents = Math.round(d * 100);
    const ok = Math.abs(cents) <= 25;

    needle.style.left = (50 + Math.max(-100, Math.min(100, cents)) / 2) + '%';
    needle.className = 'needle ' + (ok ? 'ok' : 'on');
    $('#mNow').textContent = 'คุณร้องอยู่: ' + noteLabel(Math.round(m)) + '  (' + (cents >= 0 ? '+' : '') + cents + '¢)';

    if (ok) {
      this.hold += dt;
      this.setMsg('ตรงโน้ต ✓ ค้างไว้…', 'good');
    } else {
      this.hold = Math.max(0, this.hold - dt * 2);
      this.setMsg(cents < 0 ? 'ต่ำไป — ร้องให้สูงขึ้นอีกนิด' : 'สูงไป — ลดเสียงลงอีกนิด', cents < 0 ? 'low' : 'high');
    }
    $('#holdBar').style.width = Math.min(100, this.hold / 10) + '%';
    if (this.hold >= 1000) this.pass(fr.t);
  },

  pass(t) {
    this.score++; this.hold = 0; this.cool = t + 900; this.recent.length = 0;
    this.setMsg('ผ่าน! 🎉 ตรงโน้ต ' + noteLabel(this.target), 'good');
    $('#score').textContent = this.score;
    const card = $('#tab-match .card:nth-of-type(2)');
    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    $('#needle').className = 'needle ok';
  },

  random() {
    const ps = Compare.profiles();
    const me = ps.length ? ps[ps.length - 1] : { low: 48, high: 72 };
    let m, n = 0;
    do { m = me.low + Math.floor(Math.random() * (me.high - me.low + 1)); n++; } while (m === this.target && n < 20);
    this.target = Math.max(36, Math.min(84, m)); this.hold = 0; this.render();
    this.setMsg('โน้ตใหม่ — กด “ฟังเสียงตัวอย่าง” หรือร้องได้เลย', '');
  },

  play() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.toneCtx) this.toneCtx = new AC();
    const ctx = this.toneCtx; ctx.resume();
    const t = ctx.currentTime, dur = 1.6;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = P.midiToFreq(this.target);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.05); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur + 0.05);
    Engine.mutedUntil = performance.now() + dur * 1000 + 350;
    this.hold = 0;
  },
};

/* ===== เริ่มต้น ===== */
Measure.init(); Compare.init(); Match.init();
Measure.render();
setChip(null);
window.__vr = { Engine, Measure, Compare, Match, P }; // สำหรับดีบัก
})();
