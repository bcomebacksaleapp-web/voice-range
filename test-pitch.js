// node voice-range/test-pitch.js
const P = require('./pitch.js');
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

function synth(freq, sr, n, harmonics) {
  const b = new Float32Array(n);
  for (let h = 1; h <= harmonics; h++)
    for (let i = 0; i < n; i++) b[i] += (0.3 / h) * Math.sin((2 * Math.PI * freq * h * i) / sr);
  return b;
}

for (const sr of [44100, 48000]) {
  for (const m of [40, 48, 57, 60, 69, 76, 84, 88]) {
    const f = P.midiToFreq(m);
    for (const harm of [1, 6]) {
      const r = P.yin(synth(f, sr, 4096, harm), sr);
      const err = r ? Math.abs(P.freqToMidi(r.freq) - m) * 100 : 999;
      ok(r && err < 8, `sr=${sr} ${P.noteName(m)} harm=${harm} err=${err.toFixed(1)}c`);
    }
  }
}
// silence / noise must not give a pitch
const noise = new Float32Array(4096).map(() => (Math.random() - 0.5) * 0.2);
ok(P.yin(noise, 48000) === null, 'white noise -> null');
ok(P.yin(new Float32Array(4096), 48000) === null, 'silence -> null');

// names
ok(P.noteName(60) === 'C4' && P.solfege(60) === 'โด', 'C4 = โด');
ok(P.noteName(69) === 'A4', 'A4');
ok(P.noteName(35) === 'B1', 'B1');

// tracker: ค้างโน้ต 0.6s ที่ 30 fps -> นิ่ง, ไถเสียง -> ไม่นิ่ง
let tr = P.createTracker(), got = null;
for (let i = 0; i < 30; i++) got = tr.push(i * 33, 57.1 + 0.15 * Math.sin(i)) ?? got;
ok(got !== null && Math.round(got) === 57, 'tracker holds A3 w/ vibrato');
tr = P.createTracker(); got = null;
for (let i = 0; i < 60; i++) got = tr.push(i * 33, 50 + i * 0.3) ?? got;
ok(got === null, 'tracker ignores glide');
tr = P.createTracker(); got = null;
for (let i = 0; i < 40; i++) got = tr.push(i * 33, i === 20 ? 69 : 57) ?? got;
const lastStable = (() => { tr = P.createTracker(); let r = null; for (let i = 0; i < 12; i++) r = tr.push(i * 33, i === 5 ? 69 : 57); return r; })();
ok(lastStable === null, 'octave blip breaks hold');

// voice types
ok(P.matchVoiceTypes(48, 72)[0].id === 'tenor', 'C3-C5 -> tenor');
ok(P.matchVoiceTypes(60, 84)[0].id === 'soprano', 'C4-C6 -> soprano');
ok(P.matchVoiceTypes(40, 64)[0].id === 'bass', 'E2-E4 -> bass');

// song fit
let f = P.songFit(50, 76, 55, 70);
ok(f.fits && f.shift === 0, 'fits in key');
f = P.songFit(50, 70, 55, 72); // เพลงสูงเกิน 2
ok(f.fits && f.shift === -2, 'shift down 2');
f = P.songFit(57, 69, 48, 72); // เพลงกว้าง 24 > 12
ok(!f.fits && f.over === 12, 'too wide by 12');
ok(P.describeSpan(26) === '2 อ็อกเทฟ 2 เซมิโทน', 'span text');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
