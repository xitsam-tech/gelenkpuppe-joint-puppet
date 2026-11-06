// Bewegungs-Training fuer die Gelenkpuppe: http://127.0.0.1:8765/?training=1
// Ein Optimierer (Evolutionsstrategie) sucht Gelenkkurven fuer Gehen, Laufen, Dribbeln und Aufstehen.
// Das ist eine Optimierung an Regeln und Messkurven, keine Physik-Simulation: Kraefte und Gleichgewicht werden nicht gerechnet.
// Quellen der Sollkurven: siehe docs/quellen-sources.md
const p = window.puppe;
const QUERY = new URLSearchParams(location.search);
const MINUTES = +(QUERY.get('minuten') || 30);
const RUN = 'training' + (QUERY.get('lauf') || '3') + '_';   // Dateiname; ein neuer Start macht beim gespeicherten Stand weiter
const TAU = Math.PI * 2;

function curve(pts) {           // stueckweise linear, weich genug als Sollkurve
  return ph => {
    ph = ph - Math.floor(ph);
    for (let i = 0; i + 1 < pts.length; i++) if (ph <= pts[i + 1][0]) {
      const [a, va] = pts[i], [b, vb] = pts[i + 1], t = (ph - a) / (b - a || 1);
      return va + (vb - va) * (t * t * (3 - 2 * t));
    }
    return pts[pts.length - 1][1];
  };
}

// Sollwerte in Grad je Anteil des Schrittzyklus (0 = Fersenaufsatz dieses Beins)
const GAITS = {
  gehen: {
    title: 'Gehen', speed: 1.4, period: 1.05, duty: 0.60, bob: 0.04, lift: 0.1, trunk: 3, hipY: -3, roll: 0.25, pelvis: 2.5, chest: 8, shift: .8, tilt: .7, curl: 32, elbowAmp: 16,
    hip: curve([[0, 30], [.1, 27], [.3, 8], [.5, -10], [.6, 0], [.75, 25], [.9, 32], [1, 30]]),
    knee: curve([[0, 10], [.12, 20], [.4, 9], [.6, 36], [.73, 50], [.9, 16], [1, 10]]),
    ankle: curve([[0, -4], [.07, -5], [.42, 7], [.6, -10], [.72, -5], [.9, -2], [1, -4]]),
    arm: 32, elbow: 24, flight: 0,
  },
  laufen: {
    title: 'Laufen', speed: 3.6, period: 0.72, duty: 0.38, bob: 0.08, lift: 0.42, trunk: 15, hipY: -6, pelvis: 5, chest: 11, shift: .5, tilt: 1.2, curl: 68, elbowAmp: 15,
    hip: curve([[0, 35], [.2, 10], [.38, -12], [.5, 0], [.75, 45], [.9, 48], [1, 35]]),
    knee: curve([[0, 18], [.15, 42], [.38, 18], [.6, 85], [.72, 105], [.9, 35], [1, 18]]),
    ankle: curve([[0, 8], [.12, 22], [.36, -28], [.5, -18], [.8, 10], [1, 8]]),
    arm: 36, elbow: 95, flight: 0.2,
  },
  // Sprint: kurzer Bodenkontakt auf dem Vorfuss, lange Flugphase, Knie hoch vorn, Ferse schwingt zum Gesaess, grosser Armeinsatz mit Ellbogen ~90
  sprinten: {
    title: 'Sprinten', speed: 7.5, period: 0.47, duty: 0.23, bob: 0.06, lift: 0.62, trunk: 12, hipY: -6, pelvis: 7, chest: 15, shift: .4, tilt: 1.5, curl: 30, elbowAmp: 18, forefoot: true,
    hip: curve([[0, 32], [.12, 8], [.23, -16], [.4, 10], [.6, 58], [.78, 74], [.92, 52], [1, 32]]),
    knee: curve([[0, 28], [.08, 42], [.23, 20], [.42, 95], [.55, 125], [.75, 95], [.92, 35], [1, 28]]),
    ankle: curve([[0, 2], [.08, 14], [.23, -32], [.4, -14], [.8, 6], [1, 2]]),
    arm: 48, elbow: 90, flight: 0.5,
  },
  dribbeln: {
    title: 'Dribbeln', speed: 3.2, period: 0.56, duty: 0.42, bob: 0.05, lift: 0.3, trunk: 7, hipY: -10, pelvis: 4, chest: 8, shift: .8, tilt: 1.3, curl: 40, elbowAmp: 12,
    hip: curve([[0, 38], [.2, 18], [.42, -4], [.6, 12], [.78, 40], [.9, 42], [1, 38]]),
    knee: curve([[0, 28], [.15, 48], [.42, 24], [.6, 72], [.72, 84], [.9, 38], [1, 28]]),
    ankle: curve([[0, 5], [.15, 18], [.4, -24], [.55, -12], [.85, 6], [1, 5]]),
    arm: 26, elbow: 95, flight: 0.08,
  },
};

