// Quick-mode estimator (src/savers/quick.ts, tech-notes §8.13) on synthetic populations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bandOf, cacheFingerprint, fitQuick, MIN_QUICK_SAMPLE, planQuick, ppsProbs, quickSalt, type QuickOutput, type QuickPlan } from "../src/savers/quick.ts";

type Out = QuickOutput & { d: number };

/**
 * A synthetic saver: sizes log-uniform from 300 to 30,000 tokens, 1% previews, and savings
 * that are all or nothing (90% of the output) with a chance that grows with size, like
 * token-saver's. `drift` scales that chance (a period where the saver cut more).
 */
function synthPop(N: number, seed: number, drift = 1): Out[] {
  const out: Out[] = [];
  for (let i = 0; i < N; i++) {
    const h = createHash("sha1").update(`pop${seed}\0${i}`).digest();
    const a = h.readUInt32BE(0) / 2 ** 32;
    const b = h.readUInt32BE(4) / 2 ** 32;
    const c = h.readUInt32BE(8) / 2 ** 32;
    const x = Math.round(300 * Math.pow(100, a));
    const cut = b < Math.min(0.9, (drift * x) / 15000);
    out.push({ key: `k${String(i).padStart(5, "0")}`, x, preview: c < 0.01, d: cut ? Math.round(0.9 * x) : 0 });
  }
  return out;
}

const NONE = new Set<string>();
const truth = (pop: Out[]) => pop.reduce((a, o) => a + o.d, 0);

/** One quick run with the whole planned sample measured (or the first `k` of the u/x order). */
function quickRun(pop: Out[], budget: number, salt: string, cached: Set<string> = NONE, opts: { k?: number; failed?: Set<string> } = {}) {
  const plan = planQuick(pop, budget, salt, cached);
  const d = new Map(pop.map((o) => [o.key, o.d]));
  const failed = opts.failed ?? NONE;
  const rank = new Map(plan.ranked.map((key, i) => [key, i]));
  const replayed = plan.order.slice(0, plan.quick).filter((key) => opts.k === undefined || (rank.get(key) ?? -1) < opts.k);
  const measured = new Map(replayed.filter((key) => !failed.has(key)).map((key) => [key, d.get(key)!]));
  const fit = fitQuick(plan, measured, failed);
  let est = 0;
  for (const o of pop) {
    if (failed.has(o.key)) continue;
    if (cached.has(o.key) || measured.has(o.key)) est += o.d;
    else est += fit.ratioFor(o.key)! * o.x;
  }
  return { plan, fit, measured, est };
}

test("1. the certainty peel gives Σπ = n, every π ≤ 1, the largest outputs certain", () => {
  const pop = synthPop(1500, 1);
  // a few huge outputs, so there are certainties
  for (let i = 0; i < 5; i++) Object.assign(pop[i]!, { x: 5_000_000 + i, preview: false });
  const other = pop.filter((o) => !o.preview).sort((a, b) => b.x - a.x);
  for (const n of [20, 100, 270]) {
    const pi = ppsProbs(other, n);
    const sum = [...pi.values()].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - n) < 1e-9, `Σπ = ${sum}, n = ${n}`);
    assert.ok([...pi.values()].every((p) => p >= 0 && p <= 1));
    const certain = other.filter((o) => pi.get(o.key) === 1);
    assert.ok(certain.length >= 5, "the huge outputs are certainties");
    assert.deepEqual(certain.map((o) => o.key), other.slice(0, certain.length).map((o) => o.key), "the certainties are the largest");
  }
  const plan = planQuick(pop, 270, "s", NONE);
  const previews = pop.filter((o) => o.preview).length;
  assert.equal(plan.quick, 270);
  assert.ok(plan.certain.size >= 5);
  assert.deepEqual(plan.order.slice(previews, previews + plan.certain.size).sort(), [...plan.certain].sort(), "certainties right after the previews");
});

