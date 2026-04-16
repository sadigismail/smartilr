/**
 * benchmark_upper_band.mjs
 *
 * Offline validation of the ILR 3 → 5 rubric using the live engine pipeline:
 *   normalizeSignals → applyHardGates → applyBoundaryEngine
 *
 * No AI calls.  Each test case supplies pre-set detectedSignals that represent
 * what the model would return for a canonical passage at that level.
 *
 * Run:  node artifacts/smartilr-server/test/benchmark_upper_band.mjs
 */

import { normalizeSignals, levelIndex }  from "../engine/ilrRules.js";
import { applyHardGates }                from "../engine/hardGates.js";
import { applyBoundaryEngine }           from "../engine/boundaryEngine.js";

// ── Palette colours (ANSI) ────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  cyan:   "\x1b[36m",
  grey:   "\x1b[90m",
  magenta:"\x1b[35m",
};

// ── Shared signal bases ───────────────────────────────────────────────────────

/** All signals that qualify a passage as a clean ILR 3 (not 3+). */
const BASE_3 = {
  // paragraph / multi-segment
  paragraphLevelDiscourse:    true,
  multiparagraphArgument:     true,
  paragraphDependency:        true,
  detailIntegration:          true,
  multipleDistinctIdeas:      true,
  // inference
  heavyInference:             true,
  significantInference:       true,
  moderateInference:          true,
  // abstraction / complexity
  abstractReasoning:          true,
  conceptualVocabulary:       true,
  embeddedStructure:          true,
  crossSentenceDependency:    true,
  // ILR 3 discriminators
  layeredReasoning:           true,
  implicitMeaning:            true,
  nuancedPerspective:         true,
  stanceDetection:            true,
  // ILR 3 exclusion signals — MUST be false
  isExplanatoryText:          false,
  isSimpleArgument:           false,
  // 3+ signals — absent at ILR 3
  sustainedAbstraction:       false,
  crossParagraphInference:    false,
  conceptualDensity:          false,
  rhetoricalNuance:           false,
  stylisticSophistication:    false,
  intellectualNativeDiscourse:false,
  multiLayerMeaning:          false,
  noScaffolding:              false,
};

/** Adds 3+ discriminators to BASE_3 (still blocks ILR 4). */
const BASE_3PLUS = {
  ...BASE_3,
  sustainedAbstraction:    true,
  crossParagraphInference: true,
  // conceptualDensity absent → blocks ILR 4
};

/** Adds ILR 4 requirements to BASE_3PLUS (still blocks ILR 4+). */
const BASE_4 = {
  ...BASE_3PLUS,
  conceptualDensity:       true,
  rhetoricalNuance:        true,   // satisfies rhetoricalOrStylistic for ILR 4
  // stylisticSophistication absent → blocks ILR 4+ (needs BOTH)
};

/** Adds ILR 4+ requirements (still blocks ILR 5). */
const BASE_4PLUS = {
  ...BASE_4,
  stylisticSophistication: true,
  // intellectualNativeDiscourse, multiLayerMeaning, noScaffolding absent → blocks 5
};

/** Full ILR 5 signal set. */
const BASE_5 = {
  ...BASE_4PLUS,
  intellectualNativeDiscourse: true,
  multiLayerMeaning:           true,
  noScaffolding:               true,
};

// ── Listening signal injection (mirrors scoringEngine.js lsStructure logic) ──

function injectListeningSignals(signals, lsStructure, lsInference, lsDiscourseLength) {
  const str  = (lsStructure      || "").toLowerCase().trim();
  const inf  = (lsInference      || "").toLowerCase().trim();
  const disc = (lsDiscourseLength|| "").toLowerCase().trim();

  if (str === "analytical" && inf === "significant" && disc === "extended") {
    signals.multiparagraphArgument  = true;
    signals.paragraphDependency     = true;
    signals.layeredReasoning        = true;
    signals.implicitMeaning         = true;
    signals.heavyInference          = true;
    signals.abstractReasoning       = true;
    signals.stanceDetection         = true;
    signals.nuancedPerspective      = true;
    signals.significantInference    = true;
    signals.conceptualVocabulary    = true;
    signals.embeddedStructure       = true;
    signals.paragraphLevelDiscourse = true;
    signals.detailIntegration       = true;
    signals.multipleDistinctIdeas   = true;
    signals.crossSentenceDependency = true;
    signals.isExplanatoryText       = false;
    signals.isSimpleArgument        = false;
  } else if (str === "analytical" && (inf === "significant" || inf === "moderate")) {
    signals.stanceDetection         = true;
    signals.significantInference    = signals.significantInference || inf === "significant";
    signals.moderateInference       = signals.moderateInference    || inf === "moderate";
    signals.paragraphDependency     = true;
    signals.paragraphLevelDiscourse = true;
    signals.detailIntegration       = true;
    signals.multipleDistinctIdeas   = true;
  }
  return signals;
}