const HARM = 3;
const NPAR = (2 * HARM + 1) * 3 + 5 + 9;   // Huefte, Knie, Fuss; Becken-Hoehe (5); Rumpf, Arme, Becken, Brustkorb, Seitwaerts
const fourier = (c, o, ph) => { let v = c[o]; for (let k = 1; k <= HARM; k++) v += c[o + 2 * k - 1] * Math.cos(TAU * k * ph) + c[o + 2 * k] * Math.sin(TAU * k * ph); return v; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const FINGERS = p.J.filter(j => /^(?!Spine|Thumb).*[123]$/.test(j.base));
const THUMBS = p.J.filter(j => /^Thumb[23]$/.test(j.base));
function setHands(curl, splay = 0) {
  const j = p.pose.j;
  for (const f of FINGERS) { j[f.id].beug = curl * (f.base.endsWith('1') ? 0.85 : f.base.endsWith('2') ? 1.1 : 0.75); if (f.base.endsWith('1') && splay) j[f.id].spreiz = splay; }
  for (const f of THUMBS) j[f.id].beug = curl * 0.5;
  j.LeftThumb1.gegen = j.RightThumb1.gegen = curl * 0.4;
}

function setGait(th, ph, g) {
  const j = p.pose.j, n = 2 * HARM + 1;
  const leg = (s, f) => {
    j[s + 'UpLeg'].beug = clamp(fourier(th, 0, f), -30, 120);
    j[s + 'UpLeg'].spreiz = 2.5;
    j[s + 'Leg'].beug = clamp(fourier(th, n, f), 0, 145);
    j[s + 'Foot'].heb = clamp(fourier(th, 2 * n, f), -50, 30);
    const q = f - Math.floor(f), mid = g.duty - 0.04, w = (q - mid) / 0.13;   // Zehen knicken am Ende des Stands, vor dem Abheben
    j[s + 'ToeBase'].heb = Math.abs(w) < 1 ? 40 * (g.roll || 1) * (1 - w * w) ** 2 : 0;
  };
  leg('Left', ph); leg('Right', ph + 0.5);
  const o = 3 * n;
  j.Hips.y = th[o] + th[o + 1] * Math.cos(2 * TAU * ph) + th[o + 2] * Math.sin(2 * TAU * ph) + th[o + 3] * Math.cos(TAU * ph) + th[o + 4] * Math.sin(TAU * ph);
  const r = o + 5;
  const trunk = clamp(th[r], -10, 40);
  const armPhase = Math.PI / 2 + th[r + 2] * 0.02;
  // Locker statt Roboter: der Unterarm und die Hand laufen dem Oberarm nach, die Schulter schwingt mit
  const armAt = (s, f) => {
    const a = TAU * f + armPhase, sw = th[r + 1] * Math.sin(a);
    j[s + 'Arm'].ebene = sw >= 0 ? 72 : -72; j[s + 'Arm'].heben = clamp(Math.abs(sw) + 6, 0, 120);
    j[s + 'ForeArm'].beug = clamp(th[r + 3] + th[r + 4] * Math.sin(a - 0.6), 0, 140);
    j[s + 'Hand'].beug = clamp(3 - 3 * Math.sin(a - 1.0), -20, 30);
    j[s + 'Shoulder'].vor = clamp(sw * 0.12, -20, 25);
    j[s + 'Shoulder'].heben = clamp(1 + Math.abs(sw) * 0.02, -10, 40);
  };
  armAt('Left', ph + 0.5); armAt('Right', ph);
  // Koerper geht mit: Becken dreht mit dem vorderen Bein, der Brustkorb dagegen, das Becken sinkt zur Schwungseite und wandert zum Standbein
  const c = Math.cos(TAU * ph), sn = Math.sin(TAU * ph);
  const pelvis = -th[r + 5] * c, chest = th[r + 7] * c, tilt = -th[r + 6] * sn;
  j.Hips.dreh = pelvis; j.Hips.seit = tilt; j.Hips.x = th[r + 8] * sn;
  j.Hips.vor = trunk * 0.5;
  const twist = chest - pelvis;
  j.Spine.beug = clamp(trunk * 0.25, -10, 20); j.Spine1.beug = clamp(trunk * 0.15, -7, 15); j.Spine2.beug = clamp(trunk * 0.1, -7, 15);
  j.Spine.dreh = clamp(twist * 0.15, -5, 5); j.Spine1.dreh = clamp(twist * 0.4, -12, 12); j.Spine2.dreh = clamp(twist * 0.45, -15, 15);
  j.Spine.seit = clamp(-tilt * 0.3, -10, 10); j.Spine1.seit = clamp(-tilt * 0.4, -8, 8); j.Spine2.seit = clamp(-tilt * 0.3, -8, 8);
  // Kopf gerade, Blick nach vorn: Hals und Kopf nehmen Neigung, Drehung und Kippen des Rumpfs zurueck (Wunsch des Nutzers)
  const lean = j.Hips.vor + j.Spine.beug + j.Spine1.beug + j.Spine2.beug;
  const yaw = pelvis + j.Spine.dreh + j.Spine1.dreh + j.Spine2.dreh;
  const roll = tilt + j.Spine.seit + j.Spine1.seit + j.Spine2.seit;
  j.Neck.beug = clamp(-lean * 0.6, -50, 40); j.Head.beug = clamp(-lean * 0.4, -25, 20);
  j.Neck.dreh = clamp(-yaw * 0.7, -50, 50); j.Head.dreh = clamp(-yaw * 0.3, -30, 30);
  j.Neck.seit = clamp(-roll, -35, 35);
  setHands(g.curl);
}

function evalGait(g, th) {
  resetPose();
  const S = 24, feet = { Left: [], Right: [] }, hipsY = [];
  const n = 2 * HARM + 1;
  let cost = { abrollen: 0, oberschenkel: 0, armschwung: 0, koerper: 0, oberkoerper: 0, ellbogen: 0, soll: 0, boden: 0, rutschen: 0, stand: 0, hub: 0, glatt: 0, flug: 0, fusshoehe: 0, boden2: 0 };
  for (let i = 0; i < S; i++) {
    const ph = i / S;
    setGait(th, ph, g); p.applyPoseFast();
    for (const s of ['Left', 'Right']) {
      const heel = p.mpos(s + 'Heel'), toe = p.mpos(s + 'ToeTip');
      feet[s].push({ y: Math.min(heel.y, toe.y), z: heel.y < toe.y ? heel.z : toe.z, hz: heel.z, tz: toe.z, hy: heel.y, ty: toe.y });
    }
    hipsY.push(p.wpos('Hips').y);
    const f = ph, j = p.pose.j;
    const d = (a, b) => (a - b) * (a - b);
    cost.soll += d(j.LeftLeg.beug, g.knee(f)) + 2 * d(j.LeftFoot.heb, g.ankle(f));
    cost.oberschenkel += d(j.LeftUpLeg.beug, g.hip(f)) * 3;
    // Arm schwingt gegengleich zum Oberschenkel: Bein vorn, Gegenarm vorn
    const hipSwing = g.hip(f) - (g.hipMid ?? (g.hipMid = (g.hip(0.15) + g.hip(0.65)) / 2));
    const wantArm = hipSwing / (g.hipAmp ?? (g.hipAmp = Math.max(...[0, .1, .2, .3, .4, .5, .6, .7, .8, .9].map(x => Math.abs(g.hip(x) - g.hipMid))))) * g.arm;
    const rightArm = (j.RightArm.ebene > 0 ? 1 : -1) * j.RightArm.heben;
    cost.armschwung += d(rightArm, wantArm) * 2;
    const low = Math.min(feet.Left[i].y, feet.Right[i].y);
    if (low < 0) cost.boden += low * low * 2500;
    if (low > 0.012 && !g.flight) cost.boden2 += low * low * 1500;
  }
  cost.soll = cost.soll / S / 400; cost.oberschenkel = cost.oberschenkel / S / 400; cost.armschwung = cost.armschwung / S / 400;
  cost.boden /= S; cost.boden2 /= S;
  // Stand: Fuss am Boden, rutscht nicht (Koerper laeuft mit g.speed), Anteil am Zyklus wie gemessen
  const dt = g.period / S;
  let contact = 0, both = 0, none = 0;
  for (let i = 0; i < S; i++) {
    const a = feet.Left[i], b = feet.Left[(i + 1) % S];
    const on = a.y < 0.025;
    if (on) { contact++; const pz = a.hy < a.ty ? b.hz - a.hz : b.tz - a.tz, v = pz / dt + g.speed; cost.rutschen += v * v * 0.35; }
    const r = feet.Right[i];
    if (on && r.y < 0.025) both++;
    if (!on && r.y >= 0.025) none++;
  }
  cost.rutschen /= S;
  const at = x => feet.Left[Math.round(x * S) % S];
  const strike = at(0), off = at(g.duty - 0.04);
  if (g.forefoot) cost.abrollen = (Math.max(0, strike.ty - 0.02) ** 2 + Math.max(0, off.ty - 0.02) ** 2 + Math.max(0, 0.06 - (off.hy - off.ty)) ** 2) * 1500;
  else cost.abrollen = (Math.max(0, strike.hy - 0.02) ** 2 + Math.max(0, 0.03 * (g.roll || 1) - (strike.ty - strike.hy)) ** 2 + Math.max(0, off.ty - 0.02) ** 2 + Math.max(0, 0.06 * (g.roll || 1) - (off.hy - off.ty)) ** 2) * 1500;
  cost.stand = (contact / S - g.duty) ** 2 * 60;
  cost.flug = (none / S - g.flight) ** 2 * 30;
  // Fuss wird nur so hoch gehoben, wie es die Gangart braucht (Hinweis des Nutzers: beim Gehen nicht weit hochschwingen)
  const maxLift = Math.max(...feet.Left.map(f => f.y));
  cost.fusshoehe = Math.max(0, maxLift - g.lift) ** 2 * 300;
  const hmin = Math.min(...hipsY), hmax = Math.max(...hipsY);
  cost.hub = ((hmax - hmin) - g.bob) ** 2 * 900;
  // glatt: keine Knicke im Verlauf
  for (let i = 0; i < S; i++) {
    const ph = i / S, s = 1 / S;
    const dd = o => (fourier(th, o, ph + s) - 2 * fourier(th, o, ph) + fourier(th, o, ph - s));
    cost.glatt += (dd(0) ** 2 + dd(n) ** 2 + dd(2 * n) ** 2) * 0.004;
  }
  cost.glatt /= S;
  const r = 3 * n + 5;
  cost.oberkoerper = (th[r] - g.trunk) ** 2 / 16;
  cost.ellbogen = (th[r + 3] - g.elbow) ** 2 / 64 + (Math.abs(th[r + 4]) - g.elbowAmp) ** 2 / 64;
  cost.koerper = (th[r + 5] - g.pelvis) ** 2 / 16 + (th[r + 6] - g.tilt) ** 2 / 16 + (th[r + 7] - g.chest) ** 2 / 16 + (th[r + 8] - g.shift) ** 2 / 4;
  const total = Object.values(cost).reduce((a, b) => a + b, 0);
  return { total, cost };
}

// ---------- Aufstehen aus der Rueckenlage (Ablauf vom Nutzer): aufsetzen, ueber das Knie in die Hocke, mit den Armen abstuetzen, aufstehen.
// Nicht gelernt, sondern aus Kontaktpunkten geloest: Becken und Rumpf folgen den Schluesselhaltungen, Fuesse und Haende stehen fest am Boden (IK).
//   Becken y, z | vor, Wirbelsaeule, Hals | Fuss links z, y, Fuss rechts z, y (m; null = Knoechelhoehe beim flachen Fuss)
//   flachL, flachR, zehR (0 bis 1) | Hand x, y, z | stuetzt
const UP_KEYS = [
  { h: [.13, .00], t: [-86, 0, 12], f: [.75, null, .75, null], w: [0, 0, 0], a: [.25, .05, -.05], push: 0, c: [15, 0, 0, 0] },   // liegt
  { h: [.12, .00], t: [-50, 8, 14], f: [.72, null, .72, null], w: [0, 0, 0], a: [.24, .05, -.22], push: 1, c: [4, -55, 55, 10] },   // setzt sich auf, Haende hinten
  { h: [.12, .02], t: [-42, 4, 12], f: [.62, null, .62, null], w: [1, 1, 0], a: [.24, .05, -.20], push: 1, c: [4, -55, 55, 10] },   // zieht die Fuesse heran
  { h: [.16, .10], t: [-15, 20, -10], f: [.62, null, .62, null], w: [1, 1, 0], a: [.27, .12, .15], push: 1, c: [4, -55, 55, 10] },   // richtet sich auf, Haende neben dem Becken
  { h: [.35, .26], t: [36, 20, -45], f: [.80, null, -.10, .16], w: [1, 0, 1], a: [.30, .05, .72], push: 1, c: [3, -55, 60, 12] },   // Gesaess hoch, rechtes Knie am Boden, Haende vorn
  { h: [.46, .44], t: [28, 20, -35], f: [.76, null, .50, null], w: [1, 1, 0], a: [.20, .56, .68], push: 0, c: [38, -20, 35, 0] },   // rechter Fuss vor: Hocke, Haende stuetzen auf dem Knie
  { h: [.66, .56], t: [18, 12, -20], f: [.72, null, .52, null], w: [1, 1, 0], a: [.20, .64, .70], push: 0, c: [30, -15, 20, 0] },   // drueckt sich hoch
  { h: [null, .60], t: [2, 1, -2], f: [.68, null, .52, null], w: [1, 1, 0], a: [.24, .88, .63], push: 0, c: [18, 0, 0, 0] },   // steht
];
const UP_FRAMES = 29;
const resetPose = () => { const j = p.pose.j; for (const id in j) for (const k in j[id]) j[id][k] = 0; };
let upBake = null;
function bakeUp() {
  p.opts.ground = false;
  const j = p.pose.j, V = p.V;
  resetPose(); p.applyPoseFast();
  const H = p.wpos('Hips'), H0 = { y: H.y, z: H.z }, ankle = p.wpos('LeftFoot').y - Math.min(p.mpos('LeftHeel').y, p.mpos('LeftToeTip').y);
  const footSpread = Math.abs(p.wpos('LeftFoot').x) * 0.8;
  const standY = H0.y - p.wpos('LeftFoot').y + ankle - 0.005;
  const L1 = p.wpos('LeftUpLeg').distanceTo(p.wpos('LeftLeg')), L2 = p.wpos('LeftLeg').distanceTo(p.wpos('LeftFoot'));
  j.LeftUpLeg.beug = j.RightUpLeg.beug = 10; j.LeftLeg.beug = j.RightLeg.beug = 15;
  j.LeftArm.heben = j.RightArm.heben = 30;
  const frames = [], report = [], handGoals = [], handPush = [];
  const num = v => v == null ? ankle : v;
  for (let i = 0; i < UP_FRAMES; i++) {
    const x = i / (UP_FRAMES - 1) * (UP_KEYS.length - 1), a = Math.min(Math.floor(x), UP_KEYS.length - 2), f = x - a, sm = f * f * (3 - 2 * f);
    const A = UP_KEYS[a], B = UP_KEYS[a + 1], mix = (u, v) => u + (v - u) * sm;
    const hy = mix(A.h[0] ?? standY, B.h[0] ?? standY), hz = mix(A.h[1], B.h[1]);
    j.Hips.y = (hy - H0.y) * 100; j.Hips.z = (hz - H0.z) * 100;
    const vor = mix(A.t[0], B.t[0]), sp = mix(A.t[1], B.t[1]), neck = mix(A.t[2], B.t[2]);
    j.Hips.vor = vor; j.Spine.beug = clamp(sp, -10, 20); j.Spine1.beug = clamp(sp * .7, -7, 15); j.Spine2.beug = clamp(sp * .5, -7, 15);
    j.Neck.beug = clamp(neck, -50, 40); j.Head.beug = clamp(neck * .5, -25, 20);
    const handC = A.c.map((u, n) => mix(u, B.c[n]));
    j.LeftHand.beug = j.RightHand.beug = handC[1];
    j.LeftForeArm.dreh = j.RightForeArm.dreh = handC[2];
    setHands(handC[0], handC[3]);
    handPush.push(mix(A.push, B.push));
    const sides = [['Left', 1, 0, 0], ['Right', -1, 2, 1]];
    for (const [sd, sg, fi, wi] of sides) {
      const fz = mix(A.f[fi], B.f[fi]), fy = mix(num(A.f[fi + 1]), num(B.f[fi + 1]));
      j[sd + 'Foot'].heb = 0;
      const solveLeg = ay => {
        p.applyPoseFast();
        const hip = p.wpos(sd + 'UpLeg'), dz = fz - hip.z, dy = ay - hip.y;
        const dist = Math.min(Math.hypot(dz, dy), L1 + L2 - 0.002);
        const atHip = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
        const atKnee = Math.acos(clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1));
        j[sd + 'UpLeg'].beug = clamp((Math.atan2(dz, -dy) + atHip) * 57.296 + j.Hips.vor, -30, 150);
        j[sd + 'Leg'].beug = clamp(180 - atKnee * 57.296, 0, 145);
      };
      solveLeg(fy);
      // Fuss: flach aufsetzen, rechts beim Knien auf den Zehen stehen
      const heb0 = j[sd + 'Foot'].heb;
      const search = want => { let v = heb0; for (let n = 0; n < 5; n++) { j[sd + 'Foot'].heb = v; p.applyPoseFast(); v = clamp(v - want() / 0.15 * 57.3, -50, 50); } return v; };
      const toeTip = () => p.mpos(sd + 'ToeTip'), heel = () => p.mpos(sd + 'Heel');
      const wFlat = mix(A.w[wi], B.w[wi]), wToe = sd === 'Right' ? mix(A.w[2], B.w[2]) : 0;
      const flat = search(() => toeTip().y - heel().y), toe = wToe > 0 ? search(() => toeTip().y - 0.005) : 0;
      j[sd + 'Foot'].heb = clamp(wFlat * flat + wToe * toe, -50, 40);
      // Liegt der Fuss trotzdem unter dem Boden (Gelenkgrenze), kommt der Knoechel so weit hoch: nichts sinkt ein
      for (let n = 0, ay = fy; n < 6; n++) {
        p.applyPoseFast();
        const under = Math.min(p.mpos(sd + 'Heel').y, p.mpos(sd + 'ToeTip').y) - 0.003;
        if (under >= 0) break;
        ay -= under; solveLeg(ay);
        if (wFlat > .5) j[sd + 'Foot'].heb = clamp(search(() => toeTip().y - heel().y), -50, 50);
      }
    }
    const hand = [mix(A.a[0], B.a[0]), mix(A.a[1], B.a[1]), mix(A.a[2], B.a[2])];
    handGoals.push(hand);
    for (const [sd, sg] of sides) { j[sd + 'ForeArm'].beug = Math.max(j[sd + 'ForeArm'].beug, 30); p.solveIK(sd, 'arm', V(sg * hand[0], hand[1], hand[2])); }
    p.applyPoseFast();
    frames.push(JSON.parse(JSON.stringify(j)));
    const lo = n => +Math.min(p.mpos(n + 'Heel').y, p.mpos(n + 'ToeTip').y).toFixed(3);
    report.push({ i, fussL: lo('Left'), fussR: lo('Right'), knieL: +p.wpos('LeftLeg').y.toFixed(3), knieR: +p.wpos('RightLeg').y.toFixed(3), handL: +p.wpos('LeftHand').y.toFixed(3), becken: +p.wpos('Hips').y.toFixed(3), ellL: +j.LeftForeArm.beug.toFixed(0) });
  }
  // Arme duerfen nicht durch die Beine (Nutzer): Abstand messen, Hand nach aussen legen, bis der Arm vorbeigeht, und das weich ueber die Bilder verteilen
  const segDist = (a, b, c, d) => {
    const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c), A2 = u.dot(u), E = v.dot(v), F2 = v.dot(w), C = u.dot(w), B2 = u.dot(v), den = A2 * E - B2 * B2;
    let ss = den > 1e-9 ? clamp((B2 * F2 - C * E) / den, 0, 1) : 0, tt = (B2 * ss + F2) / E;
    if (tt < 0) { tt = 0; ss = clamp(-C / A2, 0, 1); } else if (tt > 1) { tt = 1; ss = clamp((B2 - C) / A2, 0, 1); }
    return a.clone().addScaledVector(u, ss).distanceTo(c.clone().addScaledVector(v, tt));
  };
  const gap = () => {                 // kleinster Abstand Armachse zu Beinachse minus beider Dicke (m); unter 0 = Beruehrung
    let best = 9;
    for (const sd of ['Left', 'Right']) for (const lg of ['Left', 'Right']) {
      const armSegs = p.wpos(sd + 'Hand').y > .3 ? [[sd + 'Arm', sd + 'ForeArm', .045]] : [[sd + 'Arm', sd + 'ForeArm', .045], [sd + 'ForeArm', sd + 'Hand', .04], [sd + 'Hand', sd + 'Middle1', .03]];
      const legSegs = [[lg + 'UpLeg', lg + 'Leg', .075], [lg + 'Leg', lg + 'Foot', .055]];
      for (const [a, b, ra] of armSegs) for (const [c, d, rl] of legSegs)
        best = Math.min(best, segDist(p.wpos(a), p.wpos(b), p.wpos(c), p.wpos(d)) - ra - rl);
    }
    return best;
  };
  const load = fr => { for (const id in j) for (const k in j[id]) j[id][k] = fr[id][k]; p.applyPoseFast(); };
  const solveArms = (hand, off, spreadBack) => {
    for (const [sd, sg] of [['Left', 1], ['Right', -1]]) { j[sd + 'ForeArm'].beug = Math.max(j[sd + 'ForeArm'].beug, 30); p.solveIK(sd, 'arm', V(sg * (hand[0] + off), hand[1], hand[2] - spreadBack)); }
    p.applyPoseFast();
  };
  const tips = [];
  const WRIST_SIGN = sd => {            // Richtung numerisch: mehr Beugung senkt oder hebt die Fingerspitze, je nach Armstellung
    const w = j[sd + 'Hand'].beug; p.applyPoseFast(); const y0 = p.mpos(sd + 'MiddleTip').y;
    j[sd + 'Hand'].beug = w + 2; p.applyPoseFast(); const y1 = p.mpos(sd + 'MiddleTip').y; j[sd + 'Hand'].beug = w; p.applyPoseFast();
    return y1 > y0 ? -1 : 1;
  };
  const before = [], offs = [];
  for (let i = 0; i < UP_FRAMES; i++) {
    load(frames[i]); before.push(+gap().toFixed(3));
    let off = 0;
    for (let n = 0; n < 8 && gap() < 0.005; n++) { off += .03; solveArms(handGoals[i], off, 0); }
    offs.push(off);
  }
  // weich: Nachbarbilder uebernehmen den groessten Abstand, dann glaetten
  const wide = offs.map((_, i) => Math.max(...offs.slice(Math.max(0, i - 2), i + 3)));
  const soft = wide.map((_, i) => { const w = wide.slice(Math.max(0, i - 2), i + 3); return w.reduce((a, b) => a + b, 0) / w.length; });
  const after = [];
  for (let i = 0; i < UP_FRAMES; i++) {
    load(frames[i]); solveArms(handGoals[i], Math.max(soft[i], offs[i]), 0);
    after.push(+gap().toFixed(3));
    for (const sd of ['Left', 'Right']) {
      if (handPush[i] > .5 && p.wpos(sd + 'Hand').y < .12) {
        let w = j[sd + 'Hand'].beug;
        for (let n = 0; n < 6; n++) { j[sd + 'Hand'].beug = w; p.applyPoseFast(); w = clamp(w + (p.mpos(sd + 'MiddleTip').y - .015) / .16 * 57.3 * (sd ? 1 : 1) * WRIST_SIGN(sd), -75, 40); }
        j[sd + 'Hand'].beug = w; p.applyPoseFast();
      }
    }
    tips.push(+p.mpos('LeftMiddleTip').y.toFixed(3));
    frames[i] = JSON.parse(JSON.stringify(j));
    report[i].handL = +p.wpos('LeftHand').y.toFixed(3);
  }
  window.__upClear = { vorher: before, nachher: after, aussen: offs, fingerspitze: tips };
  window.__upReport = report;
  upBake = frames;
}