test("2. the non-certain rank is u/x, and does not change with the budget or the window", () => {
  const pop = synthPop(1500, 2);
  const a = planQuick(pop, 270, "salt", NONE);
  const b = planQuick(pop, 120, "salt", NONE);
  const window = pop.filter((_, i) => i % 3 !== 0); // a shorter period: a subset of the outputs
  const c = planQuick(window, 270, "salt", NONE);
  const common = (xs: string[], ys: string[]) => {
    const s = new Set(ys);
    return xs.filter((k) => s.has(k));
  };
  // Outputs non-certain in both plans keep their relative order.
  assert.deepEqual(common(a.ranked, b.ranked), common(b.ranked, a.ranked));
  assert.deepEqual(common(a.ranked, c.ranked), common(c.ranked, a.ranked));
  assert.ok(common(a.ranked, c.ranked).length > 500);
  // It is u/x: ascending.
  const x = new Map(pop.map((o) => [o.key, o.x]));
  const u = (k: string) => (createHash("sha1").update(`salt\0${k}`).digest().readUIntBE(0, 6) + 0.5) / 2 ** 48;
  const q = a.ranked.map((k) => u(k) / x.get(k)!);
  assert.ok(q.every((v, i) => i === 0 || q[i - 1]! <= v));
});

test("3. same logs and cache: same salt, sample and number; one more cache entry: another salt; strict: a fixed salt", () => {
  const pop = synthPop(1500, 3);
  const cache = ["c1", "c2", "c3"];
  const f1 = cacheFingerprint(cache);
  assert.equal(cacheFingerprint([...cache].reverse()), f1, "order-independent");
  const s1 = quickSalt("token-saver", f1);
  assert.equal(quickSalt("token-saver", cacheFingerprint(cache)), s1);
  const r1 = quickRun(pop, 270, s1);
  const r2 = quickRun(pop, 270, quickSalt("token-saver", cacheFingerprint(cache)));
  assert.deepEqual(r2.plan.order, r1.plan.order);
  assert.equal(r2.est, r1.est);
  const s2 = quickSalt("token-saver", cacheFingerprint([...cache, "c4"]));
  assert.notEqual(s2, s1);
  assert.notDeepEqual(quickRun(pop, 270, s2).plan.order.slice(0, 270), r1.plan.order.slice(0, 270), "a fresh draw");
  assert.notEqual(quickSalt("lean-ctx", f1), s1, "per saver");
  // SAVER_AUDIT_STRICT_SAMPLE=1 uses an empty fingerprint: the same salt whatever is cached.
  assert.equal(cacheFingerprint([]), "");
  assert.equal(quickSalt("token-saver", ""), quickSalt("token-saver", cacheFingerprint([])));
});

test("4. cached outputs are exact and leave the population: their results never reach R or the estimates", () => {
  const pop = synthPop(1500, 4);
  const cached = new Set(pop.slice(0, 400).map((o) => o.key));
  const a = quickRun(pop, 270, "s", cached);
  // The same run with other results for the cached outputs.
  const b = quickRun(pop.map((o) => (cached.has(o.key) ? { ...o, d: o.d + 1000 } : o)), 270, "s", cached);
  assert.ok(a.plan.order.every((k) => !cached.has(k)), "cached outputs are not replayed");
  for (const k of a.fit.unmeasured) assert.equal(b.fit.ratioFor(k), a.fit.ratioFor(k));
  assert.equal(b.fit.se, a.fit.se);
  assert.ok(Math.abs(b.est - a.est - 400 * 1000) < 1e-6, "only their own totals move");
  assert.equal(a.fit.role("k00000"), "cached");
  assert.equal(a.fit.pi("k00000"), undefined);
});

