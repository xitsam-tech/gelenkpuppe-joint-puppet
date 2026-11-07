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
    arm: 26, elbow: 92, flight: 0.2,
  },
  // Sprint: kurzer Bodenkontakt auf dem Vorfuss, lange Flugphase, Knie hoch vorn, Ferse schwingt zum Gesaess, grosser Armeinsatz mit Ellbogen ~90
  sprinten: {
    title: 'Sprinten', speed: 7.5, period: 0.47, duty: 0.23, bob: 0.06, lift: 0.62, trunk: 12, hipY: -6, pelvis: 7, chest: 15, shift: .4, tilt: 1.5, curl: 30, elbowAmp: 18, forefoot: true,
    hip: curve([[0, 32], [.12, 8], [.23, -16], [.4, 10], [.6, 58], [.78, 74], [.92, 52], [1, 32]]),
    knee: curve([[0, 28], [.08, 42], [.23, 20], [.42, 95], [.55, 125], [.75, 95], [.92, 35], [1, 28]]),
    ankle: curve([[0, 2], [.08, 14], [.23, -32], [.4, -14], [.8, 6], [1, 2]]),
    arm: 40, elbow: 88, flight: 0.5,
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
  // Laufstil nach Lauftechnik-Quellen (Nutzer: "rudert", Arme naeher am Koerper): Oberarm pendelt fast genau vor/zurueck
  // (vorn leicht zur Mitte, ohne sie zu kreuzen; hinten kaum nach aussen), Hand von der Huefte bis zur Brust, hinten etwas weiter
  // als vorn; Ellbogen um 90 und im Takt mit dem Oberarm (vorn etwas mehr gebeugt). Der fruehere Versatz des Ellbogens
  // (Phase -0,6) liess die Hand eine Schleife ziehen, die Ebene +-72 und 6 Grad Grundabspreizung hielten die Arme vom Koerper weg.
  const armAt = (s, f) => {
    const a = TAU * f + armPhase, raw = th[r + 1] * Math.sin(a), sw = raw >= 0 ? raw * 0.85 : raw * 1.1;
    j[s + 'Arm'].ebene = sw >= 0 ? 100 : -88; j[s + 'Arm'].heben = clamp(Math.abs(sw) + 2, 0, 120);
    j[s + 'Arm'].dreh = -14;   // leicht innenrotiert: Unterarm zeigt vor den Koerper, Haende pendeln zur Mitte (nicht darueber)
    const eAmp = Math.min(10, Math.abs(th[r + 4]));
    j[s + 'ForeArm'].beug = clamp(th[r + 3] + eAmp * raw / (Math.abs(th[r + 1]) || 1), 0, 140);
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
  // Feldspieler, Schiedsrichter, Linienrichter (Nutzer: "kein Moonwalking"): aufrecht statt Torwart-Hocke.
  // Rueckwaerts gehen: kurze Schritte (~0,43 m), Vorfuss zuerst, Rumpf kaum vor, Arme locker.
  rueckwaerts_gehen: { axis: 'z', dir: -1, speed: 1.0, period: .85, duty: .6, lift: .045, drop: .02, bob: .02, trunk: 5, elbow: 22, amp: 14, base: [0, 0], curl: 22, ball: .012, pelvis: 3 },
  // Seitwaerts gehen (Nachstellschritt): Fuesse 0,15 bis 0,65 m auseinander, nie gekreuzt; Arme haengen fast am Koerper
  seitwaerts_gehen: { axis: 'x', dir: 1, speed: 1.0, period: .5, duty: .6, lift: .04, drop: .03, bob: .015, trunk: 3, elbow: 20, amp: 3, base: [.2, -.2], curl: 22, ball: 0, pelvis: 0, armUp: 9 },
  // Seitwaerts laufen (Linienrichter, Sidestep im Lauf): Fuesse 0,2 bis 0,75 m, kurzer Flug, Arme zur Balance leicht ab, Ellbogen gebeugt
  seitwaerts_laufen: { axis: 'x', dir: 1, speed: 2.6, period: .36, duty: .32, lift: .07, drop: .05, bob: .035, trunk: 6, elbow: 75, amp: 8, base: [.24, -.24], curl: 45, ball: .02, pelvis: 0, armUp: 18 },
  // Humpeln (Schonhinken, linkes Bein verletzt; rechts = gespiegelt): kurze Standphase auf dem verletzten Bein (Einzelstand 0,36
  // gegen 0,5 des Zyklus), Fuss setzt flach auf und hebt kaum (steifes Knie, leicht im Bogen nach aussen), Oberkoerper neigt sich
  // waehrend des Stands ueber das verletzte Bein (entlastet die Huefte), beim Auftreten aufs gesunde Bein sackt das Becken ab.
  // Langsam: 0,9 m/s. duty/lift je Seite [links, rechts].
  humpeln: { axis: 'z', dir: 1, speed: .9, period: 1.1, duty: [.5, .64], lift: [.025, .06], drop: .045, bob: 0, dip: .018, trunk: 6, elbow: 20, amp: 12, base: [0, 0], curl: 25, ball: 0, pelvis: 3, lean: 7, circ: .04, limp: 0 },
};
const cycleBake = {};
function bakeCycle(name) {
  const c = CYCLES[name], j = p.pose.j, F = 24;
  // je Seite eigener Standanteil und Fusshub (Humpeln), sonst fuer beide gleich
  const duty = i => Array.isArray(c.duty) ? c.duty[i] : c.duty, lift = i => Array.isArray(c.lift) ? c.lift[i] : c.lift;
  const Sd = i => c.speed * c.period * duty(i);
  p.opts.ground = false;
  resetPose(); p.applyPoseFast();
  const H0 = p.wpos('Hips').clone(), ankle = p.wpos('LeftFoot').y - Math.min(p.mpos('LeftHeel').y, p.mpos('LeftToeTip').y);
  const spread = Math.abs(p.wpos('LeftFoot').x) * 0.8, standY = H0.y - p.wpos('LeftFoot').y + ankle - 0.005;
  const L1 = p.wpos('LeftUpLeg').distanceTo(p.wpos('LeftLeg')), L2 = p.wpos('LeftLeg').distanceTo(p.wpos('LeftFoot'));
  const footAt = (i, ph) => {            // Lage des Fusses relativ zur Koerpermitte
    const q = ph - Math.floor(ph), d = duty(i), S = Sd(i);
    if (q < d) return { a: c.dir * (S / 2 - S * (q / d)), y: 0, stance: true, u: q / d };
    const v = (q - d) / (1 - d), sm = v * v * (3 - 2 * v);
    return { a: c.dir * (-S / 2 + S * sm), y: lift(i) * Math.sin(Math.PI * v), stance: false, u: v };
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
    // Humpeln: Neigung ueber das verletzte Bein waehrend seines Stands, Absacken beim Auftreten aufs gesunde Bein
    if (c.limp !== undefined) {
      const fi = footAt(c.limp, ph + (c.limp ? .5 : 0)), fh = footAt(1 - c.limp, ph + (c.limp ? 0 : .5));
      const wi = fi.stance ? Math.sin(Math.PI * fi.u) : 0, wh = fh.stance ? Math.sin(Math.PI * Math.min(1, fh.u * 2)) : 0;
      const sgn = c.limp === 0 ? 1 : -1;   // seit + = nach links
      j.Hips.y -= c.dip * wh * 100;
      j.Spine.seit = sgn * c.lean * wi * .4; j.Spine1.seit = sgn * c.lean * wi * .6; j.Neck.seit = -sgn * c.lean * wi * .5;
    }
    j.Hips.vor = c.trunk * .5; j.Spine.beug = c.trunk * .25; j.Spine1.beug = c.trunk * .15; j.Spine2.beug = c.trunk * .1;
    const pelvis = c.pelvis * tw;
    j.Hips.dreh = pelvis; j.Spine1.dreh = clamp(-pelvis * .9, -12, 12); j.Spine2.dreh = clamp(-pelvis * .9, -15, 15);
    const yaw = pelvis + j.Spine1.dreh + j.Spine2.dreh;
    j.Neck.dreh = clamp(-yaw, -50, 50);
    j.Neck.beug = -c.trunk * .6; j.Head.beug = -c.trunk * .4;
    if (c.axis === 'z') j.Hips.x = 1.2 * sn; else { j.Hips.seit = 1.5 * sn; j.Neck.seit = -1.5 * sn; }
    setHands(c.curl);
    const feet = {};
    [['Left', 1, 0, 0], ['Right', -1, 1, c.offset ?? .5]].forEach(([sd, sg, bi, off]) => {
      const f = footAt(bi, ph + off); feet[sd] = f;
      const lateral = c.axis === 'x' ? c.base[bi] + f.a : sg * (spread + (c.limp === bi && !f.stance ? (c.circ || 0) * Math.sin(Math.PI * f.u) : 0));
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
      const sw = c.axis === 'z' ? c.amp * feet[other].a / (Sd(other === 'Left' ? 0 : 1) / 2) : c.amp * (sd === 'Left' ? sn : -sn);
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

// ---------- Moves (Tricks und Akrobatik): Schluesselhaltungen mit Zeit, Becken und Gelenkwinkeln, weich ueberblendet.
// Gelenke: Catmull-Rom je Freiheitsgrad; Beckendrehung als Quaternion (Slerp), damit Saltos und Rollen sauber laufen.
// boden: true = tiefster Punkt der Koerperflaechen liegt auf dem Boden (Stand, Liegen); false = Flug: Beckenhoehe als Wurfparabel
// (g = 9,81) zwischen dem letzten Bodenbild davor und dem ersten danach. fest: ['Left'|'Right'] haelt den Fuss an der Stelle,
// an der er beim ersten Bild dieses Abschnitts stand (Bein-IK), damit er nicht rutscht.
// Achsen der Puppe: +x links, +z vorn, +y oben; Becken vor + = vorneigen, seit + = nach links kippen, dreh + = nach links drehen.
// Quellen: Shan 2008 (ISBS, Fallrueckzieher und Seitfallzieher, 3D-Messung), Duarte (UFABC, Pele), Trainerbeschreibungen Uebersteiger.
const DEGR = Math.PI / 180;
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qAx = (x, y, z, deg) => { const h = deg * DEGR / 2, s = Math.sin(h); return [x * s, y * s, z * s, Math.cos(h)]; };
// wie templQ der Puppe: qa(AY, dreh) * qa(AX, vor) * qa(AZ, -seit)
const hipsQ = h => qMul(qMul(qAx(0, 1, 0, h.dreh || 0), qAx(1, 0, 0, h.vor || 0)), qAx(0, 0, 1, -(h.seit || 0)));
function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], bb = b;
  if (d < 0) { d = -d; bb = b.map(v => -v); }
  if (d > 0.9995) { const r = a.map((v, i) => v + (bb[i] - v) * t), n = Math.hypot(...r); return r.map(v => v / n); }
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + bb[i] * wb);
}
// Quaternion -> (dreh, vor, seit) fuer R = Ry * Rx * Rz
function hipsEuler(q) {
  const [x, y, z, w] = q;
  const m12 = 2 * (y * z - w * x), m02 = 2 * (x * z + w * y), m22 = 1 - 2 * (x * x + y * y), m10 = 2 * (x * y + w * z), m11 = 1 - 2 * (x * x + z * z);
  const ex = Math.asin(clamp(-m12, -1, 1));
  let ey, ez;
  if (Math.abs(m12) < 0.99999) { ey = Math.atan2(m02, m22); ez = Math.atan2(m10, m11); }
  else { ey = Math.atan2(-(2 * (x * z - w * y)), 1 - 2 * (y * y + z * z)); ez = 0; }
  return { dreh: ey / DEGR, vor: ex / DEGR, seit: -ez / DEGR };
}
const cat = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };

// Haltung aus Teil-Angaben: fehlende Gelenke = Grundstellung (Arme locker, Knie leicht gebeugt), Haende locker
function movePose(J) {
  const o = {};
  for (const j of p.J) { o[j.id] = {}; for (const f of j.dofs) o[j.id][f.k] = 0; }
  for (const sd of ['Left', 'Right']) { o[sd + 'Arm'].ebene = 20; o[sd + 'Arm'].heben = 8; o[sd + 'ForeArm'].beug = 20; }
  for (const id in J) for (const k in J[id]) o[id][k] = J[id][k];
  return o;
}
// Endhaltung = Anfang des Aufstehens (Rueckenlage, posen/training3_aufstehen.json Key 0), damit das Spiel nahtlos weitermacht
const LIE_BACK = {
  Neck: { beug: 12 }, Head: { beug: 6 },
  LeftArm: { ebene: -83.8, heben: 18.4 }, RightArm: { ebene: -83.8, heben: 18.4 }, LeftForeArm: { beug: 18.2 }, RightForeArm: { beug: 18.2 },
  LeftUpLeg: { beug: 25.54 }, RightUpLeg: { beug: 25.54 }, LeftLeg: { beug: 43.04 }, RightLeg: { beug: 43.04 },
};
const LIE_BACK_H = { x: 0, z: 0.5, vor: -86, seit: 0, dreh: 0 };
const L = (o) => o;   // nur zur Lesbarkeit der Tabellen

const MOVES = {
  // Uebersteiger rechts (Trainer: Oberkoerper taeuscht zur einen Seite, der Fuss kreist von innen nach aussen ueber den Ball,
  // Abdruck vom Taeuschungsbein, weg zur anderen Seite; Tempowechsel). Ball liegt ~0,55 m vor dem Koerper.
  uebersteiger: {
    period: 0.8, fusshaltung: true,
    // Ball liegt beim Trick ~0,40 m vor dem Koerper (das Spiel holt ihn dafuer heran). Rechter Fuss (Sprunggelenk, Stand 0,18 m hoch)
    // kommt innen hinter dem Ball hoch, kreist vorn ueber den Ball nach aussen und setzt rechts daneben auf.
    keys: [
      { t: 0, boden: true, H: { x: 0, z: 0, vor: 8 }, ik: { Right: [-0.11, 0.18, -0.03] }, J: L({ LeftUpLeg: { beug: 18 }, LeftLeg: { beug: 25 }, RightUpLeg: { beug: 18 }, RightLeg: { beug: 25 }, Spine: { beug: 4 }, LeftArm: { ebene: 20, heben: 22 }, RightArm: { ebene: 20, heben: 22 }, LeftForeArm: { beug: 60 }, RightForeArm: { beug: 60 } }), fest: ['Left'] },
      { t: 0.14, boden: true, H: { x: 3, z: 2, vor: 10, dreh: 6 }, ik: { Right: [0.02, 0.30, 0.20] }, J: L({ LeftUpLeg: { beug: 22 }, LeftLeg: { beug: 32 }, Spine: { beug: 5 }, LeftArm: { ebene: 10, heben: 30 }, RightArm: { ebene: 30, heben: 20 }, LeftForeArm: { beug: 55 }, RightForeArm: { beug: 60 } }), fest: ['Left'] },
      // Fuss kreist vorn ueber den Ball nach aussen, Oberkoerper und Schultern kippen nach rechts (Taeuschung)
      { t: 0.30, boden: true, H: { x: -3, z: 4, vor: 10, seit: -8, dreh: -12 }, ik: { Right: [-0.10, 0.36, 0.50] }, J: L({ LeftUpLeg: { beug: 24 }, LeftLeg: { beug: 34 }, Spine: { seit: -6, dreh: -6 }, Spine1: { seit: -4, dreh: -6 }, LeftArm: { ebene: 0, heben: 42 }, RightArm: { ebene: 10, heben: 25 }, LeftForeArm: { beug: 45 }, RightForeArm: { beug: 55 }, Neck: { dreh: -10 } }), fest: ['Left'] },
      // Fuss setzt rechts neben dem Ball auf, Gewicht geht rueber, tief in die Knie
      { t: 0.46, boden: true, H: { x: -12, z: 6, vor: 12, seit: -10, dreh: -16 }, ik: { Right: [-0.36, 0.18, 0.32] }, J: L({ LeftUpLeg: { beug: 26, spreiz: 12 }, LeftLeg: { beug: 36 }, Spine: { seit: -5, dreh: -5 }, Spine1: { seit: -4, dreh: -5 }, LeftArm: { ebene: 0, heben: 45 }, RightArm: { ebene: 10, heben: 25 }, LeftForeArm: { beug: 40 }, RightForeArm: { beug: 55 }, Neck: { dreh: -8 } }) },
      // Abdruck rechts, Koerper schiesst nach links, linkes Bein tritt nach links vorn
      { t: 0.62, boden: true, H: { x: 8, z: 12, vor: 14, seit: 8, dreh: 14 }, ik: { Right: [-0.36, 0.20, 0.30] }, J: L({ LeftUpLeg: { beug: 42, spreiz: 10, dreh: 8 }, LeftLeg: { beug: 50 }, Spine: { seit: 4, dreh: 6 }, LeftArm: { ebene: 30, heben: 30 }, RightArm: { ebene: -10, heben: 35 }, LeftForeArm: { beug: 60 }, RightForeArm: { beug: 60 }, Neck: { dreh: 8 } }) },
      { t: 0.8, boden: true, H: { x: 10, z: 18, vor: 9, seit: 2, dreh: 6 }, ik: { Right: [-0.04, 0.24, 0.22] }, J: L({ LeftUpLeg: { beug: 22 }, LeftLeg: { beug: 30 }, Spine: { beug: 4 }, LeftArm: { ebene: 20, heben: 22 }, RightArm: { ebene: 20, heben: 22 }, LeftForeArm: { beug: 60 }, RightForeArm: { beug: 60 } }) },
    ],
  },
  // Seitfallzieher mit rechts, Ziel links (+x). Shan 2008: vor dem Sprung Rumpf und Huefte vom Ziel weg gedreht; beim Absprung
  // hebt das Nicht-Schussbein, Rumpf und Huefte drehen zurueck zum Ziel, der Rumpf wird waagerecht; in der Luft beschreibt der
  // Schussfuss einen Regenbogen, der Koerper rollt zum Ziel. Schussfuss verlaesst den Boden zuletzt. Landung auf der linken Seite
  // (Hand, Unterarm, Huefte), dann auf den Ruecken rollen = Anfang des Aufstehens.
  seitfallzieher: {
    period: 1.45,
    keys: [
      { t: 0, boden: true, H: { x: 0, z: 0, vor: 6 }, J: L({ LeftUpLeg: { beug: 15 }, LeftLeg: { beug: 22 }, RightUpLeg: { beug: 15 }, RightLeg: { beug: 22 } }) },
      // ausholen: vom Ziel weg drehen, in die Knie
      { t: 0.20, boden: true, H: { x: -4, z: 0, vor: 10, dreh: -28, seit: -4 }, J: L({ LeftUpLeg: { beug: 40 }, LeftLeg: { beug: 55 }, RightUpLeg: { beug: 30 }, RightLeg: { beug: 45 }, Spine1: { dreh: -8 }, LeftArm: { ebene: -30, heben: 30 }, RightArm: { ebene: 40, heben: 30 }, LeftForeArm: { beug: 40 }, RightForeArm: { beug: 40 }, Neck: { dreh: 20 } }) },
      // Absprung: linkes Knie hoch, rechter Fuss drueckt als letzter ab, Rumpf dreht zum Ziel und kippt
      { t: 0.36, boden: true, H: { x: 0, z: 0, vor: -10, dreh: 30, seit: 30 }, J: L({ LeftUpLeg: { beug: 95, spreiz: 10 }, LeftLeg: { beug: 85 }, RightUpLeg: { beug: -10 }, RightLeg: { beug: 10 }, RightFoot: { heb: -35 }, LeftArm: { ebene: 0, heben: 85 }, RightArm: { ebene: 20, heben: 80 }, LeftForeArm: { beug: 25 }, RightForeArm: { beug: 25 }, Neck: { dreh: 30, seit: -15 } }) },
      // Treffpunkt: Koerper fast waagerecht auf der linken Seite, rechtes Bein schwingt gestreckt ueber den Ball, linkes Bein unten
      { t: 0.58, boden: false, H: { x: 6, z: 0, vor: 0, dreh: 90, seit: 72 }, J: L({ LeftUpLeg: { beug: -15, spreiz: -5 }, LeftLeg: { beug: 25 }, RightUpLeg: { beug: 85, spreiz: 25, dreh: -10 }, RightLeg: { beug: 5 }, RightFoot: { heb: -30 }, LeftArm: { ebene: -20, heben: 95 }, RightArm: { ebene: 30, heben: 70 }, LeftForeArm: { beug: 20 }, RightForeArm: { beug: 30 }, Neck: { seit: -30, beug: 10 }, Head: { seit: -10 } }) },
      // Ausschwingen, linke Hand faengt den Fall
      { t: 0.76, boden: false, H: { x: 14, z: 0, vor: 0, dreh: 90, seit: 84 }, J: L({ LeftUpLeg: { beug: 20 }, LeftLeg: { beug: 50 }, RightUpLeg: { beug: 60, spreiz: 5 }, RightLeg: { beug: 40 }, LeftArm: { ebene: 30, heben: 120 }, RightArm: { ebene: 40, heben: 50 }, LeftForeArm: { beug: 35 }, RightForeArm: { beug: 40 }, Neck: { seit: -30, beug: 15 } }) },
      // Landung auf der linken Seite: Unterarm, Huefte, Schulter
      { t: 0.92, boden: true, H: { x: 16, z: 0, vor: 0, dreh: 90, seit: 90 }, J: L({ LeftUpLeg: { beug: 35 }, LeftLeg: { beug: 60 }, RightUpLeg: { beug: 40, spreiz: 10 }, RightLeg: { beug: 55 }, LeftArm: { ebene: 60, heben: 100 }, RightArm: { ebene: 60, heben: 40 }, LeftForeArm: { beug: 70 }, RightForeArm: { beug: 50 }, Neck: { seit: -25, beug: 15 } }) },
      // auf den Ruecken rollen
      { t: 1.20, boden: true, H: LIE_BACK_H, J: LIE_BACK },
      { t: 1.45, boden: true, H: LIE_BACK_H, J: LIE_BACK },
    ],
  },
  // Fallrueckzieher mit rechts, Ziel hinten (-z). Duarte/Pele: ~0,3 s Absprung, ~0,5 s Luft bis zum Treffpunkt, Schwerpunkt +0,47 m,
  // Treffpunkt ~2,2 m hoch. Shan 2008: vor dem Absprung schwingt das Nicht-Schussbein zur Brust, der Rumpf wird waagerecht;
  // in der Luft bleibt das Schussknie gebeugt, waehrend das andere Bein gestreckt nach unten schwingt (Schere), kurz vor dem
  // Ballkontakt streckt das Schussknie peitschenartig. Arme seitlich zur Balance, Kopf ruhig, Blick am Ball.
  // Landung: Haende und Unterarme zuerst, dann Ruecken = Anfang des Aufstehens.
  fallrueckzieher: {
    period: 1.6,
    keys: [
      { t: 0, boden: true, H: { x: 0, z: 0, vor: 4 }, J: L({ LeftUpLeg: { beug: 15 }, LeftLeg: { beug: 22 }, RightUpLeg: { beug: 15 }, RightLeg: { beug: 22 } }) },
      // Absprungschritt: tief, Rumpf geht zurueck, Arme holen aus
      { t: 0.16, boden: true, H: { x: 0, z: 0, vor: -12 }, J: L({ LeftUpLeg: { beug: 45 }, LeftLeg: { beug: 65 }, RightUpLeg: { beug: 35 }, RightLeg: { beug: 55 }, LeftArm: { ebene: -40, heben: 35 }, RightArm: { ebene: -40, heben: 35 }, LeftForeArm: { beug: 40 }, RightForeArm: { beug: 40 }, Neck: { beug: 10 } }) },
      // Absprung: linkes Bein schwingt zur Brust, rechter Fuss drueckt als letzter ab, Rumpf kippt nach hinten
      { t: 0.30, boden: true, H: { x: 0, z: 0, vor: -45 }, J: L({ LeftUpLeg: { beug: 110 }, LeftLeg: { beug: 90 }, RightUpLeg: { beug: -5 }, RightLeg: { beug: 8 }, RightFoot: { heb: -40 }, LeftArm: { ebene: 0, heben: 80 }, RightArm: { ebene: 0, heben: 80 }, LeftForeArm: { beug: 20 }, RightForeArm: { beug: 20 }, Neck: { beug: 30 } }) },
      // Schere: linkes Bein streckt nach unten, rechtes Knie gebeugt kommt hoch
      { t: 0.46, boden: false, H: { x: 0, z: -4, vor: -95 }, J: L({ LeftUpLeg: { beug: 30 }, LeftLeg: { beug: 15 }, RightUpLeg: { beug: 105 }, RightLeg: { beug: 95 }, RightFoot: { heb: -20 }, LeftArm: { ebene: 0, heben: 90 }, RightArm: { ebene: 0, heben: 90 }, LeftForeArm: { beug: 15 }, RightForeArm: { beug: 15 }, Neck: { beug: 40 }, Head: { beug: 15 } }) },
      // Treffpunkt: Rumpf ueber die Waagerechte, rechtes Knie peitscht gestreckt ueber den Kopf
      { t: 0.58, boden: false, H: { x: 0, z: -8, vor: -118 }, J: L({ LeftUpLeg: { beug: -10 }, LeftLeg: { beug: 10 }, RightUpLeg: { beug: 118 }, RightLeg: { beug: 0 }, RightFoot: { heb: -35 }, LeftArm: { ebene: -10, heben: 95 }, RightArm: { ebene: -10, heben: 95 }, LeftForeArm: { beug: 15 }, RightForeArm: { beug: 15 }, Neck: { beug: 40 }, Head: { beug: 20 } }) },
      // Fallen: Beine kommen zurueck, Arme gehen zum Boden, um den Fall abzufangen
      { t: 0.80, boden: false, H: { x: 0, z: -12, vor: -98 }, J: L({ LeftUpLeg: { beug: 40 }, LeftLeg: { beug: 40 }, RightUpLeg: { beug: 70 }, RightLeg: { beug: 30 }, LeftArm: { ebene: -60, heben: 55 }, RightArm: { ebene: -60, heben: 55 }, LeftForeArm: { beug: 25 }, RightForeArm: { beug: 25 }, Neck: { beug: 35 }, Head: { beug: 15 } }) },
      // Landung: Haende/Unterarme und Schultern
      { t: 0.98, boden: true, H: { x: 0, z: -8, vor: -92 }, J: L({ LeftUpLeg: { beug: 45 }, LeftLeg: { beug: 55 }, RightUpLeg: { beug: 50 }, RightLeg: { beug: 50 }, LeftArm: { ebene: -80, heben: 30 }, RightArm: { ebene: -80, heben: 30 }, LeftForeArm: { beug: 25 }, RightForeArm: { beug: 25 }, Neck: { beug: 25 }, Head: { beug: 10 } }) },
      { t: 1.30, boden: true, H: LIE_BACK_H, J: LIE_BACK },
      { t: 1.60, boden: true, H: LIE_BACK_H, J: LIE_BACK },
    ],
  },
  // Hackentrick (Hackenpass nach hinten): rechtes Bein steigt ueber den Ball (~0,55 m vor dem Koerper), der Fuss setzt dahinter
  // an und die Ferse spielt den Ball nach hinten; Standbein links gebeugt, Blick zum Ball. Treffpunkt bei 0,36 s.
  hackentrick: {
    period: 0.68, fusshaltung: true,
    keys: [
      { t: 0, boden: true, H: { x: 0, z: 0, vor: 8 }, ik: { Right: [-0.11, 0.18, -0.03] }, J: L({ LeftUpLeg: { beug: 18 }, LeftLeg: { beug: 25 }, Spine: { beug: 4 }, Neck: { beug: 10 }, LeftArm: { ebene: 20, heben: 22 }, RightArm: { ebene: 20, heben: 22 }, LeftForeArm: { beug: 60 }, RightForeArm: { beug: 60 } }), fest: ['Left'] },
      { t: 0.14, boden: true, H: { x: 1, z: 3, vor: 12 }, ik: { Right: [-0.08, 0.32, 0.32] }, J: L({ LeftUpLeg: { beug: 24 }, LeftLeg: { beug: 32 }, Spine: { beug: 5 }, Neck: { beug: 20 }, LeftArm: { ebene: 0, heben: 35 }, RightArm: { ebene: -30, heben: 30 }, LeftForeArm: { beug: 50 }, RightForeArm: { beug: 45 } }), fest: ['Left'] },
      // Fuss ueber den Ball hinweg nach vorn
      { t: 0.26, boden: true, H: { x: 1, z: 6, vor: 14 }, ik: { Right: [-0.06, 0.27, 0.72] }, J: L({ LeftUpLeg: { beug: 28 }, LeftLeg: { beug: 38 }, Spine: { beug: 6 }, Neck: { beug: 25 }, LeftArm: { ebene: -10, heben: 40 }, RightArm: { ebene: -40, heben: 35 }, LeftForeArm: { beug: 45 }, RightForeArm: { beug: 40 } }), fest: ['Left'] },
      // Ferse trifft den Ball und spielt ihn nach hinten
      { t: 0.36, boden: true, H: { x: 1, z: 6, vor: 14 }, ik: { Right: [-0.06, 0.20, 0.60] }, J: L({ LeftUpLeg: { beug: 28 }, LeftLeg: { beug: 38 }, Spine: { beug: 6 }, Neck: { beug: 25 }, LeftArm: { ebene: -10, heben: 40 }, RightArm: { ebene: -40, heben: 35 }, LeftForeArm: { beug: 45 }, RightForeArm: { beug: 40 } }), fest: ['Left'] },
      // Ausschwingen: Ferse kommt hoch nach hinten
      { t: 0.48, boden: true, H: { x: 0, z: 4, vor: 12 }, ik: { Right: [-0.08, 0.34, 0.18] }, J: L({ LeftUpLeg: { beug: 24 }, LeftLeg: { beug: 32 }, Spine: { beug: 5 }, Neck: { beug: 15 }, LeftArm: { ebene: 10, heben: 30 }, RightArm: { ebene: -20, heben: 28 }, LeftForeArm: { beug: 55 }, RightForeArm: { beug: 50 } }), fest: ['Left'] },
      { t: 0.68, boden: true, H: { x: 0, z: 0, vor: 8 }, ik: { Right: [-0.11, 0.18, -0.02] }, J: L({ LeftUpLeg: { beug: 18 }, LeftLeg: { beug: 25 }, Spine: { beug: 4 }, Neck: { beug: 8 }, LeftArm: { ebene: 20, heben: 22 }, RightArm: { ebene: 20, heben: 22 }, LeftForeArm: { beug: 60 }, RightForeArm: { beug: 60 } }), fest: ['Left'] },
    ],
  },
  // Knierutscher (Torjubel): aus vollem Lauf erst das rechte, dann das linke Knie auf den Rasen, auf Knien und Schienbeinen
  // rutschen; Oberkoerper zurueck, Brust raus, Kopf im Nacken, Arme weit ausgebreitet; zum Schluss die Faeuste hoch (Arme im V).
  // Kniestand: Oberschenkel senkrecht (Huefte beug = Becken vor), Unterschenkel flach (Knie ~95), Fussspitzen gestreckt.
  // Das Spiel bewegt den Spieler selbst (Rutschen ~3,5 m), der Clip bleibt an Ort und Stelle.
  knierutscher: {
    period: 1.7,
    keys: [
      { t: 0, boden: true, hand: 40, H: { x: 0, z: 0, vor: 12 }, J: L({ LeftUpLeg: { beug: 45 }, LeftLeg: { beug: 40 }, RightUpLeg: { beug: -15 }, RightLeg: { beug: 70 }, LeftArm: { ebene: -60, heben: 25 }, RightArm: { ebene: 80, heben: 35 }, LeftForeArm: { beug: 90 }, RightForeArm: { beug: 90 } }) },
      { t: 0.16, boden: true, hand: 25, H: { x: 0, z: 0, vor: 5 }, J: L({ LeftUpLeg: { beug: 70 }, LeftLeg: { beug: 95 }, RightUpLeg: { beug: 5 }, RightLeg: { beug: 100 }, RightFoot: { heb: -40 }, LeftArm: { ebene: 20, heben: 45 }, RightArm: { ebene: 20, heben: 45 }, LeftForeArm: { beug: 60 }, RightForeArm: { beug: 60 } }) },
      { t: 0.32, boden: true, hand: 15, H: { x: 0, z: 0, vor: -8 }, J: L({ LeftUpLeg: { beug: -8 }, LeftLeg: { beug: 95 }, LeftFoot: { heb: -45 }, RightUpLeg: { beug: -8 }, RightLeg: { beug: 95 }, RightFoot: { heb: -45 }, Spine: { beug: -5 }, LeftArm: { ebene: 0, heben: 80 }, RightArm: { ebene: 0, heben: 80 }, LeftForeArm: { beug: 30 }, RightForeArm: { beug: 30 }, Neck: { beug: -10 } }) },
      { t: 0.70, boden: true, hand: 10, H: { x: 0, z: 0, vor: -12 }, J: L({ LeftUpLeg: { beug: -12 }, LeftLeg: { beug: 95 }, LeftFoot: { heb: -45 }, RightUpLeg: { beug: -12 }, RightLeg: { beug: 95 }, RightFoot: { heb: -45 }, Spine: { beug: -5 }, Spine1: { beug: -4 }, Spine2: { beug: -3 }, LeftArm: { ebene: -20, heben: 100 }, RightArm: { ebene: -20, heben: 100 }, LeftForeArm: { beug: 15 }, RightForeArm: { beug: 15 }, Neck: { beug: -15 }, Head: { beug: -5 } }) },
      { t: 1.15, boden: true, hand: 15, H: { x: 0, z: 0, vor: -12 }, J: L({ LeftUpLeg: { beug: -12 }, LeftLeg: { beug: 95 }, LeftFoot: { heb: -45 }, RightUpLeg: { beug: -12 }, RightLeg: { beug: 95 }, RightFoot: { heb: -45 }, Spine: { beug: -5 }, Spine1: { beug: -4 }, Spine2: { beug: -4 }, LeftArm: { ebene: -25, heben: 105 }, RightArm: { ebene: -25, heben: 105 }, LeftForeArm: { beug: 15 }, RightForeArm: { beug: 15 }, Neck: { beug: -20 }, Head: { beug: -6 } }) },
      { t: 1.40, boden: true, hand: 85, H: { x: 0, z: 0, vor: -12 }, J: L({ LeftUpLeg: { beug: -12 }, LeftLeg: { beug: 95 }, LeftFoot: { heb: -45 }, RightUpLeg: { beug: -12 }, RightLeg: { beug: 95 }, RightFoot: { heb: -45 }, Spine: { beug: -5 }, Spine1: { beug: -4 }, LeftArm: { ebene: 20, heben: 145 }, RightArm: { ebene: 20, heben: 145 }, LeftForeArm: { beug: 25 }, RightForeArm: { beug: 25 }, Neck: { beug: -14 }, Head: { beug: -5 } }) },
      { t: 1.70, boden: true, hand: 85, H: { x: 0, z: 0, vor: -12 }, J: L({ LeftUpLeg: { beug: -12 }, LeftLeg: { beug: 95 }, LeftFoot: { heb: -45 }, RightUpLeg: { beug: -12 }, RightLeg: { beug: 95 }, RightFoot: { heb: -45 }, Spine: { beug: -5 }, Spine1: { beug: -4 }, LeftArm: { ebene: 20, heben: 148 }, RightArm: { ebene: 20, heben: 148 }, LeftForeArm: { beug: 25 }, RightForeArm: { beug: 25 }, Neck: { beug: -15 }, Head: { beug: -5 } }) },
    ],
  },
  // ---------- Jubel (Torschuetze). hand = Fingerkruemmung (85 Faust), zeig = Zeigefinger gestreckt.
  // Zum Himmel zeigen: beide Arme vorn-oben (~150), Zeigefinger nach oben, Kopf im Nacken, Blick nach oben
  himmel: {
    period: 2.0,
    keys: [
      { t: 0, boden: true, hand: 30, H: { x: 0, z: 0 }, J: L({ LeftUpLeg: { beug: 5 }, LeftLeg: { beug: 8 }, RightUpLeg: { beug: 5 }, RightLeg: { beug: 8 } }) },
      { t: 0.35, boden: true, hand: 80, zeig: true, H: { x: 0, z: 0 }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, LeftArm: { ebene: 60, heben: 95 }, RightArm: { ebene: 60, heben: 95 }, LeftForeArm: { beug: 35, dreh: 30 }, RightForeArm: { beug: 35, dreh: 30 }, Neck: { beug: -10 } }) },
      { t: 0.75, boden: true, hand: 80, zeig: true, H: { x: 0, z: 0, vor: -3 }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, Spine: { beug: -3 }, Spine1: { beug: -2 }, LeftArm: { ebene: 70, heben: 150 }, RightArm: { ebene: 70, heben: 150 }, LeftForeArm: { beug: 12, dreh: 20 }, RightForeArm: { beug: 12, dreh: 20 }, Neck: { beug: -25 }, Head: { beug: -10 } }) },
      { t: 1.4, boden: true, hand: 80, zeig: true, H: { x: 0, z: 0, vor: -3 }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, Spine: { beug: -3 }, Spine1: { beug: -2 }, LeftArm: { ebene: 72, heben: 155 }, RightArm: { ebene: 72, heben: 155 }, LeftForeArm: { beug: 10, dreh: 20 }, RightForeArm: { beug: 10, dreh: 20 }, Neck: { beug: -28 }, Head: { beug: -10 } }) },
      { t: 2.0, boden: true, hand: 80, zeig: true, H: { x: 0, z: 0, vor: -3 }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, Spine: { beug: -3 }, Spine1: { beug: -2 }, LeftArm: { ebene: 72, heben: 155 }, RightArm: { ebene: 72, heben: 155 }, LeftForeArm: { beug: 10, dreh: 20 }, RightForeArm: { beug: 10, dreh: 20 }, Neck: { beug: -28 }, Head: { beug: -10 } }) },
    ],
  },
  // Aufs Wappen klopfen: rechte Faust klopft zweimal auf die linke Brust (Wappen) und bleibt dort; linke Faust hoch zu den Fans,
  // Kopf zu den Fans gedreht. Handgelenk-Ziele per Arm-IK (Brust vorn ~0,13 m vor der Koerpermitte auf 1,34 m).
  wappen: {
    period: 2.2,
    keys: [
      { t: 0, boden: true, hand: 40, H: { x: 0, z: 0 }, ikArm: { Left: [0.24, 0.98, 0.05], Right: [-0.24, 0.98, 0.05] }, J: L({ LeftUpLeg: { beug: 5 }, LeftLeg: { beug: 8 }, RightUpLeg: { beug: 5 }, RightLeg: { beug: 8 } }) },
      { t: 0.40, boden: true, hand: 85, H: { x: 0, z: 0 }, ikArm: { Left: [0.34, 1.75, 0.20], Right: [0.03, 1.32, 0.27] }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, Neck: { dreh: 12, beug: -5 } }) },
      { t: 0.58, boden: true, hand: 85, H: { x: 0, z: 0 }, ikArm: { Left: [0.36, 1.85, 0.20], Right: [0.05, 1.32, 0.19] }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, Neck: { dreh: 15, beug: -5 } }) },
      { t: 0.76, boden: true, hand: 85, H: { x: 0, z: 0 }, ikArm: { Left: [0.36, 1.85, 0.20], Right: [0.03, 1.32, 0.27] }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, Neck: { dreh: 15, beug: -5 } }) },
      { t: 0.94, boden: true, hand: 85, H: { x: 0, z: 0 }, ikArm: { Left: [0.36, 1.85, 0.20], Right: [0.05, 1.32, 0.19] }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, Neck: { dreh: 15, beug: -5 } }) },
      { t: 1.5, boden: true, hand: 85, H: { x: 0, z: 0 }, ikArm: { Left: [0.36, 1.86, 0.18], Right: [0.05, 1.32, 0.19] }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, Neck: { dreh: 18, beug: -8 } }) },
      { t: 2.2, boden: true, hand: 85, H: { x: 0, z: 0 }, ikArm: { Left: [0.36, 1.86, 0.18], Right: [0.05, 1.32, 0.19] }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, Neck: { dreh: 18, beug: -8 } }) },
    ],
  },
  // Applaus ueber dem Kopf (zu den Fans): Arme hoch, Haende klatschen fuenfmal ueber dem Kopf zusammen, zum Schluss offen oben
  klatschen: {
    period: 3.0,
    keys: [
      { t: 0, boden: true, hand: 30, H: { x: 0, z: 0 }, ikArm: { Left: [0.24, 0.98, 0.05], Right: [-0.24, 0.98, 0.05] }, J: L({ LeftUpLeg: { beug: 5 }, LeftLeg: { beug: 8 }, RightUpLeg: { beug: 5 }, RightLeg: { beug: 8 } }) },
      ...[0, 1, 2, 3, 4].flatMap(n => [
        { t: 0.45 + n * 0.46, boden: true, hand: 8, H: { x: 0, z: 0 }, ikArm: { Left: [0.27, 1.92, 0.14], Right: [-0.27, 1.92, 0.14] }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, Neck: { beug: -8 }, LeftForeArm: { dreh: -60 }, RightForeArm: { dreh: -60 } }) },
        { t: 0.68 + n * 0.46, boden: true, hand: 8, H: { x: 0, z: 0 }, ikArm: { Left: [0.04, 1.98, 0.16], Right: [-0.04, 1.98, 0.16] }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, Neck: { beug: -8 }, LeftForeArm: { dreh: -60 }, RightForeArm: { dreh: -60 } }) },
      ]),
      { t: 3.0, boden: true, hand: 8, H: { x: 0, z: 0 }, ikArm: { Left: [0.30, 1.92, 0.14], Right: [-0.30, 1.92, 0.14] }, J: L({ LeftUpLeg: { beug: 3 }, LeftLeg: { beug: 5 }, RightUpLeg: { beug: 3 }, RightLeg: { beug: 5 }, Neck: { beug: -8 }, LeftForeArm: { dreh: -60 }, RightForeArm: { dreh: -60 } }) },
    ],
  },
  // Flugzeug: im Laufschritt (gelernte Gangart laufen, 3,6 m/s), Arme waagerecht ausgebreitet wie Fluegel, Koerper legt sich
  // abwechselnd in die Kurve (Becken ~10, Brustkorb ~5 Grad seitlich). Schleife ueber zwei Laufzyklen.
  flugzeug: {
    period: 1.44, base: 'laufen',
    keys: [0, 0.36, 0.72, 1.08, 1.44].map((t, n) => ({ t, hand: 5, H: { seit: [10, 0, -10, 0, 10][n] },
      J: { LeftArm: { ebene: -5, heben: [80, 90, 100, 90, 80][n], dreh: 0 }, RightArm: { ebene: -5, heben: [100, 90, 80, 90, 100][n], dreh: 0 },
           LeftForeArm: { beug: 5, dreh: -40 }, RightForeArm: { beug: 5, dreh: -40 }, Spine1: { seit: [5, 0, -5, 0, 5][n] }, Neck: { seit: [-6, 0, 6, 0, -6][n] } } })),
  },

  // ================= Basketball (Rechtshaender). Quellen: siehe docs/quellen-sources.md, Abschnitt Basketball.
  // Ball (Durchmesser 24 cm) haelt das Spiel zwischen den Haenden bzw. an der rechten Hand; die Puppe stellt nur den Koerper.
  // ikRel = Handgelenk relativ zum Becken (m, +x links, +y oben, +z vorn); stand = Fuesse bleiben am Platz, Becken weicht aus. Becken (Hueftgelenkmitte) ~0,96 m hoch, Schulter ~0,48 m darueber.
  // Sprungwurf (Okazaki, Rodacki & Satern 2015): Ausholen mit ~65 Grad Kniebeugung, Ball an der Brust; Ball steigt zum Set Point ueber
  // der Stirn (Wurfellbogen unter dem Ball, Handgelenk zurueckgeklappt, Fuehrhand seitlich am Ball); Abwurf nahe dem hoechsten Punkt,
  // Wurfarm ~55 Grad ueber der Waagerechten fast gestreckt, danach klappt das Handgelenk nach vorn (Schwanenhals). Flug ~0,46 s (~26 cm).
  // Abwurf bei t = 0,65 s am hoechsten Punkt (Spiel: Ball verlaesst die rechte Hand).
  bb_sprungwurf: {
    period: 1.3, fusshaltung: true, stand: true,
    keys: [
      { t: 0, boden: true, hand: 15, H: { x: 0, z: 0, vor: 6 },
        ikRel: { Right: [-0.15, 0.24, 0.22], Left: [0.09, 0.28, 0.25] },
        J: L({ LeftUpLeg: { beug: 18, spreiz: 4 }, RightUpLeg: { beug: 18, spreiz: 4 }, LeftLeg: { beug: 25 }, RightLeg: { beug: 25 }, Spine: { beug: 4 },
               RightArm: { ebene: 70, heben: 30, dreh: 0 }, LeftArm: { ebene: 70, heben: 30 }, RightForeArm: { beug: 110, dreh: -30 }, LeftForeArm: { beug: 110, dreh: -40 }, RightHand: { beug: -20 } }) },
      // Ausholen: tief in die Knie, Rumpf vor, Ball sinkt Richtung Bauch
      { t: 0.26, boden: true, hand: 15, H: { x: 0, z: 0, vor: 14 },
        ikRel: { Right: [-0.15, 0.12, 0.24], Left: [0.09, 0.16, 0.27] },
        J: L({ LeftUpLeg: { beug: 58, spreiz: 4 }, RightUpLeg: { beug: 58, spreiz: 4 }, LeftLeg: { beug: 68 }, RightLeg: { beug: 68 }, LeftFoot: { heb: 14 }, RightFoot: { heb: 14 }, Spine: { beug: 8 },
               RightArm: { ebene: 70, heben: 25, dreh: 0 }, LeftArm: { ebene: 70, heben: 25 }, RightForeArm: { beug: 115, dreh: -30 }, LeftForeArm: { beug: 115, dreh: -40 }, RightHand: { beug: -25 }, Neck: { beug: -8 } }) },
      // Abdruck: Beine strecken, auf die Fussballen, Ball steigt vor dem Gesicht zum Set Point
      { t: 0.42, boden: true, hand: 15, H: { x: 0, z: 0, vor: 4 },
        ikRel: { Right: [-0.17, 0.62, 0.28], Left: [-0.01, 0.68, 0.30] },
        J: L({ LeftUpLeg: { beug: 10, spreiz: 3 }, RightUpLeg: { beug: 10, spreiz: 3 }, LeftLeg: { beug: 12 }, RightLeg: { beug: 12 }, LeftFoot: { heb: -35 }, RightFoot: { heb: -35 },
               RightArm: { ebene: 100, heben: 75, dreh: 0 }, LeftArm: { ebene: 70, heben: 90, dreh: -20 }, RightForeArm: { beug: 100, dreh: -60 }, LeftForeArm: { beug: 100, dreh: -10 }, RightHand: { beug: -55 }, Neck: { beug: -6 } }) },
      // Set Point in der Luft ("L"): Oberarm nach vorn etwa waagerecht, Unterarm senkrecht, Ellbogen unter dem Ball, Ball ~25 cm vor der Stirn
      { t: 0.54, boden: false, hand: 15, H: { x: 0, z: 0, vor: 2 },
        ikRel: { Right: [-0.17, 0.79, 0.27], Left: [-0.02, 0.83, 0.27] },
        J: L({ LeftUpLeg: { beug: 8, spreiz: 3 }, RightUpLeg: { beug: 8, spreiz: 3 }, LeftLeg: { beug: 14 }, RightLeg: { beug: 14 }, LeftFoot: { heb: -40 }, RightFoot: { heb: -40 },
               RightArm: { ebene: 100, heben: 100, dreh: 0 }, LeftArm: { ebene: 75, heben: 105, dreh: -20 }, RightForeArm: { beug: 90, dreh: -60 }, LeftForeArm: { beug: 100, dreh: -10 }, RightHand: { beug: -60 }, Neck: { beug: -8 } }) },
      // Abwurf am hoechsten Punkt: Wurfarm streckt nach vorn oben, Fuehrhand loest sich
      { t: 0.65, boden: false, hand: 12, H: { x: 0, z: 0, vor: 0 },
        ikRel: { Right: [-0.17, 0.88, 0.33], Left: [0.02, 0.80, 0.28] },
        J: L({ LeftUpLeg: { beug: 10, spreiz: 3 }, RightUpLeg: { beug: 10, spreiz: 3 }, LeftLeg: { beug: 18 }, RightLeg: { beug: 18 }, LeftFoot: { heb: -35 }, RightFoot: { heb: -35 },
               RightArm: { ebene: 95, heben: 130, dreh: 0 }, LeftArm: { ebene: 70, heben: 100, dreh: -20 }, RightForeArm: { beug: 12, dreh: -20 }, LeftForeArm: { beug: 95, dreh: -10 }, RightHand: { beug: 0 }, Neck: { beug: -10 } }) },
      // Nachfuehren: Handgelenk klappt nach vorn (Schwanenhals), Arm bleibt oben
      { t: 0.77, boden: false, hand: 25, H: { x: 0, z: 0, vor: 2 },
        ikRel: { Right: [-0.15, 0.88, 0.36], Left: [0.08, 0.70, 0.28] },
        J: L({ LeftUpLeg: { beug: 16, spreiz: 4 }, RightUpLeg: { beug: 16, spreiz: 4 }, LeftLeg: { beug: 24 }, RightLeg: { beug: 24 }, LeftFoot: { heb: -25 }, RightFoot: { heb: -25 },
               RightArm: { ebene: 88, heben: 140, dreh: 0 }, LeftArm: { ebene: 55, heben: 105, dreh: 20 }, RightForeArm: { beug: 10, dreh: 30 }, LeftForeArm: { beug: 90, dreh: -10 }, RightHand: { beug: 70 }, Neck: { beug: -8 } }) },
      // Aufsetzen: Beine fast gestreckt, Ballen zuerst (erst nach dem Bodenkontakt beugen die Knie)
      { t: 0.88, boden: true, hand: 25, H: { x: 0, z: 0, vor: 3 },
        ikRel: { Right: [-0.15, 0.86, 0.36], Left: [0.10, 0.62, 0.26] },
        J: L({ LeftUpLeg: { beug: 14, spreiz: 4 }, RightUpLeg: { beug: 14, spreiz: 4 }, LeftLeg: { beug: 16 }, RightLeg: { beug: 16 }, LeftFoot: { heb: -18 }, RightFoot: { heb: -18 },
               RightArm: { ebene: 88, heben: 138, dreh: 0 }, LeftArm: { ebene: 52, heben: 95, dreh: 15 }, RightForeArm: { beug: 12, dreh: 30 }, LeftForeArm: { beug: 85 }, RightHand: { beug: 68 } }) },
      // Abfedern weich in den Knien, Wurfarm bleibt im Nachfuehren
      { t: 0.98, boden: true, hand: 25, H: { x: 0, z: 0, vor: 8 },
        ikRel: { Right: [-0.16, 0.80, 0.36], Left: [0.12, 0.52, 0.24] },
        J: L({ LeftUpLeg: { beug: 35, spreiz: 4 }, RightUpLeg: { beug: 35, spreiz: 4 }, LeftLeg: { beug: 45 }, RightLeg: { beug: 45 }, LeftFoot: { heb: 8 }, RightFoot: { heb: 8 },
               RightArm: { ebene: 88, heben: 135, dreh: 0 }, LeftArm: { ebene: 50, heben: 80, dreh: 10 }, RightForeArm: { beug: 15, dreh: 30 }, LeftForeArm: { beug: 80 }, RightHand: { beug: 65 } }) },
      // Arme sinken, Stand
      { t: 1.3, boden: true, hand: 25, H: { x: 0, z: 0, vor: 4 },
        ikRel: { Right: [-0.24, 0.10, 0.12], Left: [0.24, 0.10, 0.12] },
        J: L({ LeftUpLeg: { beug: 14, spreiz: 4 }, RightUpLeg: { beug: 14, spreiz: 4 }, LeftLeg: { beug: 20 }, RightLeg: { beug: 20 },
               RightArm: { ebene: 40, heben: 25, dreh: 0 }, LeftArm: { ebene: 40, heben: 25 }, RightForeArm: { beug: 40 }, LeftForeArm: { beug: 40 } }) },
    ],
  },
  // Freiwurf (Standwurf ohne Sprung): Ball an der Brust, Knie beugen (~40), dann strecken die Beine, die Fersen heben sich
  // (auf die Fussballen), der Ball steigt zum Set Point ("L" wie beim Sprungwurf), Abgabe mit gestrecktem Arm ~50 Grad nach vorn oben,
  // Handgelenk klappt nach (Schwanenhals) und der Arm bleibt im Nachfuehren, bis der Ball den Ring erreicht. Abgabe bei t = 0,72 s.
  bb_freiwurf: {
    period: 1.4, fusshaltung: true, stand: true,
    keys: [
      { t: 0, boden: true, hand: 15, H: { x: 0, z: 0, vor: 5 },
        ikRel: { Right: [-0.15, 0.24, 0.22], Left: [0.09, 0.28, 0.25] },
        J: L({ LeftUpLeg: { beug: 16, spreiz: 4 }, RightUpLeg: { beug: 16, spreiz: 4 }, LeftLeg: { beug: 22 }, RightLeg: { beug: 22 }, Spine: { beug: 3 },
               RightArm: { ebene: 70, heben: 30, dreh: 0 }, LeftArm: { ebene: 70, heben: 30 }, RightForeArm: { beug: 110, dreh: -30 }, LeftForeArm: { beug: 110, dreh: -40 }, RightHand: { beug: -20 } }) },
      // Knie beugen, Ball sinkt etwas
      { t: 0.30, boden: true, hand: 15, H: { x: 0, z: 0, vor: 10 },
        ikRel: { Right: [-0.15, 0.16, 0.24], Left: [0.09, 0.20, 0.27] },
        J: L({ LeftUpLeg: { beug: 36, spreiz: 4 }, RightUpLeg: { beug: 36, spreiz: 4 }, LeftLeg: { beug: 42 }, RightLeg: { beug: 42 }, LeftFoot: { heb: 8 }, RightFoot: { heb: 8 }, Spine: { beug: 5 },
               RightArm: { ebene: 70, heben: 28, dreh: 0 }, LeftArm: { ebene: 70, heben: 28 }, RightForeArm: { beug: 115, dreh: -30 }, LeftForeArm: { beug: 115, dreh: -40 }, RightHand: { beug: -25 }, Neck: { beug: -6 } }) },
      // Beine strecken, Fersen heben, Ball zum Set Point
      { t: 0.55, boden: true, hand: 15, H: { x: 0, z: 0, vor: 3 },
        ikRel: { Right: [-0.17, 0.79, 0.27], Left: [-0.02, 0.83, 0.27] },
        J: L({ LeftUpLeg: { beug: 8, spreiz: 3 }, RightUpLeg: { beug: 8, spreiz: 3 }, LeftLeg: { beug: 10 }, RightLeg: { beug: 10 }, LeftFoot: { heb: -18 }, RightFoot: { heb: -18 },
               RightArm: { ebene: 100, heben: 100, dreh: 0 }, LeftArm: { ebene: 75, heben: 105, dreh: -20 }, RightForeArm: { beug: 90, dreh: -60 }, LeftForeArm: { beug: 100, dreh: -10 }, RightHand: { beug: -60 }, Neck: { beug: -8 } }) },
      // Abgabe auf den Fussballen
      { t: 0.72, boden: true, hand: 12, H: { x: 0, z: 0, vor: 1 },
        ikRel: { Right: [-0.17, 0.88, 0.33], Left: [0.02, 0.80, 0.28] },
        J: L({ LeftUpLeg: { beug: 4, spreiz: 3 }, RightUpLeg: { beug: 4, spreiz: 3 }, LeftLeg: { beug: 5 }, RightLeg: { beug: 5 }, LeftFoot: { heb: -28 }, RightFoot: { heb: -28 },
               RightArm: { ebene: 95, heben: 130, dreh: 0 }, LeftArm: { ebene: 70, heben: 100, dreh: -20 }, RightForeArm: { beug: 12, dreh: -20 }, LeftForeArm: { beug: 95, dreh: -10 }, RightHand: { beug: 0 }, Neck: { beug: -10 } }) },
      // Nachfuehren: Handgelenk klappt nach vorn
      { t: 0.86, boden: true, hand: 25, H: { x: 0, z: 0, vor: 2 },
        ikRel: { Right: [-0.15, 0.88, 0.36], Left: [0.08, 0.66, 0.28] },
        J: L({ LeftUpLeg: { beug: 5, spreiz: 3 }, RightUpLeg: { beug: 5, spreiz: 3 }, LeftLeg: { beug: 6 }, RightLeg: { beug: 6 }, LeftFoot: { heb: -20 }, RightFoot: { heb: -20 },
               RightArm: { ebene: 90, heben: 135, dreh: 0 }, LeftArm: { ebene: 60, heben: 85, dreh: -10 }, RightForeArm: { beug: 10, dreh: 30 }, LeftForeArm: { beug: 90 }, RightHand: { beug: 70 } }) },
      // Fersen wieder ab, Arm bleibt im Nachfuehren
      { t: 1.05, boden: true, hand: 25, H: { x: 0, z: 0, vor: 3 },
        ikRel: { Right: [-0.15, 0.86, 0.36], Left: [0.12, 0.45, 0.24] },
        J: L({ LeftUpLeg: { beug: 10, spreiz: 4 }, RightUpLeg: { beug: 10, spreiz: 4 }, LeftLeg: { beug: 14 }, RightLeg: { beug: 14 },
               RightArm: { ebene: 90, heben: 133, dreh: 0 }, LeftArm: { ebene: 50, heben: 60 }, RightForeArm: { beug: 12, dreh: 30 }, LeftForeArm: { beug: 70 }, RightHand: { beug: 65 } }) },
      { t: 1.4, boden: true, hand: 25, H: { x: 0, z: 0, vor: 4 },
        ikRel: { Right: [-0.24, 0.10, 0.12], Left: [0.24, 0.10, 0.12] },
        J: L({ LeftUpLeg: { beug: 12, spreiz: 4 }, RightUpLeg: { beug: 12, spreiz: 4 }, LeftLeg: { beug: 16 }, RightLeg: { beug: 16 },
               RightArm: { ebene: 40, heben: 25, dreh: 0 }, LeftArm: { ebene: 40, heben: 25 }, RightForeArm: { beug: 40 }, LeftForeArm: { beug: 40 } }) },
    ],
  },
  // Brustpass beidhaendig: Ball an der Brust, Gewicht nach vorn, Arme strecken nach vorn, Unterarme drehen nach innen
  // (Pronation), am Ende zeigen die Daumen nach unten, Handflaechen nach aussen. Ball verlaesst die Haende bei t = 0,30 s.
  bb_brustpass: {
    period: 0.8, fusshaltung: true, stand: true,
    keys: [
      { t: 0, boden: true, hand: 15, H: { x: 0, z: 0, vor: 6 },
        ikRel: { Right: [-0.12, 0.30, 0.24], Left: [0.12, 0.30, 0.24] },
        J: L({ LeftUpLeg: { beug: 22, spreiz: 4 }, RightUpLeg: { beug: 22, spreiz: 4 }, LeftLeg: { beug: 30 }, RightLeg: { beug: 30 },
               RightArm: { ebene: 70, heben: 30 }, LeftArm: { ebene: 70, heben: 30 }, RightForeArm: { beug: 115, dreh: -40 }, LeftForeArm: { beug: 115, dreh: -40 } }) },
      { t: 0.12, boden: true, hand: 15, H: { x: 0, z: 4, vor: 10 },
        ikRel: { Right: [-0.12, 0.32, 0.20], Left: [0.12, 0.32, 0.20] },
        J: L({ LeftUpLeg: { beug: 28, spreiz: 4 }, RightUpLeg: { beug: 24, spreiz: 4 }, LeftLeg: { beug: 36 }, RightLeg: { beug: 32 },
               RightArm: { ebene: 75, heben: 30 }, LeftArm: { ebene: 75, heben: 30 }, RightForeArm: { beug: 125, dreh: -40 }, LeftForeArm: { beug: 125, dreh: -40 } }) },
      // Arme schnellen nach vorn, Unterarme drehen ein
      { t: 0.30, boden: true, hand: 8, H: { x: 0, z: 10, vor: 14 },
        ikRel: { Right: [-0.10, 0.36, 0.56], Left: [0.10, 0.36, 0.56] },
        J: L({ LeftUpLeg: { beug: 32, spreiz: 4 }, RightUpLeg: { beug: 20, spreiz: 4 }, LeftLeg: { beug: 38 }, RightLeg: { beug: 28 },
               RightArm: { ebene: 88, heben: 80 }, LeftArm: { ebene: 88, heben: 80 }, RightForeArm: { beug: 10, dreh: 60 }, LeftForeArm: { beug: 10, dreh: 60 }, RightHand: { beug: 10 }, LeftHand: { beug: 10 } }) },
      { t: 0.46, boden: true, hand: 10, H: { x: 0, z: 10, vor: 14 },
        ikRel: { Right: [-0.11, 0.34, 0.57], Left: [0.11, 0.34, 0.57] },
        J: L({ LeftUpLeg: { beug: 32, spreiz: 4 }, RightUpLeg: { beug: 20, spreiz: 4 }, LeftLeg: { beug: 38 }, RightLeg: { beug: 28 },
               RightArm: { ebene: 88, heben: 78 }, LeftArm: { ebene: 88, heben: 78 }, RightForeArm: { beug: 5, dreh: 75 }, LeftForeArm: { beug: 5, dreh: 75 }, RightHand: { beug: 25 }, LeftHand: { beug: 25 } }) },
      { t: 0.8, boden: true, hand: 25, H: { x: 0, z: 4, vor: 6 },
        ikRel: { Right: [-0.24, 0.10, 0.14], Left: [0.24, 0.10, 0.14] },
        J: L({ LeftUpLeg: { beug: 20, spreiz: 4 }, RightUpLeg: { beug: 20, spreiz: 4 }, LeftLeg: { beug: 28 }, RightLeg: { beug: 28 },
               RightArm: { ebene: 40, heben: 25 }, LeftArm: { ebene: 40, heben: 25 }, RightForeArm: { beug: 45 }, LeftForeArm: { beug: 45 } }) },
    ],
  },
  // Dribbeln im Stand (Schleife, 2 Ballkontakte pro Sekunde): Knie ~40, Rumpf vor, Kopf hoch; die rechte Hand nimmt den Ball oben
  // seitlich vor dem Koerper auf (t = 0), drueckt ihn mit Ellbogen- und Handgelenkstreckung nach unten (Abgabe bei t = 0,16 s) und geht
  // wieder hoch, um ihn bei t = 0,5 s aufzunehmen. Linker Unterarm schuetzt vor dem Koerper.
  bb_dribbeln_stand: {
    period: 0.5, fusshaltung: true, stand: true,
    // Hand oben auf Hoehe des Beckens, unten ~16 cm tiefer (Oberschenkel); weiter reicht der Arm (Schulter-Handgelenk ~0,52 m) nicht.
    keys: [0, 0.16, 0.30, 0.5].map((t, n) => ({ t, boden: true, hand: [30, 15, 25, 30][n], H: { x: 0, z: 0, vor: 18 },
      ikRel: { Right: [[-0.28, 0.12, 0.30], [-0.30, -0.05, 0.34], [-0.29, 0.04, 0.32], [-0.28, 0.12, 0.30]][n], Left: [0.02, 0.26, 0.38] },
      J: L({ LeftUpLeg: { beug: 40, spreiz: 8 }, RightUpLeg: { beug: 40, spreiz: 8 }, LeftLeg: { beug: 42 }, RightLeg: { beug: 42 }, LeftFoot: { heb: 6 }, RightFoot: { heb: 6 },
             Spine: { beug: 10 }, Neck: { beug: -20 }, RightArm: { ebene: 40, heben: 30, dreh: -10 }, RightForeArm: { beug: [75, 30, 55, 75][n], dreh: 60 },
             RightHand: { beug: [-25, 30, 0, -25][n] }, LeftArm: { ebene: 80, heben: 50, dreh: -45 }, LeftForeArm: { beug: 90, dreh: 10 } }) })),
  },
  // Dribbeln im Lauf: Beine und Becken aus der gelernten Gangart laufen, rechter Arm dribbelt (ein Ballkontakt je Doppelschritt, 0,72 s),
  // linker Arm schwingt ruhiger und schuetzt. Abgabe bei t = 0,12 s.
  bb_dribbeln_lauf: {
    period: 0.72, base: 'laufen',
    keys: [0, 0.12, 0.36, 0.72].map((t, n) => ({ t, hand: [30, 15, 25, 30][n], H: { seit: 0 },
      J: { RightArm: { ebene: 45, heben: [35, 25, 30, 35][n], dreh: -10 }, RightForeArm: { beug: [80, 35, 60, 80][n], dreh: 60 }, RightHand: { beug: [-25, 30, 0, -25][n] },
           LeftArm: { ebene: 70, heben: 40, dreh: 20 }, LeftForeArm: { beug: 95, dreh: 10 }, Spine1: { dreh: 0 }, Neck: { beug: -10 } } })),
  },
  // Verteidigungsstellung (Schleife): Fuesse breiter als die Schultern, Knie ~55, Gesaess zurueck, Rumpf ~25 vor, Ruecken gerade,
  // Kopf hoch; rechte Hand hoch zum Ball, linke Hand seitlich tief (Passweg). Leichtes Federn in den Knien.
  bb_verteidigung: {
    period: 1.2, fusshaltung: true, stand: true,
    keys: [0, 0.6, 1.2].map((t, n) => ({ t, boden: true, hand: 20, H: { x: 0, z: 0, vor: [24, 26, 24][n] },
      J: L({ LeftUpLeg: { beug: [50, 54, 50][n], spreiz: 18, dreh: 10 }, RightUpLeg: { beug: [50, 54, 50][n], spreiz: 18, dreh: 10 }, LeftLeg: { beug: [55, 60, 55][n] }, RightLeg: { beug: [55, 60, 55][n] },
             LeftFoot: { heb: 12 }, RightFoot: { heb: 12 }, Spine: { beug: 2 }, Neck: { beug: -22 }, Head: { beug: -6 },
             RightArm: { ebene: 60, heben: 115, dreh: 0 }, RightForeArm: { beug: 25, dreh: -20 }, LeftArm: { ebene: 15, heben: 55, dreh: 0 }, LeftForeArm: { beug: 25, dreh: -30 } }) })),
  },
  // Block: beidbeiniger Sprung aus dem Stand, beide Arme gestreckt senkrecht nach oben (Vorheben ~170), Handflaechen zum Ball.
  bb_block: {
    period: 1.1, fusshaltung: true, stand: true,
    keys: [
      { t: 0, boden: true, hand: 20, H: { vor: 8 }, J: L({ LeftUpLeg: { beug: 22, spreiz: 6 }, RightUpLeg: { beug: 22, spreiz: 6 }, LeftLeg: { beug: 30 }, RightLeg: { beug: 30 }, RightArm: { ebene: 60, heben: 70 }, LeftArm: { ebene: 60, heben: 70 }, RightForeArm: { beug: 60 }, LeftForeArm: { beug: 60 } }) },
      { t: 0.2, boden: true, hand: 20, H: { vor: 16 }, J: L({ LeftUpLeg: { beug: 55, spreiz: 6 }, RightUpLeg: { beug: 55, spreiz: 6 }, LeftLeg: { beug: 65 }, RightLeg: { beug: 65 }, LeftFoot: { heb: 14 }, RightFoot: { heb: 14 }, RightArm: { ebene: 70, heben: 90 }, LeftArm: { ebene: 70, heben: 90 }, RightForeArm: { beug: 70 }, LeftForeArm: { beug: 70 } }) },
      { t: 0.34, boden: true, hand: 10, H: { vor: 2 }, J: L({ LeftUpLeg: { beug: 6 }, RightUpLeg: { beug: 6 }, LeftLeg: { beug: 8 }, RightLeg: { beug: 8 }, LeftFoot: { heb: -40 }, RightFoot: { heb: -40 }, RightArm: { ebene: 90, heben: 160 }, LeftArm: { ebene: 90, heben: 160 }, RightForeArm: { beug: 15 }, LeftForeArm: { beug: 15 }, Neck: { beug: -15 } }) },
      { t: 0.56, boden: false, hand: 5, H: { vor: -2 }, J: L({ LeftUpLeg: { beug: 10 }, RightUpLeg: { beug: 10 }, LeftLeg: { beug: 15 }, RightLeg: { beug: 15 }, LeftFoot: { heb: -35 }, RightFoot: { heb: -35 }, RightArm: { ebene: 92, heben: 172, dreh: 10 }, LeftArm: { ebene: 92, heben: 172, dreh: 10 }, RightForeArm: { beug: 5, dreh: -30 }, LeftForeArm: { beug: 5, dreh: -30 }, Neck: { beug: -20 } }) },
      { t: 0.78, boden: true, hand: 15, H: { vor: 3 }, J: L({ LeftUpLeg: { beug: 12, spreiz: 6 }, RightUpLeg: { beug: 12, spreiz: 6 }, LeftLeg: { beug: 15 }, RightLeg: { beug: 15 }, LeftFoot: { heb: -18 }, RightFoot: { heb: -18 }, RightArm: { ebene: 88, heben: 155 }, LeftArm: { ebene: 88, heben: 155 }, RightForeArm: { beug: 15 }, LeftForeArm: { beug: 15 } }) },
      { t: 0.88, boden: true, hand: 15, H: { vor: 10 }, J: L({ LeftUpLeg: { beug: 40, spreiz: 6 }, RightUpLeg: { beug: 40, spreiz: 6 }, LeftLeg: { beug: 50 }, RightLeg: { beug: 50 }, LeftFoot: { heb: 10 }, RightFoot: { heb: 10 }, RightArm: { ebene: 85, heben: 130 }, LeftArm: { ebene: 85, heben: 130 }, RightForeArm: { beug: 25 }, LeftForeArm: { beug: 25 } }) },
      { t: 1.1, boden: true, hand: 20, H: { vor: 6 }, J: L({ LeftUpLeg: { beug: 20, spreiz: 6 }, RightUpLeg: { beug: 20, spreiz: 6 }, LeftLeg: { beug: 28 }, RightLeg: { beug: 28 }, RightArm: { ebene: 50, heben: 50 }, LeftArm: { ebene: 50, heben: 50 }, RightForeArm: { beug: 50 }, LeftForeArm: { beug: 50 } }) },
    ],
  },
  // Rebound: beidbeiniger Sprung, beide Haende greifen den Ball ueber dem Kopf (t = 0,52 s), ziehen ihn im Fallen ans Kinn,
  // Landung breit, Ellbogen nach aussen ("chin the ball").
  bb_rebound: {
    period: 1.3, fusshaltung: true, stand: true,
    keys: [
      { t: 0, boden: true, hand: 20, H: { vor: 8 }, ikRel: { Right: [-0.22, 0.42, 0.25], Left: [0.22, 0.42, 0.25] },
        J: L({ LeftUpLeg: { beug: 28, spreiz: 8 }, RightUpLeg: { beug: 28, spreiz: 8 }, LeftLeg: { beug: 36 }, RightLeg: { beug: 36 }, RightArm: { ebene: 50, heben: 75 }, LeftArm: { ebene: 50, heben: 75 }, RightForeArm: { beug: 80 }, LeftForeArm: { beug: 80 } }) },
      { t: 0.2, boden: true, hand: 20, H: { vor: 16 }, ikRel: { Right: [-0.22, 0.30, 0.25], Left: [0.22, 0.30, 0.25] },
        J: L({ LeftUpLeg: { beug: 55, spreiz: 8 }, RightUpLeg: { beug: 55, spreiz: 8 }, LeftLeg: { beug: 66 }, RightLeg: { beug: 66 }, LeftFoot: { heb: 14 }, RightFoot: { heb: 14 }, RightArm: { ebene: 55, heben: 70 }, LeftArm: { ebene: 55, heben: 70 }, RightForeArm: { beug: 90 }, LeftForeArm: { beug: 90 } }) },
      { t: 0.34, boden: true, hand: 10, H: { vor: 2 }, ikRel: { Right: [-0.14, 0.96, 0.18], Left: [0.14, 0.96, 0.18] },
        J: L({ LeftUpLeg: { beug: 6, spreiz: 4 }, RightUpLeg: { beug: 6, spreiz: 4 }, LeftLeg: { beug: 8 }, RightLeg: { beug: 8 }, LeftFoot: { heb: -40 }, RightFoot: { heb: -40 }, RightArm: { ebene: 85, heben: 160 }, LeftArm: { ebene: 85, heben: 160 }, RightForeArm: { beug: 20, dreh: -40 }, LeftForeArm: { beug: 20, dreh: -40 }, Neck: { beug: -18 } }) },
      // Ball greifen ueber dem Kopf
      { t: 0.52, boden: false, hand: 25, H: { vor: 0 }, ikRel: { Right: [-0.10, 1.00, 0.20], Left: [0.10, 1.00, 0.20] },
        J: L({ LeftUpLeg: { beug: 12, spreiz: 4 }, RightUpLeg: { beug: 12, spreiz: 4 }, LeftLeg: { beug: 18 }, RightLeg: { beug: 18 }, LeftFoot: { heb: -35 }, RightFoot: { heb: -35 }, RightArm: { ebene: 90, heben: 165 }, LeftArm: { ebene: 90, heben: 165 }, RightForeArm: { beug: 25, dreh: -40 }, LeftForeArm: { beug: 25, dreh: -40 }, Neck: { beug: -20 } }) },
      // im Fallen: Ball ans Kinn, Ellbogen nach aussen
      { t: 0.72, boden: false, hand: 25, H: { vor: 6 }, ikRel: { Right: [-0.10, 0.62, 0.20], Left: [0.10, 0.62, 0.30] },
        J: L({ LeftUpLeg: { beug: 14, spreiz: 8 }, RightUpLeg: { beug: 14, spreiz: 8 }, LeftLeg: { beug: 18 }, RightLeg: { beug: 18 }, LeftFoot: { heb: -25 }, RightFoot: { heb: -25 }, RightArm: { ebene: 60, heben: 70, dreh: -35 }, LeftArm: { ebene: 60, heben: 70, dreh: -35 }, RightForeArm: { beug: 120, dreh: -30 }, LeftForeArm: { beug: 120, dreh: -30 }, Neck: { beug: -5 } }) },
      // Aufsetzen mit fast gestreckten Beinen
      { t: 0.86, boden: true, hand: 25, H: { vor: 6 }, ikRel: { Right: [-0.10, 0.60, 0.20], Left: [0.10, 0.60, 0.30] },
        J: L({ LeftUpLeg: { beug: 14, spreiz: 10 }, RightUpLeg: { beug: 14, spreiz: 10 }, LeftLeg: { beug: 18 }, RightLeg: { beug: 18 }, LeftFoot: { heb: -15 }, RightFoot: { heb: -15 }, RightArm: { ebene: 60, heben: 70, dreh: -35 }, LeftArm: { ebene: 60, heben: 70, dreh: -35 }, RightForeArm: { beug: 122, dreh: -30 }, LeftForeArm: { beug: 122, dreh: -30 }, Neck: { beug: -8 } }) },
      // Abfedern breit und tief
      { t: 0.98, boden: true, hand: 25, H: { vor: 16 }, ikRel: { Right: [-0.10, 0.54, 0.22], Left: [0.10, 0.54, 0.30] },
        J: L({ LeftUpLeg: { beug: 50, spreiz: 12 }, RightUpLeg: { beug: 50, spreiz: 12 }, LeftLeg: { beug: 60 }, RightLeg: { beug: 60 }, LeftFoot: { heb: 12 }, RightFoot: { heb: 12 }, RightArm: { ebene: 60, heben: 70, dreh: -35 }, LeftArm: { ebene: 60, heben: 70, dreh: -35 }, RightForeArm: { beug: 125, dreh: -30 }, LeftForeArm: { beug: 125, dreh: -30 }, Neck: { beug: -15 } }) },
      { t: 1.3, boden: true, hand: 25, H: { vor: 8 }, ikRel: { Right: [-0.12, 0.40, 0.24], Left: [0.12, 0.40, 0.24] },
        J: L({ LeftUpLeg: { beug: 25, spreiz: 8 }, RightUpLeg: { beug: 25, spreiz: 8 }, LeftLeg: { beug: 32 }, RightLeg: { beug: 32 }, RightArm: { ebene: 55, heben: 55 }, LeftArm: { ebene: 55, heben: 55 }, RightForeArm: { beug: 115, dreh: -30 }, LeftForeArm: { beug: 115, dreh: -30 } }) },
    ],
  },
  // Bereitschaft ohne Ball (Schleife): lockere Sportlerhaltung, Knie leicht gebeugt, Arme haengen dicht am Rumpf (Hand neben dem
  // Oberschenkel, Ellbogen ~15, Finger halb eingerollt), ruhige Atmung ueber den Brustkorb.
  bb_bereit: {
    period: 2.4, fusshaltung: true, stand: true,
    keys: [0, 1.2, 2.4].map((t, n) => ({ t, boden: true, hand: 30, H: { x: 0, z: 0, vor: 4 },
      J: L({ LeftUpLeg: { beug: 14, spreiz: 4 }, RightUpLeg: { beug: 14, spreiz: 4 }, LeftLeg: { beug: 18 }, RightLeg: { beug: 18 },
             Spine2: { beug: [0, -2, 0][n] }, Neck: { beug: -4 }, LeftArm: { ebene: 20, heben: 10 }, RightArm: { ebene: 20, heben: 10 },
             LeftForeArm: { beug: [16, 20, 16][n] }, RightForeArm: { beug: [16, 20, 16][n] } }) })),
  },
  // Ball halten im Stand (Schleife, "triple threat"): Knie gebeugt, Ball an der rechten Huefte/Brust, beide Haende am Ball, Blick zum Korb.
  bb_ball_halten: {
    period: 1.6, fusshaltung: true, stand: true,
    keys: [0, 0.8, 1.6].map((t, n) => ({ t, boden: true, hand: 15, H: { x: 0, z: 0, vor: [12, 13, 12][n] },
      ikRel: { Right: [-0.17, 0.20, 0.20], Left: [0.04, 0.26, 0.25] },
      J: L({ LeftUpLeg: { beug: [32, 35, 32][n], spreiz: 8 }, RightUpLeg: { beug: [32, 35, 32][n], spreiz: 8 }, LeftLeg: { beug: [42, 45, 42][n] }, RightLeg: { beug: [42, 45, 42][n] },
             LeftFoot: { heb: 8 }, RightFoot: { heb: 8 }, Neck: { beug: -14 }, RightArm: { ebene: 60, heben: 25 }, LeftArm: { ebene: 80, heben: 30 },
             RightForeArm: { beug: 110, dreh: -40 }, LeftForeArm: { beug: 115, dreh: -40 }, RightHand: { beug: -15 } }) })),
  },
};

