#!/usr/bin/env node
/**
 * SmartILR Regression Test Runner
 *
 * Usage:
 *   node tests/run_regression.js                   # run all tests
 *   node tests/run_regression.js --id R-001        # run a single test by id
 *   node tests/run_regression.js --host localhost --port 23888
 *
 * Groups run sequentially (to avoid API rate limits).
 * Within each group all language variants run concurrently.
 * Exits 0 if all pass, 1 if any fail or error.
 */

import http from "node:http";
import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const HOST   = getArg("--host") ?? "localhost";
const PORT   = parseInt(getArg("--port") ?? "23888", 10);
const FILTER = getArg("--id");   // optional: only run this test id

// ── Level ordering ────────────────────────────────────────────────────────────
const LEVELS  = ["1", "1+", "2", "2+", "3"];
const lvlIdx  = (l) => LEVELS.indexOf(String(l ?? "").trim());

function meetsExpectation(result, test) {
  const a = lvlIdx(result.displayLevel);
  switch (test.tolerance) {
    case "exact":   return a === lvlIdx(test.expectedLevel);
    case "atLeast": return a >= lvlIdx(test.expectedLevel);
    case "range":   return a >= lvlIdx(test.expectedMin) && a <= lvlIdx(test.expectedMax);
    default:        return a === lvlIdx(test.expectedLevel);
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function request(urlPath, contentType, body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === "string" ? Buffer.from(body, "utf8") : body;
    const req  = http.request(
      { hostname: HOST, port: PORT, path: urlPath, method: "POST",
        headers: { "Content-Type": contentType, "Content-Length": data.length } },
      (res) => {
        let buf = "";
        res.on("data", (c) => { buf += c; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(buf)); }
            catch (e) { reject(new Error(`JSON parse error: ${buf.slice(0, 300)}`)); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(110000, () => req.destroy(new Error("Request timed out (110s)")));
    req.write(data);
    req.end();
  });
}

function postJSON(urlPath, body) {
  return request(urlPath, "application/json", JSON.stringify(body));
}

function postMultipart(urlPath, fields) {
  const boundary = "RegressionBound" + Date.now();
  let body = "";
  for (const [name, value] of Object.entries(fields)) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return request(urlPath, `multipart/form-data; boundary=${boundary}`, body);
}

// ── Colour helpers ────────────────────────────────────────────────────────────
const C = { reset:"\x1b[0m", green:"\x1b[32m", red:"\x1b[31m",
            yellow:"\x1b[33m", bold:"\x1b[1m", dim:"\x1b[2m" };
const pOk   = (s) => `${C.green}PASS${C.reset}  ${s}`;
const pFail = (s) => `${C.red}FAIL${C.reset}  ${s}`;
const pWarn = (s) => `${C.yellow}WARN${C.reset}  ${s}`;

function expectLabel(test) {
  switch (test.tolerance) {
    case "exact":   return `expected exactly ${test.expectedLevel}`;
    case "atLeast": return `expected ≥ ${test.expectedLevel}`;
    case "range":   return `expected ${test.expectedMin}..${test.expectedMax}`;
    default:        return `expected ${test.expectedLevel}`;
  }
}

// ── Run one passage ───────────────────────────────────────────────────────────
async function runPassage(test, passage) {
  const tag = `  [${passage.language.padEnd(8)}]`;
  try {
    const result = test.mode === "listening"
      ? await postMultipart("/api/listening-rating", { transcript: passage.text, language: passage.language })
      : await postJSON("/api/ilr-rating", { passage: passage.text, language: passage.language, mode: test.mode });

    const actual = String(result.displayLevel ?? "?").trim();
    const raw    = String(result.rawModelLevel ?? "?").trim();
    const gate   = String(result.gatedMinimumLevel ?? "?").trim();
    const dtype  = result.discourseType ?? "?";
    const extras = [
      result.ceilingApplied   ? "[ceiling]" : "",
      result.hardFloorApplied ? "[floor]"   : "",
    ].filter(Boolean).join(" ");
    const detail = `raw=${raw} gate=${gate} final=${C.bold}${actual}${C.reset}${extras ? " "+extras : ""}  type="${dtype}"`;

    if (meetsExpectation(result, test)) {
      return { line: pOk(`${tag}  ${detail}`), pass: true };
    }
    const msg = `${tag}  ${detail}  ← ${expectLabel(test)}`;
    return { line: pFail(msg), pass: false, failure: { id: test.id, label: test.label, lang: passage.language, msg } };
  } catch (err) {
    const msg = `${tag}  ERROR: ${err.message}`;
    return { line: pWarn(msg), pass: false, error: true, failure: { id: test.id, label: test.label, lang: passage.language, msg } };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const suite = JSON.parse(fs.readFileSync(path.join(__dirname, "benchmarks.json"), "utf8"));
  const tests = FILTER ? suite.tests.filter((t) => t.id === FILTER) : suite.tests;

  if (FILTER && tests.length === 0) {
    console.error(`No test found with id="${FILTER}". Valid ids: ${suite.tests.map(t=>t.id).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n${C.bold}SmartILR Regression Suite v${suite.version}${C.reset}`);
  console.log(`${C.dim}${suite.description}${C.reset}`);
  console.log(`${C.dim}Target: http://${HOST}:${PORT}  |  Running ${tests.length} of ${suite.tests.length} test groups${C.reset}\n`);

  let nPass = 0, nFail = 0, nErr = 0;
  const failures = [];

  // Groups run sequentially; passages within each group run concurrently
  for (const test of tests) {
    console.log(`${C.bold}${test.id}  ${test.label}${C.reset}`);
    console.log(`${C.dim}  ${expectLabel(test)}${C.reset}`);

    const outcomes = await Promise.all(test.passages.map((p) => runPassage(test, p)));

    for (const o of outcomes) {
      console.log(o.line);
      if (o.pass)       { nPass++; }
      else if (o.error) { nErr++;  failures.push(o.failure); }
      else              { nFail++; failures.push(o.failure); }
    }
    console.log();
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const total  = nPass + nFail + nErr;
  const colour = (nFail + nErr > 0) ? C.red : C.green;
  console.log("─".repeat(70));
  console.log(`${C.bold}${colour}${nPass}/${total} passed${C.reset}  (${nFail} failed, ${nErr} errored)`);

  if (failures.length) {
    console.log(`\n${C.red}${C.bold}Failures:${C.reset}`);
    for (const f of failures) {
      console.log(`  ${f.id} [${f.lang}]  ${f.label}`);
      console.log(`    ${f.msg}`);
    }
  }

  console.log();
  process.exit(nFail > 0 || nErr > 0 ? 1 : 0);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