test("5. unbiased over salts with ±2 s.e. covering ≥ 85%, also with an exact sub-period in the cache", () => {
  // Savings grow with size (the old sample's weak spot); a sub-period where the saver cut
  // more (drift) is cached exactly, as after an --exact run over one week.
  const early = synthPop(400, 5, 3).map((o) => ({ ...o, key: `e${o.key}` }));
  const late = synthPop(1600, 6);
  for (const [name, pop, cached] of [
    ["empty cache", [...early, ...late], NONE],
    ["exact sub-period cached", [...early, ...late], new Set(early.map((o) => o.key))],
  ] as Array<[string, Out[], Set<string>]>) {
    const T = truth(pop);
    let sum = 0;
    let covered = 0;
    const salts = 200;
    for (let s = 0; s < salts; s++) {
      const r = quickRun(pop, 270, quickSalt("token-saver", `${name}:${s}`), cached);
      assert.equal(r.fit.insufficient, false);
      sum += r.est;
      if (Math.abs(r.est - T) <= 2 * r.fit.se) covered++;
    }
    const bias = sum / salts / T - 1;
    assert.ok(Math.abs(bias) <= 0.03, `${name}: mean is ${(100 * bias).toFixed(1)}% off`);
    assert.ok(covered / salts >= 0.85, `${name}: ±2 s.e. covers ${covered} of ${salts}`);
  }
});

test("6. previews are replayed first and never set R; an unmeasured preview gives no number", () => {
  const pop = synthPop(1500, 7);
  const previews = pop.filter((o) => o.preview).map((o) => o.key);
  assert.ok(previews.length > 5);
  const a = quickRun(pop, 270, "s");
  assert.deepEqual(new Set(a.plan.order.slice(0, previews.length)), new Set(previews), "previews first");
  const b = quickRun(pop.map((o) => (o.preview ? { ...o, d: -50_000 } : o)), 270, "s");
  for (const k of a.fit.unmeasured) assert.equal(b.fit.ratioFor(k), a.fit.ratioFor(k), "a preview's result does not move R");
  assert.equal(a.fit.role(previews[0]!), "preview");
  // More previews than half the budget: the rest go last, and a quick run leaves them unmeasured.
  const many = pop.map((o, i) => ({ ...o, preview: i < 200 }));
  const c = quickRun(many, 270, "s");
  assert.equal(c.plan.order.slice(0, 135).filter((k) => Number(k.slice(1)) < 200).length, 135, "half the budget");
  assert.ok(c.plan.order.slice(-65).every((k) => Number(k.slice(1)) < 200), "the other previews last");
  assert.equal(c.fit.insufficient, true);
  assert.equal(c.fit.ratioFor("k01000"), undefined);
});

test("7. fewer than 20 sampled outputs: no number; when everything fits, exact with nothing extrapolated", () => {
  const pop = synthPop(1500, 8).filter((o) => !o.preview);
  // A clock stop after 19 of the u/x order.
  const cut = quickRun(pop, 270, "s", NONE, { k: MIN_QUICK_SAMPLE - 1 });
  assert.equal(cut.fit.rows, MIN_QUICK_SAMPLE - 1);
  assert.equal(cut.fit.insufficient, true);
  const ok = quickRun(pop, 270, "s", NONE, { k: MIN_QUICK_SAMPLE });
  assert.equal(ok.fit.insufficient, false);
  const small = pop.slice(0, 250);
  const all = quickRun(small, 270, "s");
  assert.equal(all.plan.quick, 250);
  assert.equal(all.plan.certain.size, 250);
  assert.deepEqual(all.fit.unmeasured, []);
  assert.equal(all.fit.insufficient, false);
  assert.equal(all.est, truth(small));
  assert.equal(all.fit.se, 0);
});

test("8. clock cut-off: π recomputed with the k measured; an output measured after a gap is exact but not in R", () => {
  const pop = synthPop(1500, 9);
  const k = 100;
  const r = quickRun(pop, 270, "s", NONE, { k });
  const x = new Map(pop.map((o) => [o.key, o.x]));
  const X = r.plan.ranked.reduce((a, key) => a + x.get(key)!, 0);
  for (const key of r.plan.ranked.slice(0, k)) assert.equal(r.fit.pi(key), Math.min(1, (k * x.get(key)!) / X));
  assert.equal(r.fit.role(r.plan.ranked[0]!), "sample");
  assert.equal(r.fit.role(r.plan.ranked[k]!), "extrapolated");
  // One more output measured past a gap: exact itself, R unchanged.
  const late = r.plan.ranked[k + 5]!;
  const measured = new Map([...r.measured, [late, 99_999]]);
  const fit = fitQuick(r.plan, measured, NONE);
  assert.equal(fit.role(late), "measured");
  assert.equal(fit.rows, r.fit.rows);
  for (const key of fit.unmeasured) assert.equal(fit.ratioFor(key), r.fit.ratioFor(key));
  assert.ok(!fit.unmeasured.includes(late));
});