function setUp(th, t) {
  if (!upBake) bakeUp();
  const x = clamp(t, 0, 0.9999) * (upBake.length - 1), a = Math.floor(x), f = x - a, A = upBake[a], B = upBake[a + 1], j = p.pose.j;
  for (const id in j) for (const k in j[id]) j[id][k] = A[id][k] + (B[id][k] - A[id][k]) * f;
}

// Keine Lernaufgabe: zeigt nur, wie gut die Kontakte sitzen
function evalUp() {
  if (!upBake) bakeUp();
  let beine = 0, boden = 0;
  for (const r of window.__upReport) {
    beine += Math.max(0, r.fussL - .03) + Math.max(0, r.fussR - .03);
    boden += Math.max(0, -r.fussL) + Math.max(0, -r.fussR) + Math.max(0, .03 - r.knieL) + Math.max(0, .03 - r.knieR);
  }
  const cost = { beine: beine / UP_FRAMES, boden: boden / UP_FRAMES };
  return { total: cost.beine + cost.boden, cost };
}

// ---------- Rueckwaerts und seitwaerts laufen: aus Fussbahnen geloest. Der Standfuss steht in der Welt still, weil er im Koerper genau
// mit dem Tempo zurueckwandert. Rueckwaerts: auf dem Vorfuss, Oberkoerper leicht vor. Seitwaerts: Fuesse kreuzen nie, Blick bleibt nach vorn.
const CYCLES = {
  rueckwaerts: { axis: 'z', dir: -1, speed: 2.0, period: .6, duty: .5, lift: .06, drop: .05, bob: .03, trunk: 9, elbow: 85, amp: 22, base: [0, 0], curl: 50, ball: .035, pelvis: 4 },
  seitwaerts: { axis: 'x', dir: 1, speed: 1.8, period: .55, duty: .45, lift: .055, drop: .12, bob: .03, trunk: 10, elbow: 70, amp: 12, base: [.28, -.28], curl: 35, ball: 0, pelvis: 0 },
  // Aufrecht (Feldspieler, Schiedsrichter): rueckwaerts und seitwaerts gehen/laufen ohne Torwart-Hocke.
  // Rueckwaerts gehen: kurze Schritte (~0,43 m), Vorfuss zuerst, Rumpf kaum vor, Arme locker.
  rueckwaerts_gehen: { axis: 'z', dir: -1, speed: 1.0, period: .85, duty: .6, lift: .045, drop: .02, bob: .02, trunk: 5, elbow: 22, amp: 14, base: [0, 0], curl: 22, ball: .012, pelvis: 3 },
  // Seitwaerts gehen (Nachstellschritt): Fuesse 0,15 bis 0,65 m auseinander, nie gekreuzt; Arme haengen fast am Koerper
  seitwaerts_gehen: { axis: 'x', dir: 1, speed: 1.0, period: .5, duty: .6, lift: .04, drop: .03, bob: .015, trunk: 3, elbow: 20, amp: 3, base: [.2, -.2], curl: 22, ball: 0, pelvis: 0, armUp: 9 },
  // Seitwaerts laufen (Linienrichter, Sidestep im Lauf): Fuesse 0,2 bis 0,75 m, kurzer Flug, Arme zur Balance leicht ab, Ellbogen gebeugt
  seitwaerts_laufen: { axis: 'x', dir: 1, speed: 2.6, period: .36, duty: .32, lift: .07, drop: .05, bob: .035, trunk: 6, elbow: 75, amp: 8, base: [.24, -.24], curl: 45, ball: .02, pelvis: 0, armUp: 18 },
};
const cycleBake = {};
function bakeCycle(name) {
  const c = CYCLES[name], j = p.pose.j, S = c.speed * c.period * c.duty, F = 24;
  p.opts.ground = false;
  resetPose(); p.applyPoseFast();
  const H0 = p.wpos('Hips').clone(), ankle = p.wpos('LeftFoot').y - Math.min(p.mpos('LeftHeel').y, p.mpos('LeftToeTip').y);
  const spread = Math.abs(p.wpos('LeftFoot').x) * 0.8, standY = H0.y - p.wpos('LeftFoot').y + ankle - 0.005;
  const L1 = p.wpos('LeftUpLeg').distanceTo(p.wpos('LeftLeg')), L2 = p.wpos('LeftLeg').distanceTo(p.wpos('LeftFoot'));
  const footAt = (i, ph) => {            // Lage des Fusses relativ zur Koerpermitte
    const q = ph - Math.floor(ph);
    if (q < c.duty) return { a: c.dir * (S / 2 - S * (q / c.duty)), y: 0, stance: true, u: q / c.duty };
    const v = (q - c.duty) / (1 - c.duty), sm = v * v * (3 - 2 * v);
    return { a: c.dir * (-S / 2 + S * sm), y: c.lift * Math.sin(Math.PI * v), stance: false, u: v };
  };
  const legTo = (sd, x, y, z) => {
    p.applyPoseFast();
    const hip = p.wpos(sd + 'UpLeg'), dx = x - hip.x, dy = y - hip.y, dz = z - hip.z, h = Math.hypot(dx, dy);
    const dist = Math.min(Math.hypot(dz, h), L1 + L2 - 0.002);
    const atHip = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
    const atKnee = Math.acos(clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1));
    j[sd + 'UpLeg'].beug = clamp((Math.atan2(dz, h) + atHip) * 57.296 + j.Hips.vor, -30, 135);
    j[sd + 'Leg'].beug = clamp(180 - atKnee * 57.296, 0, 145);
    // Abspreizen numerisch, weil die Seiten gespiegelt sind
    for (let n = 0; n < 3; n++) {
      const sp = j[sd + 'UpLeg'].spreiz;
      p.applyPoseFast(); const x0 = p.wpos(sd + 'Foot').x;
      j[sd + 'UpLeg'].spreiz = sp + 1; p.applyPoseFast(); const slope = p.wpos(sd + 'Foot').x - x0;
      j[sd + 'UpLeg'].spreiz = clamp(sp + (Math.abs(slope) > 1e-4 ? (x - x0) / slope : 0), -30, 45);
    }
  };
  const frames = [], report = [];
  for (let i = 0; i < F; i++) {
    const ph = i / F, tw = Math.cos(TAU * ph), sw2 = Math.cos(2 * TAU * ph), sn = Math.sin(TAU * ph);
    resetPose();
    j.Hips.y = (standY - c.drop + c.bob * 0.5 * sw2 - H0.y) * 100;
    j.Hips.vor = c.trunk * .5; j.Spine.beug = c.trunk * .25; j.Spine1.beug = c.trunk * .15; j.Spine2.beug = c.trunk * .1;
    const pelvis = c.pelvis * tw;
    j.Hips.dreh = pelvis; j.Spine1.dreh = clamp(-pelvis * .9, -12, 12); j.Spine2.dreh = clamp(-pelvis * .9, -15, 15);
    const yaw = pelvis + j.Spine1.dreh + j.Spine2.dreh;
    j.Neck.dreh = clamp(-yaw, -50, 50);
    j.Neck.beug = -c.trunk * .6; j.Head.beug = -c.trunk * .4;
    if (c.axis === 'z') j.Hips.x = 1.2 * sn; else { j.Hips.seit = 1.5 * sn; j.Neck.seit = -1.5 * sn; }
    setHands(c.curl);
    const feet = {};
    [['Left', 1, 0, 0], ['Right', -1, 1, .5]].forEach(([sd, sg, bi, off]) => {
      const f = footAt(bi, ph + off); feet[sd] = f;
      const lateral = c.axis === 'x' ? c.base[bi] + f.a : sg * spread;
      const forward = c.axis === 'z' ? f.a : 0.02;
      j[sd + 'Foot'].heb = 0;
      const stanceY = ankle + (c.ball ? .02 : 0);
      legTo(sd, lateral, (f.stance ? stanceY : ankle) + f.y, H0.z + forward);
      // Sohle ausrichten; im Schwung nur leicht gesenkt und nie unter dem Boden
      let v = 0;
      const wantTilt = f.stance ? c.ball : 0.03 * Math.sin(Math.PI * f.u);
      for (let k = 0; k < 5; k++) { j[sd + 'Foot'].heb = v; p.applyPoseFast(); v = clamp(v - ((p.mpos(sd + 'ToeTip').y - p.mpos(sd + 'Heel').y) + wantTilt) / .15 * 57.3, -50, 40); }
      j[sd + 'Foot'].heb = v; p.applyPoseFast();
      const under = Math.min(p.mpos(sd + 'Heel').y, p.mpos(sd + 'ToeTip').y) - 0.005;
      if (under < 0) legTo(sd, lateral, (f.stance ? stanceY : ankle) + f.y - under, H0.z + forward);
    });
    // Arme gegengleich; seitwaerts nur wenig und zur Balance leicht abgespreizt
    [['Left', 'Right'], ['Right', 'Left']].forEach(([sd, other]) => {
      const sw = c.axis === 'z' ? c.amp * feet[other].a / (S / 2) : c.amp * (sd === 'Left' ? sn : -sn);
      if (c.axis === 'z') { j[sd + 'Arm'].ebene = sw >= 0 ? 80 : -80; j[sd + 'Arm'].heben = Math.abs(sw) + 3; }
      else { j[sd + 'Arm'].ebene = 25; j[sd + 'Arm'].heben = (c.armUp ?? 22) + sw; }
      j[sd + 'ForeArm'].beug = c.elbow + sw * .25;
      j[sd + 'Shoulder'].vor = clamp(sw * .25, -20, 25);
    });
    p.applyPoseFast();
    frames.push(JSON.parse(JSON.stringify(j)));
    const lo = n => Math.min(p.mpos(n + 'Heel').y, p.mpos(n + 'ToeTip').y);
    report.push({ i, fussL: +lo('Left').toFixed(3), fussR: +lo('Right').toFixed(3), standL: feet.Left.stance, standR: feet.Right.stance, ellL: +j.LeftForeArm.beug.toFixed(0) });
  }
  (window.__cycleReport = window.__cycleReport || {})[name] = report;
  cycleBake[name] = frames;
}
function setCycle(name, ph) {
  if (!cycleBake[name]) bakeCycle(name);
  const fr = cycleBake[name], x = (ph - Math.floor(ph)) * fr.length, a = Math.floor(x) % fr.length, f = x - Math.floor(x), A = fr[a], B = fr[(a + 1) % fr.length], j = p.pose.j;
  for (const id in j) for (const k in j[id]) j[id][k] = A[id][k] + (B[id][k] - A[id][k]) * f;
}
function evalCycle(name) {
  if (!cycleBake[name]) bakeCycle(name);
  let boden = 0, beine = 0;
  for (const r of window.__cycleReport[name]) {
    boden += Math.max(0, -r.fussL) + Math.max(0, -r.fussR);
    if (r.standL) beine += Math.max(0, r.fussL - .02);
    if (r.standR) beine += Math.max(0, r.fussR - .02);
  }
  const cost = { boden: boden / 24, beine: beine / 24 };
  return { total: cost.boden + cost.beine, cost };
}

