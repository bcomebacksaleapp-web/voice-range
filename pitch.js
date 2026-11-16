// แกนคำนวณเสียง: ตรวจจับพิตช์ (YIN), ชื่อโน้ต, ตัวจับ "โน้ตที่ค้างนิ่ง", จับคู่ประเภทเสียง, เช็กว่าร้องเพลงได้ไหม
// ไม่แตะ DOM / Web Audio จึงทดสอบด้วย node ได้ (node voice-range/test-pitch.js)
(function (root) {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SOLFEGE = ['โด', 'โด♯', 'เร', 'เร♯', 'มี', 'ฟา', 'ฟา♯', 'ซอล', 'ซอล♯', 'ลา', 'ลา♯', 'ที'];

  // C4 = MIDI 60 = 261.63 Hz (โดกลาง), A4 = 440 Hz
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
  const pc = (m) => ((Math.round(m) % 12) + 12) % 12;
  const noteName = (m) => NOTE_NAMES[pc(m)] + (Math.floor(Math.round(m) / 12) - 1);
  const solfege = (m) => SOLFEGE[pc(m)];
  const noteLabel = (m) => noteName(m) + ' (' + solfege(m) + ')';

  function median(arr) {
    if (!arr.length) return null;
    const a = arr.slice().sort((x, y) => x - y);
    const n = a.length;
    return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }

  function rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  // YIN pitch detection. คืน {freq, clarity} หรือ null ถ้าไม่ใช่เสียงที่มีระดับเสียงชัดเจน
  function yin(buf, sr, opt) {
    const o = Object.assign({ minFreq: 60, maxFreq: 1500, threshold: 0.15 }, opt || {});
    const tauMin = Math.max(2, Math.floor(sr / o.maxFreq));
    const tauMax = Math.min(Math.floor(sr / o.minFreq), Math.floor(buf.length / 2));
    const W = buf.length - tauMax;
    if (W < 256) return null;

    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) {
        const x = buf[i] - buf[i + tau];
        s += x * x;
      }
      d[tau] = s;
    }
    // cumulative mean normalized difference
    const cm = new Float32Array(tauMax + 1);
    cm[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      run += d[tau];
      cm[tau] = run > 0 ? (d[tau] * tau) / run : 1;
    }
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (cm[t] < o.threshold) {
        while (t + 1 <= tauMax && cm[t + 1] < cm[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return null;

    // parabolic interpolation
    let better = tau;
    if (tau > 1 && tau < tauMax) {
      const a = cm[tau - 1], b = cm[tau], c = cm[tau + 1];
      const den = a - 2 * b + c;
      if (den !== 0) better = tau + (a - c) / (2 * den);
    }
    return { freq: sr / better, clarity: 1 - cm[tau] };
  }

  // จับ "โน้ตที่ค้างนิ่ง" : ต้องมีเสียงต่อเนื่อง holdMs และแกว่งไม่เกิน spread เซมิโทน (รับเสียงสั่นได้)
  function createTracker(opt) {
    const o = Object.assign({ holdMs: 400, spread: 1.0, minCoverage: 0.8 }, opt || {});
    let hist = [];
    return {
      reset() { hist = []; },
      push(t, m) {
        hist.push({ t, m });
        while (hist.length && hist[0].t < t - o.holdMs - 150) hist.shift();
        const win = hist.filter((h) => h.t >= t - o.holdMs);
        if (win.length < 5) return null;
        if (hist[0].t > t - o.holdMs + 90) return null; // ยังมีประวัติไม่พอ
        const v = win.filter((h) => h.m != null).map((h) => h.m);
        if (v.length / win.length < o.minCoverage) return null;
        if (Math.max.apply(null, v) - Math.min.apply(null, v) > o.spread) return null;
        return median(v);
      },
    };
  }

  // ช่วงเสียงมาตรฐานของแต่ละประเภท (MIDI) — ประเมินจากช่วงเสียงอย่างเดียว ไม่ได้ดูโทนเสียง
  const VOICE_TYPES = [
    { id: 'bass', th: 'เบส', en: 'Bass', low: 40, high: 64, note: 'เสียงชายทุ้มลึก' },
    { id: 'baritone', th: 'บาริโทน', en: 'Baritone', low: 45, high: 69, note: 'เสียงชายกลาง–ทุ้ม' },
    { id: 'tenor', th: 'เทเนอร์', en: 'Tenor', low: 48, high: 72, note: 'เสียงชายสูง' },
    { id: 'alto', th: 'อัลโต', en: 'Alto', low: 53, high: 77, note: 'เสียงหญิงต่ำ' },
    { id: 'mezzo', th: 'เมซโซ-โซปราโน', en: 'Mezzo-soprano', low: 57, high: 81, note: 'เสียงหญิงกลาง' },
    { id: 'soprano', th: 'โซปราโน', en: 'Soprano', low: 60, high: 84, note: 'เสียงหญิงสูง' },
  ];

  function matchVoiceTypes(low, high) {
    const c = (low + high) / 2;
    return VOICE_TYPES.map((t) => {
      const overlap = Math.max(0, Math.min(high, t.high) - Math.max(low, t.low));
      const union = Math.max(high, t.high) - Math.min(low, t.low);
      const iou = union > 0 ? overlap / union : 0;
      const dist = Math.abs(c - (t.low + t.high) / 2);
      return Object.assign({}, t, { score: iou - 0.01 * dist, pct: Math.round(iou * 100) });
    }).sort((a, b) => b.score - a.score);
  }

  // เพลงช่วง [songLow, songHigh] ร้องได้ไหมสำหรับคนช่วง [userLow, userHigh]
  // shift = เปลี่ยนคีย์กี่เซมิโทน (+ ขึ้น / − ลง) ให้อยู่ในช่วงเสียง
  function songFit(userLow, userHigh, songLow, songHigh) {
    const minShift = userLow - songLow;
    const maxShift = userHigh - songHigh;
    if (minShift <= maxShift) {
      const shift = Math.max(minShift, Math.min(maxShift, 0));
      return { fits: true, shift, over: 0, lowMiss: 0, highMiss: 0 };
    }
    const over = minShift - maxShift;
    const shift = Math.round((minShift + maxShift) / 2);
    return {
      fits: false,
      shift,
      over,
      lowMiss: Math.max(0, userLow - (songLow + shift)),
      highMiss: Math.max(0, songHigh + shift - userHigh),
    };
  }

  function describeSpan(s) {
    const oct = Math.floor(s / 12);
    const rest = s % 12;
    const p = [];
    if (oct) p.push(oct + ' อ็อกเทฟ');
    if (rest) p.push(rest + ' เซมิโทน');
    return p.length ? p.join(' ') : '0 เซมิโทน';
  }

  const api = {
    NOTE_NAMES, SOLFEGE, VOICE_TYPES,
    midiToFreq, freqToMidi, noteName, solfege, noteLabel,
    median, rms, yin, createTracker, matchVoiceTypes, songFit, describeSpan,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pitch = api;
})(typeof self !== 'undefined' ? self : this);