const moveBake = {};
function bakeMove(name) {
  const c = MOVES[name], j = p.pose.j, F = Math.round(c.period * 30), K = c.keys;
  const poses = K.map(k => movePose(k.J)), quats = K.map(k => hipsQ(k.H));
  const seg = t => { let a = 0; while (a + 2 < K.length && t >= K[a + 1].t) a++; return a; };
  resetPose(); p.applyPoseFast();
  const H0 = p.wpos('Hips').clone();
  const frames = [], ground = [], report = [];
  let feet = { Left: null, Right: null }, lastFest = null, standRef = null;
  for (let i = 0; i <= F; i++) {
    const t = Math.min(i / F * c.period, c.period), a = seg(t), b = a + 1;
    const u = clamp((t - K[a].t) / (K[b].t - K[a].t), 0, 1);
    const i0 = Math.max(0, a - 1), i3 = Math.min(K.length - 1, b + 1);
    const hk = n => K[n].hand !== undefined ? K[n].hand : (c.fusshaltung ? 55 : 30);
    if (c.base) {
      // Unterbau aus einer gelernten Gangart (z. B. laufen): Beine und Becken von dort, die Keys aendern nur ihre eigenen Gelenke
      const es = ES[c.base];
      resetPose(); setGait(es.best, (t / es.g.period) % 1, es.g);
      for (const id in K[0].J) for (const k in K[0].J[id]) j[id][k] = cat(K[i0].J[id][k], K[a].J[id][k], K[b].J[id][k], K[i3].J[id][k], u);
      const hs = k => cat(K[i0].H[k] || 0, K[a].H[k] || 0, K[b].H[k] || 0, K[i3].H[k] || 0, u);
      j.Hips.seit += hs('seit'); j.Hips.dreh += hs('dreh');
      setHands(hk(a) + (hk(b) - hk(a)) * u);
      p.clampAll(); p.applyPose();
      // Nie unter den Boden: geaenderte Arme/Becken koennen die Gangart absenken (Dribbeln im Lauf sank bis 7 cm ein).
      // Nur anheben, nie absenken, damit Flugphasen der Gangart bleiben.
      { const y0 = j.Hips.y; p.opts.ground = true; p.groundIt(); p.opts.ground = false; if (j.Hips.y < y0) j.Hips.y = y0; p.applyPoseFast(); }
      frames.push(JSON.parse(JSON.stringify(j))); ground.push(true);
      continue;
    }
    resetPose();
    for (const id in j) for (const k in j[id]) {
      if (id === 'Hips') continue;
      j[id][k] = cat(poses[i0][id][k], poses[a][id][k], poses[b][id][k], poses[i3][id][k], u);
    }
    const e = hipsEuler(qSlerp(quats[a], quats[b], u));
    j.Hips.dreh = e.dreh; j.Hips.vor = e.vor; j.Hips.seit = e.seit;
    const hv = k => cat(K[i0].H[k] || 0, K[a].H[k] || 0, K[b].H[k] || 0, K[i3].H[k] || 0, u);
    j.Hips.x = hv('x'); j.Hips.z = hv('z');
    setHands(hk(a) + (hk(b) - hk(a)) * u);
    // zeig: Zeigefinger gestreckt (zum Himmel zeigen)
    if ((u < 0.5 ? K[a] : K[b]).zeig) for (const sd of ['Left', 'Right']) { j[sd + 'Index1'].beug = 0; j[sd + 'Index2'].beug = 0; j[sd + 'Index3'].beug = 0; j[sd + 'Index1'].spreiz = 0; }
    p.clampAll();
    // Fuss festhalten (Bein-IK) waehrend eines Abschnitts mit fest
    const fest = (u < 1 ? K[a] : K[b]).fest || [];
    const tag = (u < 1 ? a : b) + ':' + fest.join();
    if (tag !== lastFest) { feet = { Left: null, Right: null }; lastFest = tag; }
    p.applyPose();
    for (const sd of fest) {
      if (!feet[sd]) feet[sd] = p.wpos(sd + 'Foot').clone();
      else p.solveIK(sd, 'leg', feet[sd].clone());
    }
    // Boden: tiefster Punkt auf den Boden (Stand- und Liegephasen)
    const onGround = u < 1 ? (K[a].boden && K[b].boden) : K[b].boden;
    // Fussbahn (ik: { Right: [x, y, z] } in m, Sprunggelenk in Weltkoordinaten der Puppe), bei allen Keys angegeben.
    // Boden und Fussbahn haengen voneinander ab: zweimal abwechselnd loesen.
    for (let pass = 0; pass < 2; pass++) {
      if (onGround) { p.opts.ground = true; p.groundIt(); p.opts.ground = false; }
      for (const sd of ['Left', 'Right']) {
        if (!K.every(k => k.ik && k.ik[sd])) continue;
        const tg = [0, 1, 2].map(n => cat(K[i0].ik[sd][n], K[a].ik[sd][n], K[b].ik[sd][n], K[i3].ik[sd][n], u));
        p.solveIK(sd, 'leg', p.V(tg[0], tg[1], tg[2]));
      }
      // Fuesse in Bodennaehe (Standphasen) mit flacher Sohle: Ferse und Spitze auf gleiche Hoehe
      if (onGround && c.fusshaltung) for (const sd of ['Left', 'Right']) {
        const lo = Math.min(p.mpos(sd + 'Heel').y, p.mpos(sd + 'ToeTip').y);
        if (lo > 0.13) continue;
        let h = j[sd + 'Foot'].heb;
        for (let n = 0; n < 5; n++) { j[sd + 'Foot'].heb = h; p.applyPoseFast(); h = clamp(h - (p.mpos(sd + 'ToeTip').y - p.mpos(sd + 'Heel').y) / .15 * 57.3, -50, 30); }
        j[sd + 'Foot'].heb = h;
      }
    }
    if (onGround) { p.opts.ground = true; p.groundIt(); p.opts.ground = false; }
    // stand: Fuesse bleiben waagerecht an ihrem Platz (Mitte beider Sprunggelenke wie im ersten Bild), indem das Becken verschoben wird.
    // Anders als fest (Bein-IK) bleiben die Beinwinkel erhalten: Kniebeuge, Abdruck und Sprung aus dem Stand (Gesaess geht zurueck).
    if (c.stand) {
      const fl = p.wpos('LeftFoot'), fr = p.wpos('RightFoot'), m = { x: (fl.x + fr.x) / 2, z: (fl.z + fr.z) / 2 };
      if (!standRef) standRef = m;
      else { j.Hips.x += (standRef.x - m.x) * 100; j.Hips.z += (standRef.z - m.z) * 100; p.applyPose(); }
    }
    for (const sd of ['Left', 'Right']) {
      if (!K.every(k => k.ikArm && k.ikArm[sd])) continue;
      const tg = [0, 1, 2].map(n => cat(K[i0].ikArm[sd][n], K[a].ikArm[sd][n], K[b].ikArm[sd][n], K[i3].ikArm[sd][n], u));
      p.solveIK(sd, 'arm', p.V(tg[0], tg[1], tg[2]));
    }
    // Handgelenk relativ zum Becken (ikRel: { Right: [x, y, z] } in m, +x links, +y oben, +z vorn), bei allen Keys angegeben.
    // Bleibt am Koerper, auch wenn die Flugphase das Becken danach als Wurfparabel anhebt (Ball halten, Wurf, Pass, Rebound).
    for (const sd of ['Left', 'Right']) {
      if (!K.every(k => k.ikRel && k.ikRel[sd])) continue;
      const tg = [0, 1, 2].map(n => cat(K[i0].ikRel[sd][n], K[a].ikRel[sd][n], K[b].ikRel[sd][n], K[i3].ikRel[sd][n], u));
      const h = p.wpos('Hips');
      p.solveIK(sd, 'arm', p.V(h.x + tg[0], h.y + tg[1], h.z + tg[2]));
    }
    p.applyPoseFast();
    frames.push(JSON.parse(JSON.stringify(j)));
    ground.push(onGround);
  }
  // Flugphasen: Beckenhoehe als Wurfparabel zwischen dem letzten Bodenbild davor und dem ersten danach
  for (let i = 0; i <= F; i++) {
    if (ground[i]) continue;
    let s = i; while (s > 0 && !ground[s]) s--;
    let e2 = i; while (e2 < F && !ground[e2]) e2++;
    const T = (e2 - s) / F * c.period, uu = (i - s) / (e2 - s), y0 = frames[s].Hips.y / 100, y1 = frames[e2].Hips.y / 100;
    frames[i].Hips.y = (y0 + (y1 - y0) * uu + 0.5 * 9.81 * T * T * uu * (1 - uu)) * 100;
  }
  // Bericht: tiefster Punkt (Flug muss > 0 bleiben), Fusshoehen, Beckenhoehe
  for (let i = 0; i <= F; i++) {
    for (const id in j) for (const k in j[id]) j[id][k] = frames[i][id][k];
    p.applyPose();
    const lo = n => Math.min(p.mpos(n + 'Heel').y, p.mpos(n + 'ToeTip').y);
    p.opts.ground = true; const y0 = j.Hips.y; p.groundIt(); const lowest = -(j.Hips.y - y0) / 100; j.Hips.y = y0; p.opts.ground = false; p.applyPose();
    report.push({ t: +(i / F * c.period).toFixed(2), boden: ground[i], tiefster: +lowest.toFixed(3), fussL: +lo('Left').toFixed(3), fussR: +lo('Right').toFixed(3),
      becken: +p.wpos('Hips').y.toFixed(2), fussRhoehe: +p.wpos('RightFoot').y.toFixed(2), fussRvor: +(p.wpos('RightFoot').z - H0.z).toFixed(2), fussRseit: +p.wpos('RightFoot').x.toFixed(2) });
  }
  (window.__moveReport = window.__moveReport || {})[name] = report;
  moveBake[name] = frames;
}
function setMove(name, u) {
  if (!moveBake[name]) bakeMove(name);
  const fr = moveBake[name], x = clamp(u, 0, 1) * (fr.length - 1), a = Math.floor(x), f = x - a, A = fr[a], B = fr[Math.min(a + 1, fr.length - 1)], j = p.pose.j;
  for (const id in j) for (const k in j[id]) j[id][k] = A[id][k] + (B[id][k] - A[id][k]) * f;
}
async function saveMoves(names) {
  const out = {};
  for (let i = 0; i < 150 && pendingLoads > 0; i++) await new Promise(r => setTimeout(r, 100));
  for (const k of [].concat(names)) {
    const c = MOVES[k]; delete moveBake[k]; bakeMove(k);
    const F = Math.round(c.period * 30);
    const keys = moveBake[k].map((w, i) => ({ frame: i, winkel: w }));
    const body = { format: 'gelenkpuppe', version: 1, name: RUN + k, beschreibung: `Move ${k} aus Schluesselhaltungen (MOVES in training.js)`, fps: 30, laenge_bilder: F, gespeichert: new Date().toISOString(), keys };
    await fetch('/api/posen/' + RUN + k, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    out[k] = window.__moveReport[k];
  }
  return out;
}
window.__movesSave = saveMoves;
window.__moves = MOVES;
window.__setMove = setMove;

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
  humpeln: makeES('humpeln', 0, 1, [], () => evalCycle('humpeln'), null),
  fangen: makeES('fangen', 0, 1, [], () => evalJump('fangen'), null),
  fangen_flach: makeES('fangen_flach', 0, 1, [], () => evalJump('fangen_flach'), null),
  fangen_hoch: makeES('fangen_hoch', 0, 1, [], () => evalJump('fangen_hoch'), null),
  halten: makeES('halten', 0, 1, [], () => evalJump('halten'), null),
  halten_gehen: makeES('halten_gehen', 0, 1, [], () => ({ total: 0, cost: {} }), null),
  sprung: makeES('sprung', 0, 1, [], () => evalJump('sprung'), null),
  sprung_lauf: makeES('sprung_lauf', 0, 1, [], () => evalJump('sprung_lauf'), null),
};
const NAMES = { gehen: 'Gehen', laufen: 'Laufen', sprinten: 'Sprinten', dribbeln: 'Dribbeln', aufstehen: 'Aufstehen', rueckwaerts: 'Rückwärts', seitwaerts: 'Seitwärts', rueckwaerts_gehen: 'Rückwärts gehen', seitwaerts_gehen: 'Seitwärts gehen', seitwaerts_laufen: 'Seitwärts laufen', humpeln: 'Humpeln', fangen: 'Fangen', fangen_flach: 'Fangen flach', fangen_hoch: 'Fangen hoch', halten: 'Ball halten', halten_gehen: 'Gehen mit Ball', sprung: 'Sprung', sprung_lauf: 'Sprung aus dem Lauf' };
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