// ---------- Spruenge: Schluesselhaltungen mit festen Fuessen am Boden, in der Luft eine Wurfparabel mit g = 9,81
// Spalten: Zeit s | Becken z, Hoehe zum Stand (m) | Rumpf, Armwinkel (+ vor, - zurueck), Ellbogen (Grad) | Fuss L z, y, R z, y (m) | Fuss L, R: Spitze unter Ferse (m)
const JUMPS = {
  // Fangen (Nutzer): mit offenen Armen dem Ball entgegen, Handflaechen nach vorn (W-Griff), dann den Ball an den Oberkoerper ziehen.
  // Spalten hands: Hand x, y, z (m) | Unterarm-Drehung, Handgelenk, Fingerkruemmung, Spreizen
  fangen: {
    period: .9, off: 9, land: 10, tuck: 0,
    keys: [
      [0, 0, -.16, 12, 0, 0, .02, 0, .02, 0, 0, 0],
      [.22, 0, -.12, 14, 0, 0, .02, 0, .02, 0, 0, 0],
      [.34, 0, -.12, 14, 0, 0, .02, 0, .02, 0, 0, 0],
      [.52, -.07, -.17, 30, 0, 0, .02, 0, .02, 0, 0, 0],
      [.9, 0, -.03, 6, 0, 0, .02, 0, .02, 0, 0, 0],
    ],
    hands: [
      [.22, 1.02, .30, 40, -30, 18, 5],     // Grundstellung, Haende kommen hoch
      [.13, 1.20, .50, 75, -60, 10, 14],    // Arme offen nach vorn, Finger gespreizt: hier kommt der Ball
      [.12, 1.17, .47, 75, -60, 16, 12],    // Ball in den Haenden
      [.125, .98, .12, 0, 0, 45, 0],        // Wucht: Ball schnell an die Brust, Haende seitlich darum, Oberkoerper rollt darueber
      [.125, 1.08, .16, 0, 0, 45, 0],      // Ball an der Brust: beide Haende seitlich um den Ball, Daumen oben
    ],
  },
  // Flacher Ball: auf ein Knie, Oberkoerper ueber den Ball, Haende davor am Boden (Handflaechen zum Ball, Finger zum Boden), dann an die Brust
  fangen_flach: {
    period: .95, off: 9, land: 10, tuck: 0,
    keys: [
      [0, 0, -.14, 10, 0, 0, .02, 0, .02, 0, 0, 0],
      [.20, -.02, -.45, 62, 0, 0, .24, 0, -.24, .14, 0, .12],
      [.30, -.02, -.45, 62, 0, 0, .24, 0, -.24, .14, 0, .12],
      [.60, -.02, -.22, 30, 0, 0, .10, 0, -.02, 0, 0, 0],
      [.95, 0, -.03, 6, 0, 0, .02, 0, .02, 0, 0, 0],
    ],
    hands: [
      [.22, 1.0, .28, 40, -30, 18, 5],
      [.12, .17, .46, -70, 15, 12, 8],
      [.12, .20, .44, -70, 15, 20, 6],
      [.125, .95, .18, -20, 5, 40, 0],
      [.125, 1.08, .16, 0, 0, 45, 0],
    ],
  },
  // Hoher Ball: aus den Knien hochspringen, Arme offen ueber den Kopf, oben fangen, im Fallen an die Brust ziehen, weich landen
  fangen_hoch: {
    period: 1.6, off: .40, land: .90, tuck: .06,
    keys: [
      [0, 0, -.14, 10, 0, 0, .02, 0, .02, 0, 0, 0],
      [.25, -.04, -.24, 20, 0, 0, .02, 0, .02, 0, 0, 0],
      [.40, 0, .06, 2, 0, 0, .02, .06, .02, .06, .1, .1],
      [.63, 0, .04, 4, 0, 0, .02, .05, .02, .05, .09, .09],
      [.90, 0, .02, 10, 0, 0, .02, .04, .02, .04, .08, .08],
      [1.1, -.05, -.17, 26, 0, 0, .02, 0, .02, 0, 0, 0],
      [1.6, 0, -.03, 6, 0, 0, .02, 0, .02, 0, 0, 0],
    ],
    hands: [
      [.22, 1.0, .28, 40, -30, 18, 5],
      [.24, .86, .14, 40, -30, 18, 5],
      [.15, 1.55, .32, 65, -55, 12, 12],
      [.14, 2.05, .28, 65, -55, 14, 12],
      [.125, 1.32, .18, 0, 0, 45, 0],
      [.125, .95, .13, 0, 0, 45, 0],
      [.125, 1.08, .16, 0, 0, 45, 0],
    ],
  },
  // Ball an der Brust halten: Haende seitlich um den Ball, Daumen oben, Unterarm in Nullstellung (Nutzer)
  halten: {
    period: 1.6, off: 9, land: 10, tuck: 0,
    keys: [
      [0, 0, -.03, 6, 0, 0, .02, 0, .02, 0, 0, 0],
      [.8, 0, -.045, 7, 0, 0, .02, 0, .02, 0, 0, 0],
      [1.6, 0, -.03, 6, 0, 0, .02, 0, .02, 0, 0, 0],
    ],
    hands: [[.125, 1.08, .16, 0, 0, 45, 0], [.125, 1.07, .16, 0, 0, 45, 0], [.125, 1.08, .16, 0, 0, 45, 0]],
  },
  sprung: {
    period: 2.0, off: .70, land: 1.30, tuck: .10,
    keys: [
      [0, 0, 0, 2, 0, 15, .02, 0, .02, 0, 0, 0],                    // steht
      [.40, -.07, -.22, 30, -30, 60, .02, 0, .02, 0, 0, 0],          // geht in die Knie, Arme zurueck
      [.70, 0, .06, 3, 45, 85, .02, .06, .02, .06, .1, .1],         // streckt sich, Arme schwingen hoch, von den Zehen ab
      [1.30, 0, .02, 8, 30, 70, .02, .04, .02, .04, .08, .08],       // landet auf dem Vorfuss
      [1.55, -.05, -.18, 25, 15, 45, .02, 0, .02, 0, 0, 0],          // federt ab
      [2.0, 0, 0, 2, 0, 15, .02, 0, .02, 0, 0, 0],                   // steht
    ],
  },
  sprung_lauf: {
    period: 1.8, off: .58, land: 1.10, tuck: .08,
    keys: [
      [0, 0, -.04, 8, -20, 70, -.30, .08, .10, 0, 0, 0],             // laeuft an, rechter Fuss steht
      [.15, .42, -.06, 8, -5, 70, .25, .14, .10, .02, 0, .08],       // linkes Bein kommt nach vorn
      [.30, .84, -.14, 15, -25, 70, 1.20, 0, .55, .08, 0, .08],      // linker Fuss setzt auf, Koerper tief
      [.58, 1.50, .06, 2, 40, 85, 1.20, .06, 1.85, .50, .1, 0],     // Absprung links, rechtes Knie und Arme hoch
      [1.10, 2.70, 0, 8, 30, 70, 2.82, .04, 2.72, .04, .08, .08],    // landet
      [1.35, 2.82, -.18, 22, 15, 45, 2.82, 0, 2.72, 0, 0, 0],        // federt ab
      [1.8, 2.82, 0, 2, 0, 15, 2.84, 0, 2.80, 0, 0, 0],              // steht
    ],
  },
};
const jumpBake = {};
function bakeJump(name) {
  const c = JUMPS[name], j = p.pose.j, F = Math.round(c.period * 30);
  p.opts.ground = false;
  resetPose(); p.applyPoseFast();
  const H0 = p.wpos('Hips').clone(), ankle = p.wpos('LeftFoot').y - Math.min(p.mpos('LeftHeel').y, p.mpos('LeftToeTip').y);
  const spread = Math.abs(p.wpos('LeftFoot').x) * 0.8, standY = H0.y - p.wpos('LeftFoot').y + ankle - 0.005;
  const L1 = p.wpos('LeftUpLeg').distanceTo(p.wpos('LeftLeg')), L2 = p.wpos('LeftLeg').distanceTo(p.wpos('LeftFoot'));
  const at = t => {                       // Zwischenwerte aller Spalten zur Zeit t
    let a = 0; while (a + 2 < c.keys.length && t >= c.keys[a + 1][0]) a++;
    const A = c.keys[a], B = c.keys[a + 1], f = clamp((t - A[0]) / (B[0] - A[0]), 0, 1), sm = f * f * (3 - 2 * f);
    return A.map((v, i) => v + (B[i] - v) * sm);
  };
  const keyAt = t => c.keys.find(k => Math.abs(k[0] - t) < 1e-6);
  const kO = keyAt(c.off), kL = keyAt(c.land), T = c.land - c.off;
  const frames = [], report = [];
  for (let i = 0; i < F; i++) {
    const t = i / F * c.period, v = at(t);
    let hy = standY + v[2], fyL = ankle + v[7], fyR = ankle + v[9], hz = v[1], air = false;
    let zL = v[6], zR = v[8];
    if (t > c.off && t < c.land) {
      // In der Luft zaehlt nur die Parabel; waagerecht gleichmaessig, Fuesse relativ zum Becken mit leichtem Anhocken
      air = true;
      const u = (t - c.off) / T, yO = standY + kO[2], yL = standY + kL[2];
      hy = yO + (yL - yO) * u + 0.5 * 9.81 * T * T * u * (1 - u);
      hz = kO[1] + (kL[1] - kO[1]) * u;
      const tuck = c.tuck * Math.sin(Math.PI * u);
      fyL = hy - ((yO - ankle - kO[7]) * (1 - u) + (yL - ankle - kL[7]) * u) + tuck;
      fyR = hy - ((yO - ankle - kO[9]) * (1 - u) + (yL - ankle - kL[9]) * u) + tuck;
      zL = kO[6] + (kL[6] - kO[6]) * u; zR = kO[8] + (kL[8] - kO[8]) * u;
    }
    resetPose();
    j.Hips.y = (hy - H0.y) * 100; j.Hips.z = (hz + H0.z - H0.z) * 100;
    const trunk = v[3];
    j.Hips.vor = trunk * .5; j.Spine.beug = trunk * .25; j.Spine1.beug = trunk * .15; j.Spine2.beug = trunk * .1;
    j.Neck.beug = -trunk * .6; j.Head.beug = -trunk * .4;
    setHands(15);
    const legs = [['Left', 1, fyL, zL, v[10]], ['Right', -1, fyR, zR, v[11]]];
    for (const [sd, sg, fy, fz, drop] of legs) {
      p.applyPoseFast();
      const hip = p.wpos(sd + 'UpLeg'), dz = fz + H0.z - hip.z, dy = fy - hip.y, dist = Math.min(Math.hypot(dz, dy), L1 + L2 - 0.002);
      const atHip = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
      const atKnee = Math.acos(clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1));
      j[sd + 'UpLeg'].beug = clamp((Math.atan2(dz, -dy) + atHip) * 57.296 + j.Hips.vor, -30, 135);
      j[sd + 'Leg'].beug = clamp(180 - atKnee * 57.296, 0, 145);
      let h = 0;
      const tilt = air ? drop * .6 : drop;
      for (let n = 0; n < 5; n++) { j[sd + 'Foot'].heb = h; p.applyPoseFast(); h = clamp(h - ((p.mpos(sd + 'ToeTip').y - p.mpos(sd + 'Heel').y) + tilt) / .15 * 57.3, -50, 40); }
      j[sd + 'Foot'].heb = h;
    }
    if (c.hands) {
      let a = 0; while (a + 2 < c.keys.length && t >= c.keys[a + 1][0]) a++;
      const f = clamp((t - c.keys[a][0]) / (c.keys[a + 1][0] - c.keys[a][0]), 0, 1), sm = f * f * (3 - 2 * f);
      const H = c.hands[a].map((u, n) => u + (c.hands[a + 1][n] - u) * sm);
      setHands(H[5], H[6]);
      for (const [sd, sg] of [['Left', 1], ['Right', -1]]) {
        j[sd + 'ForeArm'].dreh = H[3]; j[sd + 'Hand'].beug = H[4];
        j[sd + 'ForeArm'].beug = Math.max(j[sd + 'ForeArm'].beug, 30); j[sd + 'Arm'].heben = Math.max(j[sd + 'Arm'].heben, 30); j[sd + 'Arm'].ebene = 70;
        p.solveIK(sd, 'arm', p.V(sg * H[0], H[1], H[2] + H0.z));
      }
    } else for (const sd of ['Left', 'Right']) {
      const sw = v[4];
      j[sd + 'Arm'].ebene = sw >= 0 ? 80 : -80; j[sd + 'Arm'].heben = clamp(Math.abs(sw) + 3, 0, 170);
      j[sd + 'ForeArm'].beug = clamp(v[5], 0, 145);
      j[sd + 'Shoulder'].heben = clamp(Math.max(0, sw - 60) * .2, 0, 30);
    }
    p.applyPoseFast();
    frames.push(JSON.parse(JSON.stringify(j)));
    const lo = n => Math.min(p.mpos(n + 'Heel').y, p.mpos(n + 'ToeTip').y);
    report.push({ t: +t.toFixed(2), luft: air, fussL: +lo('Left').toFixed(3), fussR: +lo('Right').toFixed(3), becken: +p.wpos('Hips').y.toFixed(3), knieL: +j.LeftLeg.beug.toFixed(0), knieR: +j.RightLeg.beug.toFixed(0) });
  }
  (window.__jumpReport = window.__jumpReport || {})[name] = report;
  jumpBake[name] = frames;
}
function setJump(name, u) {
  if (!jumpBake[name]) bakeJump(name);
  const fr = jumpBake[name], x = clamp(u, 0, .9999) * fr.length, a = Math.floor(x), f = x - a, A = fr[a], B = fr[Math.min(a + 1, fr.length - 1)], j = p.pose.j;
  for (const id in j) for (const k in j[id]) j[id][k] = A[id][k] + (B[id][k] - A[id][k]) * f;
}
// Gehen mit dem Ball an der Brust: Beine und Becken aus dem Gehen, Arme halten den Ball (Griff wie beim Stehen)
let holdWalkBake = null;
function setHoldWalk(ph) {
  const j = p.pose.j;
  if (!holdWalkBake) {
    p.opts.ground = false;
    holdWalkBake = [];
    for (let i = 0; i < 16; i++) {
      resetPose(); setGait(ES.gehen.best, i / 16, GAITS.gehen);
      for (const [sd, sg] of [['Left', 1], ['Right', -1]]) {
        j[sd + 'Shoulder'].vor = 0; j[sd + 'Shoulder'].heben = 0; j[sd + 'Hand'].beug = 0; j[sd + 'ForeArm'].dreh = 0;
        j[sd + 'ForeArm'].beug = 100; j[sd + 'Arm'].ebene = 70; j[sd + 'Arm'].heben = 30;
      }
      setHands(45, 0);
      for (const [sd, sg] of [['Left', 1], ['Right', -1]]) p.solveIK(sd, 'arm', p.V(sg * .125, 1.08, .16));
      for (const sd of ['Left', 'Right']) {
        let v = j[sd + 'Foot'].heb;
        j[sd + 'ToeBase'].heb = 0;
        for (let n = 0; n < 5; n++) { j[sd + 'Foot'].heb = v; p.applyPoseFast(); v = clamp(v - (p.mpos(sd + 'ToeTip').y - p.mpos(sd + 'Heel').y) / .15 * 57.3, -50, 40); }
        j[sd + 'Foot'].heb = v;
      }
      holdWalkBake.push(JSON.parse(JSON.stringify(j)));
    }
  }
  const fr = holdWalkBake, x = (ph - Math.floor(ph)) * fr.length, a = Math.floor(x) % fr.length, f = x - Math.floor(x), A = fr[a], B = fr[(a + 1) % fr.length];
  for (const id in j) for (const k in j[id]) j[id][k] = A[id][k] + (B[id][k] - A[id][k]) * f;
}
function evalJump(name) {
  if (!jumpBake[name]) bakeJump(name);
  let boden = 0, beine = 0;
  for (const r of window.__jumpReport[name]) {
    boden += Math.max(0, -r.fussL) + Math.max(0, -r.fussR);
    if (!r.luft && name === 'sprung') beine += Math.max(0, Math.min(r.fussL, r.fussR) - .12);
  }
  const n = window.__jumpReport[name].length, cost = { boden: boden / n, beine: beine / n };
  return { total: cost.boden + cost.beine, cost };
}