test("9. failures count as unchanged: out of R and X, and the prefix goes past them", () => {
  const pop = synthPop(1500, 10);
  const plan = planQuick(pop, 270, "s", NONE);
  const failed = new Set([plan.ranked[3]!, plan.ranked[10]!, [...plan.certain][0]!]);
  const r = quickRun(pop, 270, "s", NONE, { failed });
  const x = new Map(pop.map((o) => [o.key, o.x]));
  const X = plan.ranked.filter((k) => !failed.has(k)).reduce((a, k) => a + x.get(k)!, 0);
  const k = r.plan.quick - r.plan.certain.size - pop.filter((o) => o.preview).length - 2; // measured in the prefix
  const probe = plan.ranked[20]!;
  assert.equal(r.fit.pi(probe), Math.min(1, (k * x.get(probe)!) / X));
  assert.equal(r.fit.rows, k);
  for (const f of failed) {
    assert.equal(r.fit.role(f), "failed");
    assert.ok(!r.fit.unmeasured.includes(f), "never estimated");
  }
  // Even with a result recorded for them, failed outputs do not move R.
  const again = fitQuick(r.plan, new Map([...r.measured, ...[...failed].map((f) => [f, 1e9] as [string, number])]), failed);
  assert.equal(again.ratioFor(plan.ranked[500]!), r.fit.ratioFor(plan.ranked[500]!));
  assert.equal(again.se, r.fit.se);
});

test("10. size bands: thin bands merge upward, the tail joins the last group", () => {
  // A hand-made plan: no certainties; the first rows of the u/x order are measured.
  // Rows per band: 500–1k: 5, 1k–2k: 20 → one group; 2k–4k: 25 → a group; 4k–8k: 4 and
  // 8k–16k: 3 → too few, they join 2k–4k; 16k–32k has no rows, only unmeasured outputs.
  const rows: Array<[number, number, number]> = [[700, 5, 0.1], [1500, 20, 0.2], [3000, 25, 0.5], [6000, 4, 0.7], [12000, 3, 0.9]];
  const x = new Map<string, number>();
  const measured = new Map<string, number>();
  const ranked: string[] = [];
  let i = 0;
  for (const [size, n, ratio] of rows) {
    for (let j = 0; j < n; j++) {
      const key = `r${i++}`;
      x.set(key, size + j);
      measured.set(key, ratio * (size + j) * (j % 2 ? 1.2 : 0.8));
      ranked.push(key);
    }
  }
  for (let j = 0; j < 4000; j++) {
    const key = `u${j}`;
    x.set(key, [700, 1500, 3000, 6000, 12000, 20000][j % 6]!);
    ranked.push(key);
  }
  const plan: QuickPlan = { order: ranked, quick: 57, certain: new Set(), ranked, previews: new Set(), cached: new Set(), x, piOf: () => 0.01 };
  const fit = fitQuick(plan, measured, NONE);
  assert.equal(fit.rows, 57);
  const X = [...x.values()].reduce((a, b) => a + b, 0);
  const R = (keys: string[]) => {
    let a = 0;
    let b = 0;
    for (const k of keys) {
      const p = (57 * x.get(k)!) / X;
      a += ((1 - p) / p) * measured.get(k)!;
      b += ((1 - p) / p) * x.get(k)!;
    }
    return a / b;
  };
  const inBands = (...bs: number[]) => [...measured.keys()].filter((k) => bs.includes(bandOf(x.get(k)!)));
  const low = R(inBands(0, 1));
  const high = R(inBands(2, 3, 4, 5));
  const near = (a: number | undefined, b: number) => assert.ok(a !== undefined && Math.abs(a - b) < 1e-12, `${a} vs ${b}`);
  near(fit.ratioFor("u0"), low); // 700: band 0
  near(fit.ratioFor("u1"), low); // 1,500: band 1
  near(fit.ratioFor("u2"), high); // 3,000
  near(fit.ratioFor("u3"), high); // 6,000: joined 2k–4k
  near(fit.ratioFor("u4"), high); // 12,000
  near(fit.ratioFor("u5"), high); // 20,000: no rows, the tail
  assert.ok(Math.abs(low - high) > 0.1);
});

