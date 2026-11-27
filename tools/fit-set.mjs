// Turns admins' swipes into a learned star set (Scores + Sets tabs). Run by a developer with Claude;
// the steps are in docs/star-sets.md. No libraries.
//
//   1. node tools/fit-set.mjs anchors <swipes.csv> <places.csv>
//        Fits the swipes (Bradley–Terry, js/rank.js), holds back 12 swiped places for a check, and writes
//        fit-work.json: the anchor places (best first) and the places Claude still has to rate.
//   2. Claude rates every place in "toRate" by putting it between two anchors → placements.csv with
//        columns place_id,k,pos (k = the anchor just above it, -1 = above the best; pos = closer_top /
//        middle / closer_bottom). Two passes = two rows per place: they are averaged.
//   3. node tools/fit-set.mjs build fit-work.json placements.csv <places.csv> <types.csv> <set_id> "<event>" <swipes.csv>
//        Prints the check (how often the new scores and today's rule pick the swipe winner of the held-back
//        places), then writes scores.csv and set.csv to paste into the Scores and Sets tabs.
import fs from "node:fs";
import { parseCSV } from "../tests/csv.js";
import { fitBT, swipesToComparisons, placeBetween, sharesToThresholds, starsFromScore } from "../js/rank.js";
import { stars, eventWeights } from "../js/logic.js";

const table = f => { const [head, ...rows] = parseCSV(fs.readFileSync(f, "utf8")); return rows.map(r => Object.fromEntries(head.map((k, i) => [k, r[i]]))); };
const active = p => !/^(false|no|0)$/i.test(String(p.active ?? "TRUE").trim());
const [cmd, ...args] = process.argv.slice(2);

if (cmd === "anchors") {
  const [swipesFile, placesFile] = args;
  const comps = swipesToComparisons(table(swipesFile)), places = table(placesFile).filter(active);
  const swiped = [...new Set(comps.flatMap(c => [c.a, c.b]))];
  const all = fitBT(swiped, comps), ranked = [...swiped].sort((x, y) => all.get(y).score - all.get(x).score);
  // 12 held-back places, spread over the whole range (every n-th), for an honest check afterwards.
  const step = Math.max(1, Math.floor(ranked.length / 12)), heldout = ranked.filter((_, i) => i % step === step >> 1).slice(0, 12);
  const train = comps.filter(c => !heldout.includes(c.a) && !heldout.includes(c.b));
  const fitted = fitBT(swiped.filter(id => !heldout.includes(id)), train);
  const order = [...fitted.keys()].sort((x, y) => fitted.get(y).score - fitted.get(x).score);
  const anchors = Array.from({ length: 9 }, (_, i) => order[Math.round(i * (order.length - 1) / 8)])
    .map(id => { const p = places.find(q => q.place_id === id); return { place_id: id, name: p?.name, type: p?.type, address: p?.address, score: fitted.get(id).score }; });
  const toRate = places.map(p => p.place_id).filter(id => !fitted.has(id));
  fs.writeFileSync("fit-work.json", JSON.stringify({ heldout, anchors, toRate, comparisons: comps.length }, null, 1));
  console.log(`${comps.length} comparisons over ${swiped.length} places; ${heldout.length} held back; ${toRate.length} to rate. Anchors (best first):`);
  anchors.forEach((a, k) => console.log(`  ${k}. ${a.name} (${a.type}) ${a.score.toFixed(2)}`));
} else if (cmd === "build") {
  const [workFile, placementsFile, placesFile, typesFile, setId, event] = args;
  const work = JSON.parse(fs.readFileSync(workFile, "utf8")), places = table(placesFile).filter(active);
  const comps = swipesToComparisons(table(args[6] || "swipes.csv"));
  // Claude's placements → scores (passes averaged).
  const placed = {};
  for (const r of table(placementsFile)) (placed[r.place_id] ||= []).push(placeBetween(work.anchors, +r.k, r.pos));
  const predicted = Object.fromEntries(Object.entries(placed).map(([id, xs]) => [id, xs.reduce((a, b) => a + b, 0) / xs.length]));
  // The check: on swipes that involve a held-back place, who picks the winner more often?
  const swiped = [...new Set(comps.flatMap(c => [c.a, c.b]))], final = fitBT(swiped, comps);
  const train = fitBT(swiped.filter(id => !work.heldout.includes(id)), comps.filter(c => !work.heldout.includes(c.a) && !work.heldout.includes(c.b)));
  const newScore = id => predicted[id] ?? train.get(id)?.score ?? 0;
  const w = eventWeights(table(typesFile), event), byId = new Map(places.map(p => [p.place_id, p]));
  const ruleScore = id => (byId.has(id) ? stars(byId.get(id), w) : 0);
  const test = comps.filter(c => c.y !== 0.5 && (work.heldout.includes(c.a) || work.heldout.includes(c.b)));
  const hit = f => test.reduce((n, c) => n + (f(c.a) === f(c.b) ? 0.5 : (f(c.a) > f(c.b)) === (c.y === 1) ? 1 : 0), 0) / (test.length || 1);
  console.log(`Check on ${test.length} swipes with a held-back place: new scores ${(100 * hit(newScore)).toFixed(0)}% right, today's rule ${(100 * hit(ruleScore)).toFixed(0)}% right.`);
  // The set: swiped places from the fit on all swipes, the rest from Claude's placements.
  const now = new Date().toISOString().slice(0, 10), rows = [];
  for (const p of places) {
    const f = final.get(p.place_id), score = f ? f.score : predicted[p.place_id];
    if (score === undefined) continue;
    rows.push([setId, p.place_id, score.toFixed(3), f ? "swiped" : "predicted", f ? "bradley-terry" : "claude/protocol-v1", f ? f.n : 0, now]);
  }
  const t = sharesToThresholds(rows.map(r => +r[2]));
  const count = [0, 0, 0, 0]; rows.forEach(r => count[starsFromScore(+r[2], t)]++);
  fs.writeFileSync("scores.csv", ["set_id,place_id,score,source,rater,n,updated_at", ...rows.map(r => r.join(","))].join("\n") + "\n");
  fs.writeFileSync("set.csv", `set_id,event,t3,t2,t1,made_by,made_at,note\n${setId},${event},${t.t3.toFixed(3)},${t.t2.toFixed(3)},${t.t1.toFixed(3)},Claude,${now},"${comps.length} swipes"\n`);
  console.log(`${rows.length} scores. Stars 3/2/1/0: ${count[3]}/${count[2]}/${count[1]}/${count[0]}. Wrote scores.csv and set.csv.`);
} else {
  console.log("usage: see the top of tools/fit-set.mjs");
}