// ---------- Optimierer: (mu/mu, lambda)-Evolutionsstrategie mit eigener Schrittweite je Uebung
function makeES(name, n, sigma, init, evalFn, g) {
  const m = init.slice();
  const best = evalFn(g, m);
  return { name, n, sigma, m, g, evalFn, gen: 0, best: m.slice(), bestScore: best.total, bestCost: best.cost, first: best.total, history: [best.total], pop: [] };
}
const randn = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(TAU * Math.random());
function stepES(es) {
  const L = 10, MU = 3, cand = [];
  for (let i = 0; i < L; i++) {
    const x = es.m.map(v => v + es.sigma * randn());
    cand.push({ x, ...es.evalFn(es.g, x) });
  }
  cand.sort((a, b) => a.total - b.total);
  const nm = new Array(es.n).fill(0);
  for (let i = 0; i < MU; i++) for (let k = 0; k < es.n; k++) nm[k] += cand[i].x[k] / MU;
  const here = es.evalFn(es.g, es.m).total;
  es.sigma *= cand[0].total < here ? 1.06 : 0.97;
  es.sigma = clamp(es.sigma, 0.02, 12);
  es.m = nm; es.gen++;
  if (cand[0].total < es.bestScore - 1e-4) { es.bestScore = cand[0].total; es.best = cand[0].x.slice(); es.bestCost = cand[0].cost; es.stuck = 0; }
  else es.stuck = (es.stuck || 0) + 1;
  // Stillstand: vom Besten aus neu suchen, abwechselnd fein und grob
  if (es.stuck > 150) { es.stuck = 0; es.m = es.best.slice(); es.kick = ((es.kick || 0) + 1) % 3; es.sigma = [0.5, 1.5, 4][es.kick]; }
  if (es.gen % 5 === 0) es.history.push(es.bestScore);
}