test("11. every unmeasured output gets a finite estimate, R·x over its occurrences", () => {
  const pop = synthPop(1500, 11);
  const r = quickRun(pop, 270, "s");
  assert.equal(r.fit.insufficient, false);
  assert.ok(r.fit.unmeasured.length > 1000);
  const x = new Map(pop.map((o) => [o.key, o.x]));
  for (const k of r.fit.unmeasured) {
    const R = r.fit.ratioFor(k)!;
    assert.ok(Number.isFinite(R));
    assert.equal(r.fit.role(k), "extrapolated");
    assert.ok(Number.isFinite(R * x.get(k)!));
  }
  assert.ok(Number.isFinite(r.fit.se) && r.fit.se > 0);
});

test("12. the exact order is the quick sample, then the rest of the u/x order: a stopped run leaves certainties plus a prefix", () => {
  const pop = synthPop(1500, 12);
  const plan = planQuick(pop, 270, "s", NONE);
  const previews = pop.filter((o) => o.preview).map((o) => o.key);
  assert.equal(plan.order.length, pop.length, "every uncached output");
  assert.deepEqual(new Set(plan.order.slice(0, previews.length)), new Set(previews));
  assert.deepEqual(plan.order.slice(previews.length, previews.length + plan.certain.size), [...plan.certain]);
  assert.deepEqual(plan.order.slice(previews.length + plan.certain.size), plan.ranked, "then the whole u/x order");
  // The run cut after `stop`: a fit sees certainties plus the first outputs of the u/x order.
  const d = new Map(pop.map((o) => [o.key, o.d]));
  const stop = 600;
  const fit = fitQuick(plan, new Map(plan.order.slice(0, stop).map((k) => [k, d.get(k)!])), NONE);
  const k = stop - previews.length - plan.certain.size;
  const X = plan.ranked.reduce((a, key) => a + plan.x.get(key)!, 0);
  // Past the planned budget some reach π = 1: measured, but no weight in R.
  const rows = plan.ranked.slice(0, k).filter((key) => (k * plan.x.get(key)!) / X < 1).length;
  assert.ok(rows < k);
  assert.equal(fit.rows, rows);
  assert.equal(fit.unmeasured.length, pop.length - stop);
  assert.ok(plan.ranked.slice(0, k).every((key) => fit.role(key) === "sample"));
});

// ---------------------------------------------------------------- 14. the reference implementation

// Reference numbers from the simulator's pps-band-seq (sim/design-pps.mjs, `pps${seed}` salt:
// planQuick with salt `pps${seed}` draws the same u) on synthPop(1500, 1), budget 270.
const SIM = [
  { seed: 0, est: 6023005.993697455, se: 167852.52187379764 },
  { seed: 1, est: 5692565.72836812, se: 153938.4662234467 },
  { seed: 2, est: 6110404.212133465, se: 161308.83683056355 },
  { seed: 3, est: 6053100.920609813, se: 152641.47651703723 },
  { seed: 7, est: 6000304.718388166, se: 148968.14175668499 },
];

/**
 * An oracle copied from the simulator (design-pps.mjs's ppsProbs and bands; the judge's
 * cut.mjs for a run cut to the first k of the u/x order, π recomputed with k).
 */