// ── Test case definitions ─────────────────────────────────────────────────────

const CASES = [

  // ── READING ─────────────────────────────────────────────────────────────────

  {
    id:            "R-3",
    label:         "READING — ILR 3 (clean; must NOT reach 3+)",
    mode:          "reading",
    rawModelLevel: "3",
    discourseType: "argumentative essay",
    signals:       BASE_3,
    expectLevel:   "3",
    inflationCheck:"3+ gate MUST fail (sustainedAbstraction=false, crossParagraphInference=false)",
  },

  {
    id:            "R-3-INFLATE",
    label:         "READING — ILR 3 inflation attempt (sustainedAbstraction=true but no crossParagraphInference)",
    mode:          "reading",
    rawModelLevel: "3+",
    discourseType: "argumentative essay",
    signals:       { ...BASE_3, sustainedAbstraction: true },
    expectLevel:   "3",
    inflationCheck:"3+ gate MUST fail (crossParagraphInference=false → 2 of 3 conditions)",
  },

  {
    id:            "R-3PLUS",
    label:         "READING — ILR 3+ (clean; must NOT reach 4)",
    mode:          "reading",
    rawModelLevel: "3+",
    discourseType: "argumentative essay",
    signals:       BASE_3PLUS,
    expectLevel:   "3+",
    inflationCheck:"4 gate MUST fail (conceptualDensity=false, rhetoricalOrStylistic=false)",
  },

  {
    id:            "R-3PLUS-TO-4",
    label:         "READING — ILR 3+ correctly reaching 4 (conceptualDensity without rhetorical signals)",
    mode:          "reading",
    rawModelLevel: "4",
    discourseType: "argumentative essay",
    signals:       { ...BASE_3PLUS, conceptualDensity: true },
    expectLevel:   "4",
    inflationCheck:"4+ gate MUST fail (rhetoricalNuance=false, stylisticSophistication=false)",
  },

  {
    id:            "R-3PLUS-INFLATE",
    label:         "READING — 3+→4 inflation attempt (conceptualDensity=true but implicitMeaning=false)",
    mode:          "reading",
    rawModelLevel: "4",
    discourseType: "argumentative essay",
    signals:       { ...BASE_3PLUS, conceptualDensity: true, implicitMeaning: false },
    expectLevel:   "3+",
    inflationCheck:"4 gate MUST fail (implicitStance=false: implicitMeaning is required alongside stanceDetection)",
  },

  {
    id:            "R-4",
    label:         "READING — ILR 4 (clean; must NOT reach 4+)",
    mode:          "reading",
    rawModelLevel: "4",
    discourseType: "argumentative essay",
    signals:       BASE_4,
    expectLevel:   "4",
    inflationCheck:"4+ gate MUST fail (stylisticSophistication=false → rhetoricalNuance alone is not enough)",
  },

  {
    id:            "R-4PLUS",
    label:         "READING — ILR 4+ (clean; must NOT reach 5)",
    mode:          "reading",
    rawModelLevel: "4+",
    discourseType: "argumentative essay",
    signals:       BASE_4PLUS,
    expectLevel:   "4+",
    inflationCheck:"5 gate MUST fail (intellectualNativeDiscourse=false, multiLayerMeaning=false, noScaffolding=false)",
  },

  {
    id:            "R-4PLUS-INFLATE",
    label:         "READING — 4+→5 inflation attempt (two of three ILR 5 signals present)",
    mode:          "reading",
    rawModelLevel: "5",
    discourseType: "argumentative essay",
    signals:       { ...BASE_4PLUS, intellectualNativeDiscourse: true, multiLayerMeaning: true },
    expectLevel:   "4+",
    inflationCheck:"5 gate MUST fail (noScaffolding=false → missing third condition)",
  },

  {
    id:            "R-5",
    label:         "READING — ILR 5 (full; all conditions met)",
    mode:          "reading",
    rawModelLevel: "5",
    discourseType: "argumentative essay",
    signals:       BASE_5,
    expectLevel:   "5",
    inflationCheck:"N/A — ILR 5 is the ceiling",
  },

  // ── LISTENING ────────────────────────────────────────────────────────────────

  {
    id:            "L-3",
    label:         "LISTENING — ILR 3 (lsStructure=analytical/significant/extended; no extra 3+ signals)",
    mode:          "listening",
    rawModelLevel: "3",
    discourseType: "lecture",
    lsStructure:      "analytical",
    lsInference:      "significant",
    lsDiscourseLength:"extended",
    signals:       {
      isExplanatoryText:        false,
      isSimpleArgument:         false,
      sustainedAbstraction:     false,
      crossParagraphInference:  false,
      conceptualDensity:        false,
      rhetoricalNuance:         false,
      stylisticSophistication:  false,
      intellectualNativeDiscourse: false,
      multiLayerMeaning:        false,
      noScaffolding:            false,
    },
    expectLevel:   "3",
    inflationCheck:"3+ gate MUST fail (sustainedAbstraction=false, crossParagraphInference=false — not injected by lsStructure)",
  },

  {
    id:            "L-3PLUS",
    label:         "LISTENING — ILR 3+ (analytical/significant/extended + sustainedAbstraction + crossParagraphInference)",
    mode:          "listening",
    rawModelLevel: "3+",
    discourseType: "lecture",
    lsStructure:      "analytical",
    lsInference:      "significant",
    lsDiscourseLength:"extended",
    signals:       {
      isExplanatoryText:        false,
      isSimpleArgument:         false,
      sustainedAbstraction:     true,
      crossParagraphInference:  true,
      conceptualDensity:        false,
      rhetoricalNuance:         false,
      stylisticSophistication:  false,
      intellectualNativeDiscourse: false,
      multiLayerMeaning:        false,
      noScaffolding:            false,
    },
    expectLevel:   "3+",
    inflationCheck:"4 gate MUST fail (conceptualDensity=false)",
  },
];