// Start: steife Haltung, damit man das Lernen sieht
const stiff = () => { const t = new Array(NPAR).fill(0); t[0] = 5; t[7] = 8; const o = 21; t[o] = -2; t[o + 5] = 2; t[o + 6] = 2; t[o + 8] = 10; return t; };
const ES = {
  gehen: makeES('gehen', NPAR, 3, stiff(), evalGait, GAITS.gehen),
  laufen: makeES('laufen', NPAR, 3, stiff(), evalGait, GAITS.laufen),
  sprinten: makeES('sprinten', NPAR, 3, stiff(), evalGait, GAITS.sprinten),
  dribbeln: makeES('dribbeln', NPAR, 3, stiff(), evalGait, GAITS.dribbeln),
  aufstehen: makeES('aufstehen', 0, 1, [], evalUp, null),
  rueckwaerts: makeES('rueckwaerts', 0, 1, [], () => evalCycle('rueckwaerts'), null),
  seitwaerts: makeES('seitwaerts', 0, 1, [], () => evalCycle('seitwaerts'), null),
  rueckwaerts_gehen: makeES('rueckwaerts_gehen', 0, 1, [], () => evalCycle('rueckwaerts_gehen'), null),
  seitwaerts_gehen: makeES('seitwaerts_gehen', 0, 1, [], () => evalCycle('seitwaerts_gehen'), null),
  seitwaerts_laufen: makeES('seitwaerts_laufen', 0, 1, [], () => evalCycle('seitwaerts_laufen'), null),
  fangen: makeES('fangen', 0, 1, [], () => evalJump('fangen'), null),
  fangen_flach: makeES('fangen_flach', 0, 1, [], () => evalJump('fangen_flach'), null),
  fangen_hoch: makeES('fangen_hoch', 0, 1, [], () => evalJump('fangen_hoch'), null),
  halten: makeES('halten', 0, 1, [], () => evalJump('halten'), null),
  halten_gehen: makeES('halten_gehen', 0, 1, [], () => ({ total: 0, cost: {} }), null),
  sprung: makeES('sprung', 0, 1, [], () => evalJump('sprung'), null),
  sprung_lauf: makeES('sprung_lauf', 0, 1, [], () => evalJump('sprung_lauf'), null),
};
const NAMES = { gehen: 'Gehen', laufen: 'Laufen', sprinten: 'Sprinten', dribbeln: 'Dribbeln', aufstehen: 'Aufstehen', rueckwaerts: 'Rückwärts', seitwaerts: 'Seitwärts', rueckwaerts_gehen: 'Rückwärts gehen', seitwaerts_gehen: 'Seitwärts gehen', seitwaerts_laufen: 'Seitwärts laufen', fangen: 'Fangen', fangen_flach: 'Fangen flach', fangen_hoch: 'Fangen hoch', halten: 'Ball halten', halten_gehen: 'Gehen mit Ball', sprung: 'Sprung', sprung_lauf: 'Sprung aus dem Lauf' };
const COST_NAMES = { abrollen: 'rollt nicht ab', beine: 'Beine in der Luft', arme: 'Arme stützen nicht', knie: 'nicht übers Knie', koerper: 'Körper geht nicht mit', oberkoerper: 'Oberkörper-Neigung', ellbogen: 'Ellbogen', oberschenkel: 'Oberschenkel', armschwung: 'Armschwung', soll: 'Knie und Fuß', boden: 'im Boden', boden2: 'schwebt', rutschen: 'Fuß rutscht', stand: 'Standzeit', hub: 'Becken-Hub', glatt: 'Knicke', flug: 'Flugphase', fusshoehe: 'Fuß zu hoch', stuetze: 'kein Halt', schweben: 'schwebt', fuss: 'Fuß rutscht', abweichung: 'Abweichung' };