function oracle(pop: Out[], B: number, seed: number, frac: number): { est: number; se: number } | null {
  const unit = (key: string) => (createHash("sha1").update(`pps${seed}\0${key}`).digest().readUIntBE(0, 6) + 0.5) / 2 ** 48;
  const BAND = (x: number) => Math.floor(Math.log2(Math.max(1, x) / 500));
  const pv = pop.filter((j) => j.preview);
  const other = pop.filter((j) => !j.preview);
  let e = pv.reduce((a, j) => a + j.d, 0);
  const n0 = B - pv.length;
  if (other.length <= n0) return { est: e + other.reduce((a, j) => a + j.d, 0), se: 0 };
  const pi0 = new Map<string, number>();
  let rest = [...other].sort((a, b) => b.x - a.x);
  let left = n0;
  for (;;) {
    const tot = rest.reduce((a, j) => a + j.x, 0);
    if (!rest.length || left <= 0 || tot <= 0) break;
    const c = left / tot;
    if (c * rest[0]!.x >= 1) {
      pi0.set(rest[0]!.key, 1);
      rest = rest.slice(1);
      left--;
      continue;
    }
    for (const j of rest) pi0.set(j.key, c * j.x);
    rest = [];
  }
  for (const j of rest) pi0.set(j.key, 0);
  const cert = other.filter((j) => pi0.get(j.key)! >= 1);
  const nc = other.filter((j) => pi0.get(j.key)! < 1).sort((a, b) => unit(a.key) / a.x - unit(b.key) / b.x);
  const k = Math.round(frac * (n0 - cert.length));
  const X = nc.reduce((a, j) => a + j.x, 0);
  const rows = nc.slice(0, k).map((j) => {
    const p = Math.min(1, (k * j.x) / X);
    return { x: j.x, d: j.d, p, w: (1 - p) / p };
  }).filter((r) => r.w > 0);
  if (rows.length < MIN_QUICK_SAMPLE) return null;
  const bands = [...new Set(other.map((j) => BAND(j.x)))].sort((a, b) => a - b);
  const merged: number[][] = [];
  let cur: number[] = [];
  let c = 0;
  for (const b of bands) {
    cur.push(b);
    c += rows.filter((r) => BAND(r.x) === b).length;
    if (c >= MIN_QUICK_SAMPLE) {
      merged.push(cur);
      cur = [];
      c = 0;
    }
  }
  if (cur.length) {
    if (merged.length) merged.at(-1)!.push(...cur);
    else merged.push(cur);
  }
  const ratio = (rs: typeof rows) => {
    let a = 0;
    let b = 0;
    for (const r of rs) {
      a += r.w * r.d;
      b += r.w * r.x;
    }
    return b > 0 ? a / b : null;
  };
  const pooled = ratio(rows)!;
  const g = new Map<number, number | null>();
  for (const m of merged) {
    const s = new Set(m);
    const rs = rows.filter((r) => s.has(BAND(r.x)));
    for (const b of m) g.set(b, rs.length >= MIN_QUICK_SAMPLE ? ratio(rs) : null);
  }
  const R = (x: number) => g.get(BAND(x)) ?? pooled;
  for (const j of cert) e += j.d;
  nc.forEach((j, i) => {
    e += i < k ? j.d : R(j.x) * j.x;
  });
  let v = 0;
  for (const r of rows) v += ((1 - r.p) / (r.p * r.p)) * (r.d - R(r.x) * r.x) ** 2;
  return { est: e, se: Math.sqrt(v) };
}

test("14. planQuick/fitQuick match the simulator's reference implementation", () => {
  const pop = synthPop(1500, 1);
  const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);
  for (const s of SIM) {
    const r = quickRun(pop, 270, `pps${s.seed}`);
    close(r.est, s.est, `seed ${s.seed} estimate`);
    close(r.fit.se, s.se, `seed ${s.seed} se`);
  }
  // The copied oracle, including runs cut short by the clock.
  for (const seed of [0, 4, 9, 13]) {
    for (const frac of [1, 0.5, 0.25]) {
      const want = oracle(pop, 270, seed, frac)!;
      const plan = planQuick(pop, 270, `pps${seed}`, NONE);
      const k = Math.round(frac * (plan.quick - plan.certain.size - pop.filter((o) => o.preview).length));
      const r = quickRun(pop, 270, `pps${seed}`, NONE, { k });
      close(r.est, want.est, `seed ${seed} at ${frac}: estimate`);
      close(r.fit.se, want.se, `seed ${seed} at ${frac}: se`);
    }
  }
});