// ── Engine runner ─────────────────────────────────────────────────────────────

function runCase(tc) {
  // 1. Inject listening signals when applicable
  const rawSignals = { ...tc.signals };
  if (tc.mode === "listening" && tc.lsStructure) {
    injectListeningSignals(rawSignals, tc.lsStructure, tc.lsInference, tc.lsDiscourseLength);
  }

  // 2. Normalize signals (same as applyFinalPlacement step 1)
  const signals = normalizeSignals(rawSignals);

  // 3. Run hard gates (same as step 3 of applyFinalPlacement)
  const gateResult = applyHardGates(tc.rawModelLevel, signals);

  // 4. Run boundary engine (same as step 4 of applyFinalPlacement)
  const boundaryResult = applyBoundaryEngine(tc.rawModelLevel, signals, tc.mode);

  // 5. Final level = higher of gate and boundary results
  const gateLevel     = gateResult.finalLevel;
  const boundaryLevel = boundaryResult.finalLevel;
  const finalLevel    = levelIndex(gateLevel) >= levelIndex(boundaryLevel) ? gateLevel : boundaryLevel;

  const pass = finalLevel === tc.expectLevel;

  return { tc, signals, gateResult, boundaryResult, gateLevel, boundaryLevel, finalLevel, pass };
}

// ── Reporting helpers ─────────────────────────────────────────────────────────

function tick(pass) { return pass ? `${C.green}✓ PASS${C.reset}` : `${C.red}✗ FAIL${C.reset}`; }

function gateRow(g) {
  const icon = g.passed ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
  const conds = Object.entries(g.conditions || {})
    .map(([k, v]) => `${v ? C.green : C.red}${k}=${v}${C.reset}`)
    .join("  ");
  return `   ${icon} ${C.bold}${g.gate}${C.reset} [${g.threshold}]  ${conds || ""}`;
}