// ---------- Anzeige
const box = document.createElement('div');
box.style.cssText = 'position:fixed;left:12px;top:12px;width:400px;z-index:50;background:#fff;color:#222;border:1px solid #bbb;border-radius:8px;padding:12px;font:13px system-ui';
box.innerHTML = `<b style="font-size:15px">Bewegungs-Training</b><div id="trTime" style="margin:4px 0 8px;color:#555"></div>
  <div id="trTabs" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px"></div><canvas id="trG" width="376" height="90" style="border:1px solid #ddd;width:100%"></canvas><div id="trInfo" style="margin-top:6px"></div>
  <div style="margin-top:8px;color:#666;font-size:11px">Optimierung an Messkurven und Regeln, keine Physik. Die Kurve zeigt die verbleibenden Fehlerpunkte: niedriger ist besser.</div>`;
document.body.appendChild(box);
let show = 'gehen', auto = true, lastSwitch = performance.now();
for (const k in ES) {
  const b = document.createElement('button'); b.textContent = NAMES[k]; b.className = 'b'; b.dataset.k = k;
  b.onclick = () => { show = k; auto = false; };
  box.querySelector('#trTabs').appendChild(b);
}
const autoB = document.createElement('button'); autoB.textContent = 'Wechseln'; autoB.className = 'b'; autoB.onclick = () => { auto = true; }; box.querySelector('#trTabs').appendChild(autoB);
function drawInfo() {
  const es = ES[show], c = box.querySelector('#trG').getContext('2d'), h = es.history, W = 376, H = 90;
  c.clearRect(0, 0, W, H); c.strokeStyle = '#2a7'; c.lineWidth = 2; c.beginPath();
  const lg = v => Math.log10(Math.max(v, 1e-3)), max = lg(h[0]), min = lg(Math.min(...h));
  h.forEach((v, i) => { const x = i / Math.max(1, h.length - 1) * W, y = H - 6 - (lg(v) - min) / Math.max(0.01, max - min) * (H - 12); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
  const left = Math.max(0, MINUTES * 60 - (performance.now() - t0) / 1000);
  box.querySelector('#trTime').textContent = left > 0 ? `Läuft noch ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} Min.` : 'Training beendet, das Ergebnis ist gespeichert.';
  for (const b of box.querySelectorAll('#trTabs button')) b.style.fontWeight = b.dataset.k === show ? '700' : '400';
  const rows = Object.entries(es.bestCost).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${COST_NAMES[k] || k}</td><td style="text-align:right">${v.toFixed(3)}</td></tr>`).join('');
  box.querySelector('#trInfo').innerHTML = `<b>${NAMES[show]}</b>: Runde ${es.gen}, Fehler ${es.bestScore.toFixed(3)} (Start ${es.first.toFixed(2)})<table style="width:100%;margin-top:4px">${rows}</table>`;
}

// ---------- Speichern als Gelenkpuppen-Datei mit Keys (Bewegung im Editor abspielbar)
const clone = o => JSON.parse(JSON.stringify(o));
async function saveAll(final, only) {
  const status = {};
  for (const k of only ? [].concat(only) : Object.keys(ES)) {
    const es = ES[k], cyc = CYCLES[k], jmp = JUMPS[k], keys = [], F = k === 'aufstehen' ? 150 : jmp ? Math.round(jmp.period * 30) : 32, N = k === 'aufstehen' ? 32 : jmp ? F : 16;
    const period = k === 'aufstehen' ? 5 : k === 'halten_gehen' ? 1.05 : jmp ? jmp.period : cyc ? cyc.period : es.g.period;
    for (let i = 0; i <= N; i++) {
      const ph = i / N;
      if (k === 'aufstehen') setUp(es.best, ph); else if (k === 'halten_gehen') { if (i === 0) holdWalkBake = null; setHoldWalk(ph); } else if (jmp) setJump(k, ph); else if (cyc) setCycle(k, ph); else { resetPose(); setGait(es.best, ph, es.g); }
      keys.push({ frame: Math.round(ph * F), winkel: clone(p.pose.j) });
    }
    const body = { format: 'gelenkpuppe', version: 1, name: RUN + k, beschreibung: `Training ${NAMES[k]}, Runde ${es.gen}, Fehler ${es.bestScore.toFixed(3)} (Start ${es.first.toFixed(2)})`, fps: Math.round(F / period), laenge_bilder: F, gespeichert: new Date().toISOString(), parameter: es.best, keys };
    status[k] = { runde: es.gen, fehler: es.bestScore, start: es.first, kosten: es.bestCost };
    await fetch('/api/posen/' + RUN + k, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  }
  window.__training = { status, final: !!final };
  return status;
}

// ---------- Schleife: rechnen, dann die beste Bewegung zeigen
const t0 = performance.now();
let lastSave = t0, finished = false, order = Object.keys(ES).filter(k => k !== 'aufstehen' && k !== 'halten_gehen' && !CYCLES[k] && !JUMPS[k]), oi = 0;
const anim0 = performance.now();
p.opts.ground = false;
function compute() {
  const left = MINUTES * 60 - (performance.now() - t0) / 1000;
  if (left <= 0) { if (!finished) { finished = true; if (loadOk) saveAll(true, order); } return; }
  const until = performance.now() + 60;
  while (performance.now() < until) { stepES(ES[order[oi]]); oi = (oi + 1) % order.length; }
  if (performance.now() - lastSave > 60000) { lastSave = performance.now(); if (loadOk) saveAll(false, order); }   // nur Gelerntes speichern, nie die festen Bewegungen eines alten Tabs
}
let camZ = 0;
function hideHandles() {
  p.scene.traverse(o => { if (o.isMesh && o.geometry?.type === 'SphereGeometry' && [0.02, 0.028].includes(o.geometry.parameters.radius)) o.visible = false; });
}
let camX = 0, sideView = false;
function display() {
  if (auto && performance.now() - lastSwitch > 10000) { lastSwitch = performance.now(); const o = Object.keys(ES); show = o[(o.indexOf(show) + 1) % o.length]; }
  const es = ES[show], t = (performance.now() - anim0) / 1000, j = p.pose.j, c = CYCLES[show];
  let tx = 0, tz = 0;
  if (show === 'aufstehen') { const u = t / 5 % 1.2; setUp(es.best, Math.min(u, 1)); tz = j.Hips.z / 100; }
  else if (show === 'halten_gehen') { setHoldWalk((t / 1.05) % 1); j.Hips.z = ((t * 140) % 200) - 100; tz = j.Hips.z / 100; }
  else if (JUMPS[show]) { const P = JUMPS[show].period, u = t / P % 1.25; setJump(show, Math.min(u, 1)); tz = j.Hips.z / 100; }
  else if (c) {
    setCycle(show, (t / c.period) % 1);
    // Der Koerper kommt wirklich voran
    const w = c.dir * (((t * c.speed * 100) % 200) - 100);
    j.Hips[c.axis] += w;
    if (c.axis === 'x') tx = w / 100; else tz = w / 100;
  } else {
    resetPose(); setGait(es.best, (t / es.g.period) % 1, es.g);
    j.Hips.z = ((t * es.g.speed * 100) % 200) - 100; tz = j.Hips.z / 100;
  }
  p.applyPose();
  // Seitwaerts sieht man von vorn am besten, sonst von der Seite; die Kamera laeuft mit
  const wantSide = show.startsWith('seitwaerts');
  if (wantSide !== sideView) { sideView = wantSide; p.setView(wantSide ? 'front' : 'left'); camX = tx; camZ = tz; }
  const dx = tx - camX, dz = tz - camZ;
  camX = tx; camZ = tz;
  p.camera.position.x += dx; p.orbit.target.x += dx; p.camera.position.z += dz; p.orbit.target.z += dz; p.orbit.update();
  hideHandles();
}
// Neuer Start: beim gespeicherten Stand weitermachen und aeltere Tabs anhalten
let stopped = false;
const chan = new BroadcastChannel('puppe-training');
chan.onmessage = () => { stopped = true; box.querySelector('#trTime').textContent = 'Angehalten: ein neuerer Lauf rechnet in einem anderen Tab.'; };
chan.postMessage('neu');
let loadOk = false, pendingLoads = order.length;
const loadDone = () => { if (--pendingLoads === 0 && !loadFailed) loadOk = true; };
let loadFailed = false;
for (const k of order) fetch('/api/posen/' + RUN + k).then(r => r.ok ? r.json() : null).then(d => {
  const es = ES[k];
  // Datei da, aber unpassend: nichts ueberschreiben
  if (d && (!d.parameter || d.parameter.length !== es.n)) { loadFailed = true; box.querySelector('#trTime').textContent = 'Gespeicherter Stand passt nicht: es wird nichts gespeichert.'; loadDone(); return; }
  if (!d) { loadDone(); return; }
  const r = es.evalFn(es.g, d.parameter);
  es.m = d.parameter.slice(); es.best = d.parameter.slice(); es.bestScore = r.total; es.bestCost = r.cost; es.history.push(r.total); holdWalkBake = null;
  loadDone();
}).catch(() => { loadFailed = true; loadDone(); });
setInterval(() => { if (!stopped) compute(); }, 90);
(function loop() { display(); drawInfo(); requestAnimationFrame(loop); })();
p.setView('left');
window.__trainingES = ES;
window.__trainingSave = saveAll;