function sigBlock(label, signals, keys) {
  const vals = keys.map(k =>
    `    ${signals[k] ? C.green : C.grey}${k}: ${signals[k]}${C.reset}`
  ).join("\n");
  return `  ${C.cyan}${label}${C.reset}\n${vals}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const results = CASES.map(runCase);

let passCount = 0;
let failCount = 0;

for (const r of results) {
  const { tc, signals, gateResult, boundaryResult, gateLevel, boundaryLevel, finalLevel, pass } = r;

  pass ? passCount++ : failCount++;

  console.log(`\n${"─".repeat(90)}`);
  console.log(`${C.bold}${C.magenta}[${tc.id}]${C.reset} ${C.bold}${tc.label}${C.reset}`);
  console.log(`  rawModelLevel:    ${C.bold}${tc.rawModelLevel}${C.reset}   |   mode: ${tc.mode}`);
  console.log(`  expected level:   ${C.bold}${tc.expectLevel}${C.reset}`);

  // ── 1. Key signals ─────────────────────────────────────────────────────────
  console.log("\n  ── Key discriminator signals ──────────────────────────────────────");
  const upperKeys = [
    "heavyInference","layeredReasoning","implicitMeaning","nuancedPerspective",
    "stanceDetection","isExplanatoryText","isSimpleArgument",
    "sustainedAbstraction","crossParagraphInference","conceptualDensity",
    "rhetoricalNuance","stylisticSophistication",
    "intellectualNativeDiscourse","multiLayerMeaning","noScaffolding",
  ];
  console.log(sigBlock("", signals, upperKeys));

  // ── 2. Hard gate results ───────────────────────────────────────────────────
  console.log("\n  ── Hard gate pipeline ─────────────────────────────────────────────");
  const upperGates = gateResult.gateLog.filter(g =>
    ["ILR_3_GATE","ILR_3PLUS_GATE","ILR_4_GATE","ILR_4PLUS_GATE","ILR_5_GATE"].includes(g.gate)
  );
  if (upperGates.length === 0) {
    console.log(`   ${C.grey}(no upper-band gates evaluated)${C.reset}`);
  } else {
    for (const g of upperGates) console.log(gateRow(g));
  }
  if (gateResult.demotedFrom) {
    console.log(`   ${C.yellow}⬇  demoted from ${gateResult.demotedFrom} → ${gateLevel}${C.reset}`);
  }
  console.log(`   gate final level: ${C.bold}${gateLevel}${C.reset}`);

  // ── 3. Boundary engine ─────────────────────────────────────────────────────
  console.log("\n  ── Boundary engine ────────────────────────────────────────────────");
  if (boundaryResult.boundaryLabel) {
    console.log(`   highest boundary crossed: ${C.bold}${boundaryResult.boundaryLabel}${C.reset}`);
  }
  console.log(`   boundary final level:  ${C.bold}${boundaryLevel}${C.reset}`);

  // ── 4. Final result ────────────────────────────────────────────────────────
  console.log("\n  ── Final result ───────────────────────────────────────────────────");
  console.log(`   assigned level: ${C.bold}${finalLevel}${C.reset}   expected: ${C.bold}${tc.expectLevel}${C.reset}   ${tick(pass)}`);

  // ── 5. Why not higher ─────────────────────────────────────────────────────
  console.log(`\n  ── Why not higher? ────────────────────────────────────────────────`);
  const nextGate = upperGates.find(g => !g.passed);
  if (nextGate && nextGate.failedConditions.length > 0) {
    console.log(`   ${C.yellow}Failed gate: ${nextGate.gate}${C.reset}`);
    console.log(`   Missing: ${nextGate.failedConditions.map(k => C.red + k + C.reset).join(", ")}`);
  } else if (tc.expectLevel === "5") {
    console.log(`   ${C.grey}ILR 5 is the ceiling — no higher level exists.${C.reset}`);
  } else {
    console.log(`   ${C.grey}${tc.inflationCheck}${C.reset}`);
  }

  if (!pass) {
    console.log(`   ${C.red}${C.bold}⚠  UNEXPECTED RESULT — got ${finalLevel}, expected ${tc.expectLevel}${C.reset}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(90)}`);
console.log(`${C.bold}BENCHMARK SUMMARY${C.reset}`);
console.log(`  Total:  ${CASES.length}`);
console.log(`  ${C.green}Pass:   ${passCount}${C.reset}`);
if (failCount > 0) {
  console.log(`  ${C.red}Fail:   ${failCount}${C.reset}`);
} else {
  console.log(`  ${C.grey}Fail:   0${C.reset}`);
}
console.log(`${"═".repeat(90)}\n`);

process.exit(failCount > 0 ? 1 : 0);
