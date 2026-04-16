// ─────────────────────────────────────────────────────────────────────────────
// server.js — SmartILR API server
//
// HTTP layer only.  All ILR logic lives in engine/:
//   engine/thresholds.js      — tunable config (levels, gates, phrases)
//   engine/ilrRules.js        — level utilities, signal normalization, discourse floor
//   engine/modalityRules.js   — reading/listening ceiling & floor rules
//   engine/explanationEngine.js — mandatory phrases, scope text, gate rationale
//   engine/resultFormatter.js  — confidence, dimension scores, result assembly
//   engine/scoringEngine.js    — full placement pipeline (orchestrator)
//   engine/prompts.js          — prompt builders + OpenAI model call
// ─────────────────────────────────────────────────────────────────────────────

import express  from "express";
import path     from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { createHash, randomUUID } from "crypto";
import { execFile, spawn, execSync } from "child_process";
import { promisify }     from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir }        from "os";
import OpenAI   from "openai";
import multer   from "multer";
import mammoth  from "mammoth";
import fs       from "fs";

const execFileAsync = promisify(execFile);

// pdf-parse is CJS-only; use createRequire to load it in an ESM context
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

import { applyFinalPlacement }        from "./engine/scoringEngine.js";
import { analyzePassageWithModel, analyzeAudioDirectlyWithModel, analyzeSpeakingWithModel } from "./engine/prompts.js";
import { computeLinguisticView }      from "./engine/linguisticViewEngine.js";
import { computeWordAnalysis }         from "./engine/wordAnalysisEngine.js";
import { detectModeFromText }          from "./engine/modalityBranches.js";
import { assessTranscriptQuality, TRANSCRIPT_QUALITY_NOTE } from "./engine/transcriptQualityEngine.js";
import { capConfidenceForTranscriptQuality } from "./engine/confidenceEngine.js";
import { AUDIO_SCORING_MODEL, TEXT_SCORING_MODEL, LINGUISTIC_VIEW_MODEL, TRANSCRIPTION_MODEL, WORD_ANALYSIS_MODEL } from "./config/modelConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
const port = process.env.PORT || 3000;

// ── Build stamp — increment on every deploy to confirm active version ─────────
const BUILD_STAMP = "2026-04-10-v137d-actionChain-F8L-alefMaqsura";

// ── Media tool availability ────────────────────────────────────────────────────
//
// Resolution order (most to least reliable for production deployments):
//   1. npm packages ffmpeg-static / ffprobe-static — ship their own static
//      Linux binaries; work in any container without system packages.
//   2. OS PATH via `which` — works in dev when nix is active.
//   3. Bare name — last resort; will throw ENOENT at call time if truly missing.
//
function resolveMediaBin(name) {
  // 1. npm static binary packages (guaranteed in production after pnpm install)
  try {
    if (name === "ffmpeg") {
      const p = require("ffmpeg-static");   // returns a path string
      if (p && fs.existsSync(p)) { fs.chmodSync(p, 0o755); return p; }
    }
    if (name === "ffprobe") {
      const p = require("ffprobe-static").path;  // returns {path: "..."}
      if (p && fs.existsSync(p)) { fs.chmodSync(p, 0o755); return p; }
    }
  } catch {}

  // 2. Ask the OS via PATH (reliable when nix env is active in dev)
  try { return execSync(`which ${name}`, { timeout: 4_000 }).toString().trim(); } catch {}

  // 3. Common system directories
  for (const dir of ["/usr/local/bin", "/usr/bin", "/bin"]) {
    const candidate = `${dir}/${name}`;
    try { execSync(`test -x ${candidate}`, { timeout: 2_000 }); return candidate; } catch {}
  }

  // 4. Bare name — will throw ENOENT at call time if truly missing
  return name;
}

const FFMPEG_BIN  = resolveMediaBin("ffmpeg");
const FFPROBE_BIN = resolveMediaBin("ffprobe");

// Populated by ensureMediaToolsAvailable() at startup
let mediaToolsStatus = {
  available: false,
  ffmpegPath: FFMPEG_BIN,
  ffprobePath: FFPROBE_BIN,
  ffmpegVersion: null,
  ffprobeVersion: null,
  error: null,
};

/**
 * ensureMediaToolsAvailable — runs once at startup.
 * Executes `ffmpeg -version` and `ffprobe -version` to confirm the binaries
 * actually launch.  Sets mediaToolsStatus so every request can fast-fail with
 * an accurate message instead of a confusing ENOENT spawn error.
 */
async function ensureMediaToolsAvailable() {
  console.log(`[media-tools] checking ffmpeg at ${FFMPEG_BIN} …`);
  console.log(`[media-tools] checking ffprobe at ${FFPROBE_BIN} …`);
  console.log(`[media-tools] PATH = ${process.env.PATH}`);

  let ffmpegOk  = false;
  let ffprobeOk = false;

  try {
    const r = await spawnCapture(FFMPEG_BIN, ["-version"], { timeoutMs: 10_000 });
    const firstLine = (r.stdout || r.stderr).split("\n")[0].trim();
    if (r.code === 0 || firstLine.includes("ffmpeg version")) {
      ffmpegOk = true;
      mediaToolsStatus.ffmpegVersion = firstLine;
      console.log(`[media-tools] ffmpeg OK — ${firstLine}`);
    } else {
      console.error(`[media-tools] ffmpeg -version exited ${r.code}: ${firstLine}`);
    }
  } catch (e) {
    console.error(`[media-tools] ffmpeg launch FAILED: ${e.message}`);
    mediaToolsStatus.error = e.message;
  }

  try {
    const r = await spawnCapture(FFPROBE_BIN, ["-version"], { timeoutMs: 10_000 });
    const firstLine = (r.stdout || r.stderr).split("\n")[0].trim();
    if (r.code === 0 || firstLine.includes("ffprobe version")) {
      ffprobeOk = true;
      mediaToolsStatus.ffprobeVersion = firstLine;
      console.log(`[media-tools] ffprobe OK — ${firstLine}`);
    } else {
      console.error(`[media-tools] ffprobe -version exited ${r.code}: ${firstLine}`);
    }
  } catch (e) {
    console.error(`[media-tools] ffprobe launch FAILED: ${e.message}`);
    mediaToolsStatus.error = mediaToolsStatus.error
      ? `${mediaToolsStatus.error}; ${e.message}`
      : e.message;
  }

  mediaToolsStatus.available = ffmpegOk && ffprobeOk;

  if (!mediaToolsStatus.available) {
    console.error(
      `[media-tools] ⚠️  MEDIA PREPROCESSING UNAVAILABLE — ` +
      `ffmpegOk=${ffmpegOk} ffprobeOk=${ffprobeOk} error=${mediaToolsStatus.error}`
    );
  } else {
    console.log(`[media-tools] ✓ both binaries ready — media preprocessing enabled`);
  }
}

// Video container extensions (contain both video + audio streams).
const VIDEO_CONTAINERS = new Set(["mp4","m4v","mov","mkv","avi","webm","3gp","ts","mts","m2ts"]);
// Pure-audio extensions the proxy accepts natively (no conversion needed).
const PROXY_WAV_EXTS   = new Set(["wav","wave"]);
const PROXY_MP3_EXTS   = new Set(["mp3","mpeg","mpga"]);
// Audio extensions that need format conversion to WAV.
const AUDIO_NEEDS_CONV = new Set(["m4a","aac","ogg","oga","flac","weba"]);

/**
 * spawnCapture — run a process and collect stdout + stderr into buffers.
 * Unlike execFile/execFileAsync, this NEVER rejects on non-zero exit code.
 * The caller decides what to do with the output and exit code.
 */
function spawnCapture(bin, args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (spawnErr) {
      // spawn itself failed (e.g. ENOENT — binary not found)
      return reject(spawnErr);
    }

    const out = [], err = [];
    proc.stdout.on("data", c => out.push(c));
    proc.stderr.on("data", c => err.push(c));

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
    }, timeoutMs);

    proc.on("error", spawnErr => {
      clearTimeout(timer);
      reject(spawnErr);
    });

    proc.on("close", code => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code,
      });
    });
  });
}

/**
 * normalizeUploadedMediaToScoringAudio
 *
 * Accepts any uploaded audio or video buffer, detects streams via ffprobe,
 * extracts audio, normalises to WAV 16 kHz mono, and returns a result object.
 *
 * @param {Buffer}  inputBuffer  — raw uploaded bytes
 * @param {string}  inputExt     — lowercase file extension without dot
 * @param {string}  originalname — original filename for logging
 * @returns {Promise<{
 *   wavBuffer:            Buffer,
 *   audioStreamDetected:  boolean,
 *   sourceType:           "audio" | "video-with-audio",
 *   audioCodec:           string,
 *   audioChannels:        number,
 *   audioSampleRate:      string,
 *   normalizedFormat:     "wav-pcm-s16le-16kHz-mono",
 *   preprocessingSucceeded: true,
 * }>}
 * Throws a typed error with .code and .userMessage on any failure.
 */
async function normalizeUploadedMediaToScoringAudio(inputBuffer, inputExt, originalname) {
  const id      = Math.random().toString(36).slice(2);
  const inPath  = path.join(tmpdir(), `smartilr_${id}_in.${inputExt}`);
  const outPath = path.join(tmpdir(), `smartilr_${id}_out.wav`);

  // ── 1. Write upload to temp file (needed for seek-based formats like MP4) ──
  await writeFile(inPath, inputBuffer);
  console.log(`[preprocess] id=${id} file="${originalname}" ext=${inputExt} bytes=${inputBuffer.length} ffprobe=${FFPROBE_BIN} ffmpeg=${FFMPEG_BIN}`);

  // ── 2. Probe streams with ffprobe ─────────────────────────────────────────
  let probeData = null;
  let probeStderr = "";
  let probeCode = -1;
  try {
    const result = await spawnCapture(FFPROBE_BIN, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      inPath,
    ], { timeoutMs: 20_000 });

    probeCode   = result.code;
    probeStderr = result.stderr;

    // Parse stdout regardless of exit code — ffprobe may exit non-zero with valid JSON
    if (result.stdout.trim()) {
      try { probeData = JSON.parse(result.stdout); } catch {}
    }

    console.log(
      `[preprocess] id=${id} stage=probe-done code=${probeCode} ` +
      `streams=${probeData?.streams?.length ?? "?"} ` +
      `format=${probeData?.format?.format_name ?? "?"} ` +
      `duration=${probeData?.format?.duration ?? "?"}`
    );

    if (probeStderr.trim()) {
      console.warn(`[preprocess] id=${id} probe stderr: ${probeStderr.slice(0, 300)}`);
    }
  } catch (spawnErr) {
    // ENOENT or similar — binary truly not found
    await unlink(inPath).catch(() => {});
    const errMsg = spawnErr?.message || String(spawnErr);
    console.error(`[preprocess] id=${id} stage=probe-spawn-fail: ${errMsg} (FFPROBE_BIN=${FFPROBE_BIN})`);
    const err = new Error("ffprobe binary not found");
    err.code        = "PROBE_BINARY_MISSING";
    err.userMessage = `Server media tools are not available right now, so uploaded audio/video files cannot be processed. ` +
                      `Please try again in a few minutes.`;
    throw err;
  }

  // If probe produced no parseable JSON at all, the file is truly unreadable
  if (!probeData) {
    await unlink(inPath).catch(() => {});
    console.error(`[preprocess] id=${id} stage=probe-fail: no JSON output code=${probeCode} stderr=${probeStderr.slice(0, 300)}`);
    const err = new Error("ffprobe produced no stream data");
    err.code        = "PROBE_FAILED";
    err.userMessage = `This file could not be read as a media file. ` +
                      `It may be corrupted or use a container format that is not supported. ` +
                      `Try re-exporting or converting to MP4/MP3.`;
    throw err;
  }

  // ── 3. Inspect detected streams ───────────────────────────────────────────
  const streams     = probeData.streams || [];
  const audioStream = streams.find(s => s.codec_type === "audio");
  const videoStream = streams.find(s => s.codec_type === "video");
  const isVideoContainer = VIDEO_CONTAINERS.has(inputExt);
  const sourceType  = (videoStream && isVideoContainer) ? "video-with-audio" : "audio";

  console.log(
    `[preprocess] id=${id} stage=probe-ok ` +
    `container=${inputExt} sourceType=${sourceType} ` +
    `audioCodec=${audioStream?.codec_name || "none"} ` +
    `channels=${audioStream?.channels ?? 0} ` +
    `sampleRate=${audioStream?.sample_rate ?? "?"} ` +
    `hasVideo=${!!videoStream}`
  );

  if (!audioStream) {
    await unlink(inPath).catch(() => {});
    const err = new Error("No audio stream found");
    err.code = "NO_AUDIO_STREAM";
    err.userMessage = videoStream
      ? `This ${inputExt.toUpperCase()} file has a video track but no audio track. ` +
        `Please upload a recording that has audio.`
      : `No audio stream was found in this file.`;
    throw err;
  }

  // ── 4. Convert to WAV PCM 16-bit 16 kHz mono ─────────────────────────────
  let convResult;
  try {
    convResult = await spawnCapture(FFMPEG_BIN, [
      "-loglevel", "error",    // only log errors, not progress (avoids large stderr)
      "-i", inPath,
      "-vn",                   // drop all video/image tracks
      "-acodec", "pcm_s16le",  // PCM 16-bit little-endian
      "-ar", "16000",          // 16 kHz sample rate
      "-ac", "1",              // mono
      "-y",                    // overwrite output without prompting
      outPath,
    ], { timeoutMs: 90_000 });
  } catch (spawnErr) {
    await unlink(inPath).catch(() => {});
    console.error(`[preprocess] id=${id} stage=convert-spawn-fail: ${spawnErr?.message} (FFMPEG_BIN=${FFMPEG_BIN})`);
    const err = new Error("ffmpeg binary not found");
    err.code        = "CONVERT_BINARY_MISSING";
    err.userMessage = `Server media tools are not available right now, so uploaded audio/video files cannot be processed. ` +
                      `Please try again in a few minutes.`;
    throw err;
  } finally {
    await unlink(inPath).catch(() => {});
  }

  if (convResult.code !== 0) {
    await unlink(outPath).catch(() => {});
    const ffmpegStderr = convResult.stderr || "";
    console.error(
      `[preprocess] id=${id} stage=convert-fail ` +
      `exitCode=${convResult.code}\n  stderr: ${ffmpegStderr.slice(0, 600)}`
    );

    // Classify the ffmpeg failure for a precise user message
    const sl = ffmpegStderr.toLowerCase();
    let userMessage;
    if (sl.includes("decoder") && sl.includes("not found")) {
      userMessage = `The audio codec "${audioStream.codec_name}" is not supported for extraction. ` +
                    `Re-export the recording as MP4 with AAC audio, or convert to MP3.`;
    } else if (sl.includes("moov atom not found") || sl.includes("truncated")) {
      userMessage = `The uploaded MP4 appears incomplete or truncated. ` +
                    `Re-export the video file and try again.`;
    } else if (sl.includes("invalid data found")) {
      userMessage = `The uploaded file contains invalid audio data. ` +
                    `Try re-exporting or converting to MP3.`;
    } else {
      userMessage = `Audio extraction from the ${inputExt.toUpperCase()} file failed. ` +
                    `Re-export the recording or convert it to MP3 using a free tool.`;
    }

    const err = new Error(`ffmpeg exited ${convResult.code}: ${ffmpegStderr.slice(0, 120)}`);
    err.code         = "CONVERSION_FAILED";
    err.ffmpegStderr = ffmpegStderr;
    err.userMessage  = userMessage;
    throw err;
  }

  if (convResult.stderr.trim()) {
    console.warn(`[preprocess] id=${id} stage=convert-warn: ${convResult.stderr.slice(0, 300)}`);
  }

  // ── 5. Read the converted WAV ──────────────────────────────────────────────
  const wavBuffer = await readFile(outPath);
  await unlink(outPath).catch(() => {});

  console.log(
    `[preprocess] id=${id} stage=convert-ok ` +
    `originalBytes=${inputBuffer.length} wavBytes=${wavBuffer.length} ` +
    `codec=${audioStream.codec_name} sourceType=${sourceType}`
  );

  return {
    wavBuffer,
    audioStreamDetected:   true,
    sourceType,
    audioCodec:            audioStream.codec_name  || "unknown",
    audioChannels:         audioStream.channels    || 1,
    audioSampleRate:       audioStream.sample_rate || "unknown",
    normalizedFormat:      "wav-pcm-s16le-16kHz-mono",
    preprocessingSucceeded: true,
  };
}

console.log("[startup] __dirname      :", __dirname);
console.log("[startup] static root    :", path.join(__dirname, "public"));
console.log("[startup] index.html path:", path.join(__dirname, "public", "index.html"));
console.log("[startup] BUILD_STAMP           :", BUILD_STAMP);
console.log("[startup] TEXT_SCORING_MODEL    :", TEXT_SCORING_MODEL);
console.log("[startup] LINGUISTIC_VIEW_MODEL :", LINGUISTIC_VIEW_MODEL);
console.log("[startup] WORD_ANALYSIS_MODEL   :", WORD_ANALYSIS_MODEL);
console.log("[startup] AUDIO_SCORING_MODEL   :", AUDIO_SCORING_MODEL);
console.log("[startup] TRANSCRIPTION_MODEL   :", TRANSCRIPTION_MODEL);
console.log("[startup] FFMPEG_BIN          :", FFMPEG_BIN);
console.log("[startup] FFPROBE_BIN         :", FFPROBE_BIN);

// ── Security headers — WebView-safe (no X-Frame-Options / frame-ancestors) ────
// These headers harden the production server without blocking Capacitor's
// native WebView, which loads the site inside an Android/iOS native shell.
// IMPORTANT: Never add X-Frame-Options or CSP frame-ancestors here — those
// headers would break the Capacitor native wrapper.
app.use((req, res, next) => {
  // Detect native wrapper by User-Agent (set in capacitor.config.ts)
  const ua = req.headers["user-agent"] || "";
  const isNativeWrapper = ua.includes("SmartILR-Android") || ua.includes("SmartILR-iOS");

  // HSTS — enforce HTTPS in production
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  // Prevent MIME sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Referrer policy — safe for analytics, avoids leaking paths to third-parties
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions policy — declare what browser features are used
  // microphone is needed for the 🎤 Record Audio feature
  res.setHeader(
    "Permissions-Policy",
    "microphone=(self), camera=(), geolocation=(), payment=()"
  );

  // Content-Security-Policy — allow same-origin + OpenAI CDN assets only
  // NOTE: NO frame-ancestors directive — must remain absent so the Capacitor
  // WebView can embed the page. Adding frame-ancestors 'none' would break the
  // native wrapper on both Android and iOS.
  if (!isNativeWrapper) {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        // Inline scripts in index.html
        "script-src 'self' 'unsafe-inline'",
        // Inline styles + Google Fonts stylesheet
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        // images: data URIs for inline SVGs, blob: for audio player
        "img-src 'self' data: blob:",
        // blob: URLs needed for the audio player and recorded audio playback
        "media-src 'self' blob:",
        // API calls to same origin only
        "connect-src 'self'",
        // Google Fonts font files
        "font-src 'self' https://fonts.gstatic.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ")
    );
  }

  next();
});

// ── Beta Password Protection ──────────────────────────────────────────────────
const BETA_PASSWORD = "SmartILR-Beta-2026";
const BETA_TOKEN    = createHash("sha256")
  .update(BETA_PASSWORD + "-smartilr-session-2026")
  .digest("hex");
const BETA_COOKIE   = "smartilr_beta_auth";

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    const k = decodeURIComponent(part.slice(0, idx).trim());
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    out[k] = v;
  });
  return out;
}

function isBetaAuthenticated(req) {
  return parseCookies(req)[BETA_COOKIE] === BETA_TOKEN;
}

function betaLoginPage(error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SmartILR — Restricted Access</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f1f5f9;
    }
    .card {
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 4px 32px rgba(0,0,0,0.10);
      padding: 48px 44px 40px;
      width: 100%;
      max-width: 400px;
      text-align: center;
    }
    .logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #1e4d3b;
      color: #fff;
      border-radius: 14px;
      padding: 14px 28px;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin-bottom: 20px;
    }
    h1 { font-size: 18px; font-weight: 600; color: #1e293b; margin-bottom: 6px; }
    .subtitle { font-size: 13px; color: #64748b; margin-bottom: 32px; }
    label {
      display: block;
      text-align: left;
      font-size: 13px;
      font-weight: 500;
      color: #374151;
      margin-bottom: 7px;
    }
    input[type="password"] {
      width: 100%;
      padding: 11px 14px;
      font-size: 15px;
      border: 1.5px solid #d1d5db;
      border-radius: 8px;
      outline: none;
      color: #1e293b;
      transition: border-color 0.15s;
      margin-bottom: 14px;
    }
    input[type="password"]:focus { border-color: #1e4d3b; }
    button {
      width: 100%;
      padding: 12px;
      font-size: 15px;
      font-weight: 600;
      color: #fff;
      background: #1e4d3b;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #16382b; }
    .error-msg {
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 7px;
      color: #b91c1c;
      font-size: 13px;
      padding: 9px 13px;
      margin-bottom: 14px;
      text-align: left;
    }
    .confidential { margin-top: 24px; font-size: 12px; color: #94a3b8; font-style: italic; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">SmartILR</div>
    <h1>SmartILR Beta &mdash; Restricted Access</h1>
    <p class="subtitle">Enter the access password to continue.</p>
    <form method="POST" action="/auth/login">
      <label for="pw">Password</label>
      ${error ? `<div class="error-msg">${error}</div>` : ""}
      <input type="password" id="pw" name="password" placeholder="Enter password"
             autofocus autocomplete="current-password">
      <button type="submit">Enter</button>
    </form>
    <p class="confidential">Confidential prototype &mdash; not for distribution</p>
  </div>
</body>
</html>`;
}

// Login form POST — must be registered BEFORE the auth guard
app.post("/auth/login", express.urlencoded({ extended: false }), (req, res) => {
  const submitted = (req.body?.password || "").trim();
  if (submitted === BETA_PASSWORD) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${BETA_COOKIE}=${BETA_TOKEN}; HttpOnly; SameSite=Strict; Path=/${secure}`
    );
    return res.redirect(302, "/");
  }
  res.status(401).send(betaLoginPage("Incorrect password — please try again."));
});

// Auth guard — intercepts every request that lacks the session cookie
app.use((req, res, next) => {
  if (isBetaAuthenticated(req)) return next();
  // API routes get a JSON 401 so fetch() callers can handle it cleanly
  if (req.path.startsWith("/api/") || req.path.startsWith("/lv/")) {
    return res.status(401).json({ error: "Beta access required — please log in." });
  }
  res.status(401).send(betaLoginPage(null));
});
// ─────────────────────────────────────────────────────────────────────────────

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  },
}));

// ── OpenAI client ─────────────────────────────────────────────────────────────
// Prefer Replit AI Integrations proxy vars; fall back to user-supplied key.
const client = new OpenAI({
  apiKey:  process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL,
});

// ── Result cache + in-flight deduplication ────────────────────────────────────
//
// Text analysis results are deterministic (temperature=0 in prompts.js), so
// identical (passage, language, mode) triplets always produce the same output.
//
// Cache:    bounded Map of 120 entries, 1-hour TTL.  On overflow the oldest
//           entry is evicted (insertion-order Map).
// In-flight: a second Map prevents duplicate concurrent requests (e.g. double-
//           click) from each spawning a separate model call.  The second caller
//           awaits the already-running Promise and receives the same result.

const _CACHE_MAX = 120;
const _CACHE_TTL = 60 * 60 * 1000;   // 1 hour in ms

const _resultCache = new Map();       // key → { result, ts }
const _inFlight    = new Map();       // key → Promise<rawResult>

// ── Enrich job store ──────────────────────────────────────────────────────────
//
// rubricJustification is pre-computed during placement and delivered via
// /api/enrich/:jobId automatically after the main result renders.
// Each entry auto-expires after 10 min.
const _ENRICH_TTL  = 10 * 60 * 1000; // 10 minutes
const _enrichJobs  = new Map();       // jobId → { payload, ts }

// ── Lazy-compute job store ────────────────────────────────────────────────────
//
// numericScoring and itemDifficulty are stored here and only sent to the
// client when the user expands section 6 or 7 via /api/lazy-compute/:jobId.
// This avoids computing them at all until the user actually needs them.
const _COMPUTE_TTL = 10 * 60 * 1000; // 10 minutes
const _computeJobs = new Map();       // jobId → { payload, ts }

// Extract _enrichPayload from a formatResult object, store it under a new UUID,
// attach enrichJobId to the result, and remove the internal _enrichPayload key.
// Safe to call even if _enrichPayload is absent (cached results, error paths).
function _storeEnrich(result) {
  if (!result || !result._enrichPayload) return;
  const jobId = randomUUID();
  _enrichJobs.set(jobId, { payload: result._enrichPayload, ts: Date.now() });
  result.enrichJobId = jobId;
  delete result._enrichPayload;
  // Auto-evict after TTL so the Map never grows unbounded.
  setTimeout(() => _enrichJobs.delete(jobId), _ENRICH_TTL);
}

// Extract _computePayload (numericScoring + itemDifficulty) and store under a
// new UUID.  The client fetches this only when the user expands section 6 or 7.
function _storeCompute(result) {
  if (!result || !result._computePayload) return;
  const jobId = randomUUID();
  _computeJobs.set(jobId, { payload: result._computePayload, ts: Date.now() });
  result.computeJobId = jobId;
  delete result._computePayload;
  setTimeout(() => _computeJobs.delete(jobId), _COMPUTE_TTL);
}

function _cacheKey(text, language, mode) {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 24);
  return `${mode}|${language}|${hash}`;
}

function _cacheGet(key) {
  const entry = _resultCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > _CACHE_TTL) { _resultCache.delete(key); return null; }
  return entry.result;
}

function _cacheSet(key, result) {
  if (_resultCache.size >= _CACHE_MAX) _resultCache.delete(_resultCache.keys().next().value);
  _resultCache.set(key, { result, ts: Date.now() });
}

// ── _logSignalDump ─────────────────────────────────────────────────────────────
//
// Logs the raw model output BEFORE the engine pipeline processes it.
// Outputs three structured blocks:
//   [signal-dump/raw]   — rawModelLevel, discourseType, isExplanatoryText, isSimpleArgument
//   [signal-dump/upper] — the 9 key upper-band signals requested for ILR 3–5 diagnosis
//   [signal-dump/ilr3]  — which of the 10 ILR 3 gate conditions are present/absent
//
function _logSignalDump(prefix, rawResult) {
  try {
    const s = rawResult?.detectedSignals ?? {};
    const raw = rawResult?.rawModelLevel ?? "?";
    const dt  = rawResult?.discourseType  ?? "?";

    // ── 1. Raw model classification ─────────────────────────────────────────
    console.log(
      `${prefix} [signal-dump/raw]` +
      ` rawModelLevel=${raw}` +
      ` discourseType="${dt}"` +
      ` isExplanatoryText=${!!s.isExplanatoryText}` +
      ` isSimpleArgument=${!!s.isSimpleArgument}`
    );

    // ── 2. The 9 upper-band discriminator signals ────────────────────────────
    const upper = [
      "multiparagraphArgument",
      "paragraphDependency",
      "heavyInference",
      "abstractReasoning",
      "layeredReasoning",
      "implicitMeaning",
      "nuancedPerspective",
      "sustainedAbstraction",
      "crossParagraphInference",
    ];
    const upperLine = upper.map(k => `${k}=${!!s[k]}`).join(" ");
    console.log(`${prefix} [signal-dump/upper] ${upperLine}`);

    // ── 3. ILR 3 gate condition breakdown ───────────────────────────────────
    // Mirrors the updated checkIlr3Gate(): abstractReasoning OR layeredReasoning.
    const g3 = {
      abstractionOrLayeredReasoning: !!(s.abstractReasoning || s.layeredReasoning),
    };
    const failed3 = Object.entries(g3).filter(([, v]) => !v).map(([k]) => k);
    const g3Line  = Object.entries(g3).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(`${prefix} [signal-dump/ilr3] ${g3Line}`);

    if (failed3.length === 0) {
      console.log(`${prefix} [signal-dump/ilr3] ILR_3_GATE=PASS`);
    } else {
      console.log(`${prefix} [signal-dump/ilr3] ILR_3_GATE=FAIL missing: ${failed3.join(", ")}`);
    }
  } catch (e) {
    console.error(`[signal-dump] error:`, e?.message);
  }
}

// Returns { rawResult, source: "cache" | "dedup" | "model" }
async function _cachedAnalyze(passage, language, mode) {
  const key = _cacheKey(passage, language, mode);

  const hit = _cacheGet(key);
  if (hit) {
    console.log(`[cache] HIT mode=${mode} lang=${language}`);
    return { rawResult: hit, source: "cache" };
  }

  if (_inFlight.has(key)) {
    console.log(`[cache] DEDUP awaiting in-flight request mode=${mode}`);
    return { rawResult: await _inFlight.get(key), source: "dedup" };
  }

  const promise = analyzePassageWithModel(passage, language, mode, client);
  _inFlight.set(key, promise);
  try {
    const rawResult = await promise;
    _cacheSet(key, rawResult);
    return { rawResult, source: "model" };
  } finally {
    _inFlight.delete(key);
  }
}

// ── Multer — in-memory document/image upload (max 20 MB) ─────────────────────
const ALLOWED_DOC_EXTS = new Set(["png","jpg","jpeg","webp","pdf","docx"]);

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.split(".").pop() || "").toLowerCase();
    if (ALLOWED_DOC_EXTS.has(ext)) return cb(null, true);
    cb(new Error("Unsupported file type. Please upload PNG, JPG, WEBP, PDF, or DOCX."));
  },
});

// ── POST /api/extract — text extraction from image / PDF / DOCX ───────────────
app.post(["/api/extract", "/lv/extract"], docUpload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const { buffer, originalname } = req.file;
  const ext = (originalname.split(".").pop() || "").toLowerCase();
  let text = "";
  let method = "direct";
  let warning = null;

  try {
    // ── DOCX ──────────────────────────────────────────────────────────────────
    if (ext === "docx") {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value.trim();
      method = "direct";
      if (!text) {
        return res.status(422).json({ error: "Unable to extract readable text from this DOCX file." });
      }

    // ── PDF ───────────────────────────────────────────────────────────────────
    } else if (ext === "pdf") {
      try {
        const parsed = await pdfParse(buffer);
        const rawText = parsed.text.trim();

        // Heuristic: if extracted chars per page are very low (<100) treat as scanned
        const pages = Math.max(parsed.numpages || 1, 1);
        const charsPerPage = rawText.length / pages;

        if (rawText.length > 20 && charsPerPage > 80) {
          text   = rawText;
          method = "direct";
        } else {
          // Scanned PDF — fall through to Vision OCR
          throw new Error("scanned");
        }
      } catch (pdfErr) {
        // Vision OCR fallback for scanned or unreadable PDFs
        method  = "ocr-fallback";
        warning = "Scanned PDF detected. OCR applied — please review the extracted text before rating.";
        const b64  = buffer.toString("base64");
        const resp = await client.chat.completions.create({
          model: "gpt-4o",
          messages: [{
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract ALL text from this document image exactly as it appears. Preserve paragraph breaks with blank lines. Output ONLY the extracted text — no commentary, no markdown.",
              },
              {
                type: "image_url",
                image_url: { url: `data:application/pdf;base64,${b64}`, detail: "high" },
              },
            ],
          }],
          max_tokens: 4096,
        });
        text = (resp.choices[0]?.message?.content || "").trim();
        if (!text) {
          return res.status(422).json({ error: "Unable to extract readable text from this PDF." });
        }
      }

    // ── Image (PNG / JPG / WEBP) ─────────────────────────────────────────────
    } else {
      method = "ocr";
      warning = "Image text extracted. Please review before rating.";
      const mime = ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : "image/jpeg";
      const b64  = buffer.toString("base64");
      const resp = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract ALL text from this image exactly as it appears. Preserve paragraph breaks with blank lines. If Arabic script is present, extract it faithfully. Output ONLY the extracted text — no commentary, no markdown.",
            },
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${b64}`, detail: "high" },
            },
          ],
        }],
        max_tokens: 4096,
      });
      text = (resp.choices[0]?.message?.content || "").trim();
      if (!text) {
        return res.status(422).json({ error: "Unable to extract readable text from this image." });
      }
    }

    return res.json({
      text,
      method,       // "direct" | "ocr" | "ocr-fallback"
      warning,      // null or warning string
      filename: originalname,
      filetype: ext.toUpperCase(),
    });

  } catch (err) {
    console.error("[extract]", err?.message || err);
    return res.status(500).json({
      error: "Extraction failed.",
      details: err?.message || "Unknown error",
    });
  }
});

// ── Multer — in-memory audio upload (max 50 MB) ───────────────────────────────
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/ogg", "audio/flac",
  "audio/aac", "audio/webm", "video/mp4", "video/webm",
]);
const ALLOWED_AUDIO_EXTS = ["mp3","wav","m4a","mp4","ogg","flac","aac","webm","mpeg"];

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.split(".").pop() || "").toLowerCase();
    if (ALLOWED_AUDIO_TYPES.has(file.mimetype) || ALLOWED_AUDIO_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      const err = new Error(`Unsupported audio format "${ext}". Please upload MP3, WAV, M4A, OGG, FLAC, or WEBM.`);
      err.code = "UNSUPPORTED_FORMAT";
      cb(err);
    }
  },
});

// Language hint mapping for Whisper (ISO-639-1 codes)
const WHISPER_LANG_MAP = {
  arabic: "ar", farsi: "fa", persian: "fa", dari: "fa", pashto: "ps",
  english: "en", spanish: "es", french: "fr", german: "de", italian: "it",
  portuguese: "pt", russian: "ru", chinese: "zh", japanese: "ja", korean: "ko",
  turkish: "tr", urdu: "ur", hebrew: "he", dutch: "nl", polish: "pl",
  uyghur: "ug", hindi: "hi", indonesian: "id", malay: "ms", swahili: "sw",
};

function getWhisperLanguage(langName) {
  if (!langName) return undefined;
  const norm = langName.toLowerCase().trim();
  if (norm === "auto-detect" || norm === "auto" || norm === "") return undefined;
  const firstWord = norm.split(/[\s/(]/)[0];
  return WHISPER_LANG_MAP[firstWord] || undefined;
}

function buildTranscriptionError(error) {
  const msg = (error?.message || "").toLowerCase();
  const status = error?.status || 0;
  const code   = error?.code   || "";

  if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return "Transcription service key is missing. Please contact support.";
  }
  if (status === 401 || msg.includes("unauthorized") || msg.includes("api key") || msg.includes("authentication")) {
    return "Transcription service key is missing or invalid.";
  }
  if (status === 413 || msg.includes("too large") || msg.includes("file size") || code === "LIMIT_FILE_SIZE") {
    return "Audio file is too large. Please upload a file under 50 MB.";
  }
  if (code === "UNSUPPORTED_FORMAT" || status === 415 || msg.includes("unsupported") || msg.includes("invalid file format")) {
    return "Unsupported audio format. Please upload MP3, WAV, M4A, OGG, or WEBM.";
  }
  if (msg.includes("timeout") || msg.includes("timed out") || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
    return "The request timed out. Please try a shorter audio clip.";
  }
  if (msg.includes("no speech") || msg.includes("empty") || msg.includes("silent") || msg.includes("could not process")) {
    return "No speech was detected in the audio. Please check that the file contains audible speech.";
  }
  if (status === 429 || msg.includes("rate limit")) {
    return "Transcription rate limit reached. Please wait a moment and try again.";
  }
  return "Transcription failed. Please check the file and try again.";
}

// Wrap multer for audio routes so file-size/format errors return clean JSON
function audioMiddleware(req, res, next) {
  audioUpload.single("audio")(req, res, (err) => {
    if (err) {
      console.error("[audio-upload] multer error:", err.code, err.message);
      const userMsg = err.code === "LIMIT_FILE_SIZE"
        ? "Audio file is too large. Maximum size is 50 MB."
        : err.message || "File upload failed.";
      return res.status(400).json({ error: userMsg });
    }
    next();
  });
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get(["/api/health", "/lv/health"], (_req, res) => res.json({
  ok:                true,
  build:             BUILD_STAMP,
  audioScoringModel: AUDIO_SCORING_MODEL,
  textScoringModel:  TEXT_SCORING_MODEL,
  transcriptionModel: TRANSCRIPTION_MODEL,
  mediaToolsAvailable: mediaToolsStatus.available,
  ffmpegPath:          mediaToolsStatus.ffmpegPath,
  ffprobePath:         mediaToolsStatus.ffprobePath,
  ffmpegVersion:       mediaToolsStatus.ffmpegVersion,
  ffprobeVersion:      mediaToolsStatus.ffprobeVersion,
  mediaToolsError:     mediaToolsStatus.error || null,
}));

// ── GET /api/enrich/:jobId — auto-loaded panel data (rubric only) ────────────
//
// Returns { rubricJustification } for the analysis identified by jobId.
// Called automatically after the main result renders.
// One-shot; expires after _ENRICH_TTL.
app.get(["/api/enrich/:jobId", "/lv/enrich/:jobId"], (req, res) => {
  const job = _enrichJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Enrich job not found or already retrieved." });
  }
  if (Date.now() - job.ts > _ENRICH_TTL) {
    _enrichJobs.delete(req.params.jobId);
    return res.status(410).json({ error: "Enrich job expired. Please re-submit the passage." });
  }
  _enrichJobs.delete(req.params.jobId); // one-shot retrieval
  return res.json(job.payload);
});

// ── GET /api/lazy-compute/:computeJobId — on-demand scoring panels ────────────
//
// Returns { numericScoring, itemDifficulty } only when the client requests it.
// This is triggered by the user expanding section 6 (Numeric Scoring) or
// section 7 (Item Difficulty Predictor) — never computed before then.
// One-shot; expires after _COMPUTE_TTL.
app.get(["/api/lazy-compute/:computeJobId", "/lv/lazy-compute/:computeJobId"], (req, res) => {
  const job = _computeJobs.get(req.params.computeJobId);
  if (!job) {
    return res.status(404).json({ error: "Compute job not found or already retrieved." });
  }
  if (Date.now() - job.ts > _COMPUTE_TTL) {
    _computeJobs.delete(req.params.computeJobId);
    return res.status(410).json({ error: "Compute job expired. Please re-submit the passage." });
  }
  _computeJobs.delete(req.params.computeJobId); // one-shot retrieval
  return res.json(job.payload);
});

// ── POST /api/transcribe — Whisper audio-to-text ─────────────────────────────
app.post(["/api/transcribe", "/lv/transcribe"], audioMiddleware, async (req, res) => {
  try {
    console.log("[transcribe] stage=received method=POST");

    if (!req.file) {
      console.warn("[transcribe] stage=no_file");
      return res.status(400).json({ error: "No audio file was received by the server." });
    }

    const { buffer, originalname, mimetype } = req.file;
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
    const langHint = getWhisperLanguage(req.body?.language || "");

    console.log(`[transcribe] stage=file_received name="${originalname}" mime="${mimetype}" size=${sizeMB}MB lang=${langHint || "auto"}`);

    const audioFile = new File([buffer], originalname || "audio.mp3", {
      type: mimetype || "audio/mpeg",
    });

    const whisperParams = { file: audioFile, model: "gpt-4o-transcribe", response_format: "json" };
    if (langHint) whisperParams.language = langHint;

    console.log(`[transcribe] stage=provider_call model=gpt-4o-transcribe lang=${langHint || "auto"}`);

    const transcription = await client.audio.transcriptions.create(whisperParams);

    // gpt-4o-transcribe with json format returns { text }
    const transcript = typeof transcription === "string"
      ? transcription.trim()
      : (transcription.text ?? "").trim();

    console.log(`[transcribe] stage=provider_success length=${transcript.length}`);

    if (!transcript) {
      return res.status(422).json({ error: "The transcription provider returned no speech. Please check the audio file." });
    }

    // Return the requested language hint so the client knows how direction was chosen
    return res.json({ transcript, requestedLanguage: langHint || null });
  } catch (error) {
    console.error("[transcribe] stage=error", error?.status, error?.message || error);
    const userError = buildTranscriptionError(error);
    return res.status(500).json({ error: userError, details: error?.message });
  }
});

// ── POST /api/listening-rating — audio upload → listening analysis ────────────
//
// ARCHITECTURE:
//   Audio path → AUDIO_SCORING_MODEL (direct audio analysis, temperature=0)
//              + TRANSCRIPTION_MODEL (reference only) — both run CONCURRENTLY.
//              Transcript firewall: the transcription Promise never receives
//              output from scoring; scoring never receives transcript text.
//              If scoring fails → 500/504 error (no transcript fallback).
//              If transcription fails → empty transcript (score unaffected).
//   Text path  → TEXT_SCORING_MODEL via _cachedAnalyze (temperature=0).
//
//   Active models (set in config/modelConfig.js or via env vars):
//     AUDIO_SCORING_MODEL  = process.env.AUDIO_SCORING_MODEL || "gpt-audio-mini"
//     TEXT_SCORING_MODEL   = "gpt-4o"
//     TRANSCRIPTION_MODEL  = "gpt-4o-transcribe"
//
// HARD SAFEGUARD (code-level, audio path):
//   transcriptUsedForScoring = false  (always)
//   useReadingRubric         = false
//   useTranscriptComplexity  = false
//   useAudioListeningRubric  = true
//   skillType                = "listening"
//
app.post(["/api/listening-rating", "/lv/listening-rating"], audioMiddleware, async (req, res) => {
  const t0 = Date.now();
  try {
    const language = (req.body?.language || "Auto-detect").trim();

    // ── TEXT PATH: no audio file — analyse typed/pasted transcript directly ──
    if (!req.file) {
      const transcript = (req.body?.transcript || "").trim();
      if (!transcript) {
        return res.status(400).json({
          error: "No content to analyze. Please upload an audio file or paste a transcript.",
        });
      }

      // Assess transcript quality before sending to the model.
      // Quality issues reduce confidence (not the ILR level).
      const tqAssessment = assessTranscriptQuality(transcript);
      console.log(`[listening-rating] text transcript-quality flag=${tqAssessment.flag} words=${tqAssessment.wordCount}`);

      const t1 = Date.now();
      const { rawResult, source } = await _cachedAnalyze(transcript, language, "listening");
      const t2 = Date.now();
      _logSignalDump("[listening-rating/text]", rawResult);
      const finalResult = applyFinalPlacement(rawResult, "listening");
      _storeEnrich(finalResult);
      _storeCompute(finalResult);
      const t3 = Date.now();

      // Apply transcript quality confidence cap AFTER placement.
      // This never changes the ILR level — only the confidence label.
      if (tqAssessment.flag !== "adequate") {
        const capped = capConfidenceForTranscriptQuality(
          {
            confidenceLabel:   finalResult.confidenceLabel,
            likelyRange:       finalResult.likelyRange,
            likelyRangeRaw:    finalResult.likelyRangeRaw,
            signalCluster:     finalResult.signalCluster,
            confidenceReasons: finalResult.confidenceReasons,
          },
          tqAssessment.flag,
          tqAssessment.issues
        );
        finalResult.confidenceLabel   = capped.confidenceLabel;
        finalResult.confidenceReasons = capped.confidenceReasons;
      }

      console.log(`[listening-rating] text source=${source} model=${t2-t1}ms placement=${t3-t2}ms total=${t3-t0}ms`);
      return res.json({
        ...finalResult,
        mode:     "listening",
        inputType: "text",
        skillType: "listening",
        transcriptUsedForScoring: true,   // text path: transcript IS the input
        language,
        transcript,
        detectedLanguage: finalResult.detectedLanguage || language,
        transcriptQualityFlag:  tqAssessment.flag,
        transcriptQualityNote:  tqAssessment.noteNeeded ? TRANSCRIPT_QUALITY_NOTE : null,
        transcriptQualityIssues: tqAssessment.issues,
        _perf: { totalMs: t3 - t0, modelMs: source === "cache" ? 0 : t2 - t1, placementMs: t3 - t2, source },
      });
    }

    // ── AUDIO PATH ─────────────────────────────────────────────────────────────
    // Hard safeguards — enforced at the code level regardless of scoring path.
    const inputType                 = "audio";
    const skillType                 = "listening";
    const transcriptUsedForScoring  = false;
    const useReadingRubric          = false;
    const useTranscriptComplexity   = false;
    const useAudioListeningRubric   = true;
    void useReadingRubric; void useTranscriptComplexity; void useAudioListeningRubric;

    const { buffer, originalname, mimetype } = req.file;
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
    console.log(`[listening-rating] stage=audio-start name="${originalname}" size=${sizeMB}MB`);

    // ── TRANSCRIPT FIREWALL ────────────────────────────────────────────────────
    // Scoring Promise receives ONLY audio bytes — no text, no transcript, ever.
    // Six blocked paths (all false, enforced above):
    //   useTranscriptComplexity / useReadingRubric / useTranscriptOverrides
    //   useTranscriptConfidence / useTranscriptJustification / transcriptUsedForScoring

    const langHint = getWhisperLanguage(language);

    // ── Launch scoring AND transcription CONCURRENTLY ─────────────────────────
    // Both API calls start at the same moment.  The transcript Promise never
    // receives any data from the scoring Promise, and the scoring call never
    // reads the transcript result.  This eliminates the sequential wait that
    // previously added 2-5 s to every audio submission.
    const t1 = Date.now();

    // ── AbortController timeout — fail-fast for audio scoring ─────────────────
    // The OpenAI SDK default timeout is 10 minutes.  We cap audio scoring at
    // AUDIO_SCORING_TIMEOUT_MS (60 s) so a genuinely unavailable model fails
    // quickly instead of leaving the user waiting indefinitely.
    // 60 s is intentionally generous so normal audio scoring (15-30 s for a
    // typical clip) is never cut short; it only fires when the model hangs.
    const AUDIO_SCORING_TIMEOUT_MS = 60_000;
    const scoringAbort   = new AbortController();
    const scoringTimeout = setTimeout(() => scoringAbort.abort(), AUDIO_SCORING_TIMEOUT_MS);

    const ext = (originalname || "").split(".").pop().toLowerCase();

    // ── Format routing + normalization pipeline ───────────────────────────────
    // WAV and MP3 are accepted natively by the proxy — pass through as-is.
    // Everything else (MP4, M4A, OGG, FLAC, WEBM, MOV, …) is fed through
    // normalizeUploadedMediaToScoringAudio which uses ffprobe + ffmpeg to
    // extract audio, detect streams, and produce WAV 16 kHz mono.
    //
    // Defined at module scope: PROXY_WAV_EXTS, PROXY_MP3_EXTS, AUDIO_NEEDS_CONV,
    //                          VIDEO_CONTAINERS

    // All formats that need the normalization pipeline (audio or video container)
    const NORMALIZE_EXTS = new Set([
      ...AUDIO_NEEDS_CONV,
      ...VIDEO_CONTAINERS,
    ]);

    let proxyBuffer = buffer;        // may be replaced by normalized WAV
    let proxyFormat;                 // "wav" or "mp3"
    let proxyMime   = mimetype;
    let proxyName   = originalname;
    let preprocessingMeta = null;    // filled by normalizeUploadedMediaToScoringAudio

    if (PROXY_WAV_EXTS.has(ext)) {
      proxyFormat = "wav";
    } else if (PROXY_MP3_EXTS.has(ext)) {
      proxyFormat = "mp3";
    } else if (NORMALIZE_EXTS.has(ext)) {
      console.log(`[listening-rating] stage=normalize-start ext=${ext} size=${(buffer.length/1024/1024).toFixed(2)}MB`);
      try {
        preprocessingMeta = await normalizeUploadedMediaToScoringAudio(buffer, ext, originalname);
        proxyBuffer = preprocessingMeta.wavBuffer;
        proxyFormat = "wav";
        proxyMime   = "audio/wav";
        proxyName   = originalname.replace(/\.[^.]+$/, ".wav");
        console.log(
          `[listening-rating] stage=normalize-ok ext=${ext} ` +
          `sourceType=${preprocessingMeta.sourceType} ` +
          `codec=${preprocessingMeta.audioCodec} ` +
          `wavBytes=${proxyBuffer.length}`
        );
      } catch (normErr) {
        const statusCode = normErr.code === "NO_AUDIO_STREAM" ? 422
                         : normErr.code === "PROBE_FAILED"    ? 422
                         : 422;
        return res.status(statusCode).json({
          error:              normErr.userMessage || `Audio preprocessing failed for .${ext.toUpperCase()} file.`,
          scoringMethod:      `preprocessing-failed:${normErr.code || "unknown"}`,
          transcriptUsedForScoring: false,
          _backendVersion:    BUILD_STAMP,
          _audioFormat:       ext,
          audioStreamDetected: normErr.code !== "NO_AUDIO_STREAM",
          preprocessingSourceType: VIDEO_CONTAINERS.has(ext) ? "video-container" : "audio",
          preprocessingSucceeded:  false,
          mediaToolsAvailable:     mediaToolsStatus.available,
          ffmpegPath:              mediaToolsStatus.ffmpegPath,
          ffprobePath:             mediaToolsStatus.ffprobePath,
          mediaAnalyzerLaunchError: mediaToolsStatus.error || null,
        });
      }
    } else {
      // Truly unknown extension
      console.warn(`[listening-rating] stage=unsupported-format ext=${ext} mime=${mimetype}`);
      return res.status(400).json({
        error:
          `The file format ".${ext.toUpperCase()}" is not supported. ` +
          `Accepted formats: MP3, WAV, MP4, M4A, OGG, FLAC, WEBM, AAC, MOV.`,
        scoringMethod: "unsupported-format",
        transcriptUsedForScoring: false,
        _backendVersion: BUILD_STAMP,
        _audioFormat: ext,
        audioStreamDetected: false,
        preprocessingSourceType: null,
      });
    }

    // Build Whisper params after normalization so transcription gets the converted WAV
    const audioFileForTranscript = new File([proxyBuffer], proxyName || "audio.wav", { type: proxyMime || "audio/wav" });
    const whisperParams = { file: audioFileForTranscript, model: TRANSCRIPTION_MODEL, response_format: "json" };
    if (langHint) whisperParams.language = langHint;

    console.log(`[listening-rating] stage=concurrent-start scoring=${AUDIO_SCORING_MODEL} transcript=${TRANSCRIPTION_MODEL} ext=${ext} proxyFormat=${proxyFormat} mime=${proxyMime}`);
    const scoringPromise = analyzeAudioDirectlyWithModel(proxyBuffer, proxyMime, proxyName, language, client, scoringAbort.signal);

    // Transcript is teacher reference only — failure is non-critical.
    const transcriptPromise = (async () => {
      try {
        const t = await client.audio.transcriptions.create(whisperParams);
        const text = typeof t === "string" ? t.trim() : (t.text ?? "").trim();
        console.log("[listening-rating] stage=transcript-ref-ok length:", text.length);
        return text;
      } catch (e) {
        console.warn("[listening-rating] stage=transcript-ref-warn (score unaffected):", e?.message);
        return "";
      }
    })();

    // ── HARD CONTRACT: transcript NEVER used for scoring on audio failure ─────────
    //
    // If scoring fails for any reason (model unavailable, timeout, parse error,
    // network error), execution MUST terminate here with an error response.
    // The lines below this block use rawResult to call applyFinalPlacement()
    // and MUST NOT be reached via any code path that does not set rawResult
    // from the audio model.
    //
    // Forbidden paths (all result in immediate return, never analyzePassageWithModel):
    //   audioErr thrown         → return res.status(500)
    //   AbortController.abort() → return res.status(504)
    //
    // transcriptUsedForScoring, useTranscriptComplexity, useReadingRubric,
    // useTranscriptOverrides, useTranscriptConfidence, useTranscriptJustification
    // are all false and none of them appear in the success path below.
    let rawResult;
    try {
      rawResult = await scoringPromise;
      clearTimeout(scoringTimeout);   // cancel timeout on success
      console.log("[listening-rating] stage=audio-direct-ok level:", rawResult?.rawModelLevel);
    } catch (audioErr) {
      clearTimeout(scoringTimeout);
      // ── STOP. Return immediately. Do not fall back to transcript analysis. ──
      const isTimeout = audioErr?.name === "AbortError" || scoringAbort.signal.aborted;
      if (isTimeout) {
        console.error(`[listening-rating] stage=audio-direct-timeout model=${AUDIO_SCORING_MODEL} after ${AUDIO_SCORING_TIMEOUT_MS}ms`);
        return res.status(504).json({
          error:
            "Direct audio scoring is temporarily unavailable. " +
            "Transcript-based fallback is disabled to preserve listening accuracy. " +
            "Please retry, or switch to Paste Transcript mode to analyze a typed transcript.",
          details:       `Timed out after ${AUDIO_SCORING_TIMEOUT_MS / 1000}s (model: ${AUDIO_SCORING_MODEL})`,
          scoringMethod: "audio-direct-timeout",
          transcriptUsedForScoring: false,
        });
      }
      console.error(`[listening-rating] stage=audio-direct-fail`);
      console.error(`  model     : ${AUDIO_SCORING_MODEL}`);
      console.error(`  http_status: ${audioErr?.status ?? "n/a"}`);
      console.error(`  error_type : ${audioErr?.type ?? audioErr?.name ?? "n/a"}`);
      console.error(`  error_code : ${audioErr?.code ?? "n/a"}`);
      console.error(`  message    : ${audioErr?.message ?? String(audioErr)}`);
      if (audioErr?.error)  console.error(`  api_error  :`, JSON.stringify(audioErr.error));
      if (audioErr?.cause)  console.error(`  cause      :`, audioErr.cause);
      return res.status(500).json({
        error:
          "Direct audio scoring is temporarily unavailable. " +
          "Transcript-based fallback is disabled to preserve listening accuracy. " +
          "Please retry, or switch to Paste Transcript mode to analyze a typed transcript.",
        details:       audioErr?.message,
        scoringMethod: "audio-direct-failed",
        transcriptUsedForScoring: false,
      });
    }

    const t2 = Date.now();
    _logSignalDump("[listening-rating/audio]", rawResult);
    const finalResult = applyFinalPlacement(rawResult, "listening");
    _storeEnrich(finalResult);
    _storeCompute(finalResult);

    // transcriptPromise is very likely already settled by now (ran concurrently).
    const transcriptReference = await transcriptPromise;
    const t3 = Date.now();

    console.log(`[listening-rating] audio scoring=${t2-t1}ms placement+transcript=${t3-t2}ms total=${t3-t0}ms`);

    return res.json({
      ...finalResult,
      mode:                    "listening",
      inputType,
      skillType,
      transcriptUsedForScoring: false,   // always false — enforced above
      scoringMethod:           `audio-direct:${AUDIO_SCORING_MODEL}`,
      transcript:              transcriptReference,   // textarea for teacher reference only
      transcriptReference,
      language,
      detectedLanguage:        finalResult.detectedLanguage || language,
      _backendVersion:         BUILD_STAMP,
      _audioFormat:            ext,
      // ── Preprocessing debug fields ──────────────────────────────────────────
      preprocessingSourceType:   preprocessingMeta?.sourceType ?? (PROXY_WAV_EXTS.has(ext) || PROXY_MP3_EXTS.has(ext) ? "audio" : null),
      normalizedFormat:          preprocessingMeta?.normalizedFormat ?? (PROXY_WAV_EXTS.has(ext) ? "wav-native" : PROXY_MP3_EXTS.has(ext) ? "mp3-native" : null),
      audioStreamDetected:       preprocessingMeta?.audioStreamDetected ?? true,
      preprocessingSucceeded:    preprocessingMeta ? preprocessingMeta.preprocessingSucceeded : true,
      extractedCodec:            preprocessingMeta?.audioCodec ?? null,
      mediaToolsAvailable:       mediaToolsStatus.available,
      ffmpegPath:                mediaToolsStatus.ffmpegPath,
      ffprobePath:               mediaToolsStatus.ffprobePath,
      mediaAnalyzerLaunchError:  mediaToolsStatus.error || null,
      // ── Perf ────────────────────────────────────────────────────────────────
      _perf: { totalMs: t3 - t0, scoringMs: t2 - t1, placementMs: t3 - t2, source: `audio-direct:${AUDIO_SCORING_MODEL}` },
    });
  } catch (error) {
    console.error("[listening-rating] stage=error", error?.status, error?.message || error);
    const userError = buildTranscriptionError(error);
    return res.status(500).json({ error: userError, details: error?.message });
  }
});

// ── POST /api/speaking-rating — speaking audio sample analysis ─────────────────
//
// Audio-only endpoint. Accepts the same audio formats as /api/listening-rating.
// Uses analyzeSpeakingWithModel (direct audio → gpt-audio-mini) with the
// ILR speaking rubric: task detection, hard caps, evidence, why-not-higher.
// Does NOT run applyFinalPlacement — speaking analysis is self-contained.
//
app.post(["/api/speaking-rating", "/lv/speaking-rating"], audioMiddleware, async (req, res) => {
  const t0 = Date.now();
  try {
    const language = (req.body?.language || "Auto-detect").trim();

    if (!req.file) {
      return res.status(400).json({
        error: "No audio file uploaded. Speaking analysis requires an audio file.",
      });
    }

    const { buffer, originalname, mimetype } = req.file;
    const ext     = (originalname || "").split(".").pop().toLowerCase();
    const sizeMB  = (buffer.length / (1024 * 1024)).toFixed(2);
    console.log(`[speaking-rating] stage=start name="${originalname}" size=${sizeMB}MB ext=${ext}`);

    const NORMALIZE_EXTS = new Set([...AUDIO_NEEDS_CONV, ...VIDEO_CONTAINERS]);

    let proxyBuffer = buffer;
    let proxyFormat;
    let proxyMime   = mimetype;
    let proxyName   = originalname;

    if (PROXY_WAV_EXTS.has(ext)) {
      proxyFormat = "wav";
    } else if (PROXY_MP3_EXTS.has(ext)) {
      proxyFormat = "mp3";
    } else if (NORMALIZE_EXTS.has(ext)) {
      console.log(`[speaking-rating] stage=normalize-start ext=${ext}`);
      try {
        const meta  = await normalizeUploadedMediaToScoringAudio(buffer, ext, originalname);
        proxyBuffer = meta.wavBuffer;
        proxyFormat = "wav";
        proxyMime   = "audio/wav";
        proxyName   = originalname.replace(/\.[^.]+$/, ".wav");
        console.log(`[speaking-rating] stage=normalize-ok ext=${ext} wavBytes=${proxyBuffer.length}`);
      } catch (normErr) {
        return res.status(422).json({
          error: normErr.userMessage || `Audio preprocessing failed for .${ext.toUpperCase()} file.`,
          scoringMethod: `preprocessing-failed:${normErr.code || "unknown"}`,
        });
      }
    } else {
      return res.status(415).json({
        error: `The file format ".${ext.toUpperCase()}" is not supported. Accepted formats: MP3, WAV, MP4, M4A, OGG, FLAC, WEBM, AAC, MOV.`,
      });
    }

    const SPEAKING_TIMEOUT_MS = 90_000;
    const speakingAbort   = new AbortController();
    const speakingTimeout = setTimeout(() => speakingAbort.abort(), SPEAKING_TIMEOUT_MS);
    const t1 = Date.now();

    let speakingResult;
    try {
      speakingResult = await analyzeSpeakingWithModel(
        proxyBuffer, proxyMime, proxyName, language, client, speakingAbort.signal
      );
      clearTimeout(speakingTimeout);
      console.log(`[speaking-rating] stage=model-ok tasks=${speakingResult?.tasks?.length}`);
    } catch (modelErr) {
      clearTimeout(speakingTimeout);
      const isTimeout = modelErr?.name === "AbortError" || speakingAbort.signal.aborted;
      return res.status(isTimeout ? 504 : 500).json({
        error: isTimeout
          ? `Speaking analysis timed out after ${SPEAKING_TIMEOUT_MS / 1000}s. Please retry.`
          : "Speaking analysis failed. Please retry.",
        details: modelErr?.message,
      });
    }

    const t2 = Date.now();
    console.log(`[speaking-rating] model=${t2 - t1}ms total=${t2 - t0}ms`);

    return res.json({
      ...speakingResult,
      mode:     "speaking",
      skillType: "speaking",
      language,
      _backendVersion: BUILD_STAMP,
      _perf: { totalMs: t2 - t0, modelMs: t2 - t1 },
    });
  } catch (error) {
    console.error("[speaking-rating] stage=error", error?.status, error?.message || error);
    return res.status(500).json({ error: "Speaking analysis failed.", details: error?.message });
  }
});

// ── POST /api/ilr-rating — reading/auto-detect passage rating ─────────────────
app.post(["/api/ilr-rating", "/lv/ilr-rating"], async (req, res) => {
  const t0 = Date.now();
  try {
    const { passage, language = "Auto-detect", mode = "reading" } = req.body || {};

    if (!passage || !passage.trim()) {
      return res.status(400).json({ error: "Passage is required." });
    }

    // Auto-detect branch: examine text heuristics to choose reading or listening.
    // Audio uploads always go to /api/listening-rating; this path is text-only.
    let safeMode   = "reading";
    let autoDetected = false;

    if (mode === "auto") {
      safeMode     = detectModeFromText(passage.trim());
      autoDetected = true;
    } else {
      safeMode = mode === "listening" ? "listening" : "reading";
    }

    const t1 = Date.now();
    const { rawResult, source } = await _cachedAnalyze(passage.trim(), language, safeMode);
    const t2 = Date.now();

    // Inject word count so the scoring engine can apply length-based dampening.
    rawResult.passageWordCount = passage.trim().split(/\s+/).filter(Boolean).length;

    // ── Signal diagnostic dump (always logged) ───────────────────────────────
    _logSignalDump("[ilr-rating]", rawResult);

    const finalResult = applyFinalPlacement(rawResult, safeMode);
    _storeEnrich(finalResult);
    _storeCompute(finalResult);
    const t3 = Date.now();

    console.log(`[ilr-rating] source=${source} model=${t2-t1}ms placement=${t3-t2}ms total=${t3-t0}ms gate_final=${finalResult.assignedLevel} boundary=${finalResult.boundaryLevel ?? "n/a"}`);

    return res.json({
      ...finalResult,
      mode: safeMode,
      language,
      ...(autoDetected ? { autoDetected: true, requestedMode: "auto" } : {}),
      _perf: { totalMs: t3 - t0, modelMs: source === "cache" ? 0 : t2 - t1, placementMs: t3 - t2, source },
    });
  } catch (error) {
    console.error("[ilr-rating]", error?.message || error);
    return res.status(500).json({
      error: "ILR rating failed.",
      details: error?.message || "Unknown error",
    });
  }
});

// ── Multer error handler (invalid file type, file too large) ──────────────────
app.use((err, _req, res, next) => {
  if (err && (err.code === "LIMIT_FILE_SIZE" || err.message?.includes("Unsupported file type") || err.message?.includes("Invalid file type"))) {
    const msg = err.code === "LIMIT_FILE_SIZE"
      ? "File too large. Maximum size is 20 MB."
      : err.message;
    return res.status(400).json({ error: msg });
  }
  next(err);
});

// ── Linguistic View — SSE streaming ───────────────────────────────────────────
//
// The OpenAI call can take 10–25 s.  Replit autoscale runs multiple instances,
// so an in-memory job store (v108 attempt) fails because the poll request can
// hit a different instance than the one that started the job.
//
// Solution: SSE (Server-Sent Events) streaming on a single persistent connection.
//   • Server immediately flushes HTTP headers so the proxy sees activity.
//   • Every 5 s the server writes ": heartbeat\n\n" (SSE comment) to prevent
//     the proxy from closing an idle connection.
//   • When the model responds, the server writes "data: <JSON>\n\n" and ends.
//   • One connection = one instance = no distributed-state problem.
//   • X-Accel-Buffering: no  disables nginx/Replit proxy response buffering.
//
// Client uses fetch() + ReadableStream (no EventSource, which only supports GET).
// ─────────────────────────────────────────────────────────────────────────────

app.post(["/lv/lv-stream", "/api/lv-stream"], async (req, res) => {
  const { text, language = "Auto-detect" } = req.body || {};
  if (!text || !text.trim()) {
    return res.json({ available: false, unavailableReason: "No text provided." });
  }

  // Use plain application/json (not text/event-stream).
  // The response body is valid JSON with optional leading space characters.
  // Spaces are valid JSON whitespace; the client trims and parses.
  // Sending a space every 5 s keeps the proxy from closing an idle connection
  // without requiring any special SSE parsing on the client side.
  res.setHeader("Content-Type",      "application/json");
  res.setHeader("Cache-Control",     "no-cache");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");   // disable nginx/Replit buffering
  res.flushHeaders();

  console.log("[linguistic-view] stream opened");

  // Keepalive: space every 5 s — JSON-safe whitespace, keeps proxy alive
  const heartbeat = setInterval(() => {
    try { res.write(" "); } catch (_) { /* client disconnected */ }
  }, 5_000);

  const finish = (payload) => {
    clearInterval(heartbeat);
    try {
      res.write(JSON.stringify(payload));
      res.end();
    } catch (_) { /* client already gone */ }
  };

  try {
    const result = await computeLinguisticView(text.trim(), language);
    console.log("[linguistic-view] stream done, available:", result.available);
    finish(result);
  } catch (err) {
    console.error("[linguistic-view] stream error:", err.message);
    finish({ available: false, unavailableReason: "Linguistic analysis could not be completed." });
  }
});

// Legacy synchronous + old async endpoints — kept for dev tooling / fallback
async function handleLinguisticView(req, res) {
  try {
    const { text, language = "Auto-detect" } = req.body || {};
    if (!text || !text.trim()) {
      return res.json({ available: false, unavailableReason: "No text provided." });
    }
    console.log("[linguistic-view] sync request received");
    const result = await computeLinguisticView(text.trim(), language);
    return res.json(result);
  } catch (err) {
    console.error("[linguistic-view]", err.message);
    return res.status(500).json({ available: false, unavailableReason: "Analysis failed." });
  }
}
app.post("/lv/linguistic-view",  handleLinguisticView);
app.post("/api/linguistic-view", handleLinguisticView);

// ── Word-analysis cache + in-flight dedup ─────────────────────────────────────
//
// Same bounded-Map pattern as _resultCache / _inFlight for ILR rating.
// Key: sha256(text)|language  (mode fixed to "wordanalysis")
// TTL: 1 hour.  Cap: 80 entries (passages are larger objects than ILR results).
const _waCache   = new Map();   // key → { result, ts }
const _waFlight  = new Map();   // key → Promise<result>
const _WA_TTL    = 60 * 60 * 1000;
const _WA_MAX    = 80;

function _waCacheKey(text, language) {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 24);
  return `wordanalysis|${language}|${hash}`;
}
function _waCacheGet(key) {
  const e = _waCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > _WA_TTL) { _waCache.delete(key); return null; }
  return e.result;
}
function _waCacheSet(key, result) {
  if (_waCache.size >= _WA_MAX) _waCache.delete(_waCache.keys().next().value);
  _waCache.set(key, { result, ts: Date.now() });
}

// ── POST /lv/word-analysis  (also aliased at /api/word-analysis)
// Per-word morphological analysis. Called when Grammar Analysis chip activates.
// Does NOT affect the ILR level assignment.
// Using /lv/ prefix avoids production proxy routing to the API Server artifact.
async function handleWordAnalysis(req, res) {
  const t0 = Date.now();
  try {
    const { text, language = "Arabic" } = req.body || {};
    if (!text || !text.trim()) {
      return res.json({ available: false, unavailableReason: "No text provided." });
    }
    const key = _waCacheKey(text.trim(), language);

    // Cache hit
    const cached = _waCacheGet(key);
    if (cached) {
      console.log(`[word-analysis] source=cache total=${Date.now() - t0}ms`);
      return res.json(cached);
    }

    // In-flight deduplication — if an identical request is already running,
    // await the same promise instead of spawning a second model call.
    if (_waFlight.has(key)) {
      const result = await _waFlight.get(key);
      console.log(`[word-analysis] source=inflight total=${Date.now() - t0}ms`);
      return res.json(result);
    }

    // Fresh model call
    const promise = computeWordAnalysis(text.trim(), language);
    _waFlight.set(key, promise);
    try {
      const result = await promise;
      _waCacheSet(key, result);
      console.log(`[word-analysis] source=model total=${Date.now() - t0}ms words=${result.words?.length ?? 0}`);
      return res.json(result);
    } finally {
      _waFlight.delete(key);
    }
  } catch (err) {
    console.error("[word-analysis]", err.message);
    return res.status(500).json({ available: false, unavailableReason: "Analysis failed." });
  }
}
app.post("/lv/word-analysis",  handleWordAnalysis);
app.post("/api/word-analysis", handleWordAnalysis);

// ── POST /lv/translate-passage — English support translation + entity list ────
//
// Returns full-passage English translation and a list of detected named entities
// (persons, places, organizations) for use in translation-assisted entity alignment.
//
// NON-NEGOTIABLE: ILR rating logic is NOT touched by this endpoint.
// It is a support-only display layer consumed exclusively by the Linguistic View.
//
// Cache strategy: same bounded-Map + in-flight dedup as word-analysis.
//   Key: sha256(text.slice(0,4000))   TTL: 1 hour   Cap: 80

const _transCache  = new Map();
const _transFlight = new Map();
const _TRANS_TTL   = 60 * 60 * 1000;
const _TRANS_MAX   = 80;

function _transCacheKey(text) {
  return createHash("sha256").update(text.slice(0, 4_000)).digest("hex").slice(0, 24);
}
function _transCacheGet(key) {
  const hit = _transCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > _TRANS_TTL) { _transCache.delete(key); return null; }
  return hit.result;
}
function _transCacheSet(key, result) {
  if (_transCache.size >= _TRANS_MAX) _transCache.delete(_transCache.keys().next().value);
  _transCache.set(key, { result, ts: Date.now() });
}

async function computePassageTranslation(text) {
  const systemPrompt = `You are an expert translator of Modern Standard Arabic (MSA) texts into natural English, specialising in news, political, and diplomatic content.

Your task has three parts:
1. Translate the full Arabic passage into fluent, natural English.
2. Identify all named entities present in the Arabic text.
3. Provide English glosses for every significant content word in the Arabic passage.

Return ONLY valid JSON — no markdown fences, no extra commentary:
{
  "translation": "<full English translation of the passage>",
  "entities": [
    { "arabic": "<normalised Arabic token — no diacritics>", "type": "PERSON|PLACE|ORG|TITLE" }
  ],
  "wordGlosses": {
    "<normalised Arabic token>": "<concise English gloss, 1-4 words>"
  }
}

Rules for "translation":
- Translate the entire passage as a coherent whole. Natural English.

Rules for "entities":
- List EVERY significant named-entity token separately. Use normalised Arabic (no diacritics, أإآ→ا).
- Keep ال- prefix for place names (القاهرة) but strip it from common nouns.
- Types: PERSON (human names), PLACE (cities/countries/regions), ORG (organisations/agencies/companies), TITLE (title words like رئيس, وزير, ملك when part of a name chain).
- Confidence gate: only include entities you are highly confident about. Do NOT include common adjectives or nouns unless unambiguously a name.
- Split multi-word names into individual tokens.

Rules for "wordGlosses":
- Include EVERY meaningful content word: nouns, verbs, adjectives, adverbs, verbal nouns (masdar), participles.
- SKIP: particles (قد, لن, إن, هل, سوف), conjunctions (و, أو, ثم, بل), prepositions (في, على, من, إلى, عن, مع, عند, بعد, قبل, خلال, حول, ضد), pronouns (هو, هي, هم, نحن, أنت), and numerals.
- Use the normalised Arabic surface form as the key (strip all diacritics, أإآ→ا). Include BOTH the surface form as it appears in the text AND the base/lemma form when they differ.
  Example: the token "الانتخابات" → key "الانتخابات":"elections" AND "انتخاب":"election"
  Example: the token "المقررة" → key "المقررة":"scheduled" AND "مقرر":"scheduled"
  Example: the token "انخراطا" → key "انخراطا":"involvement" AND "انخراط":"involvement"
- English gloss: brief (1-4 words), capturing the meaning in THIS passage context.
- For verbal nouns (masdar): add the Arabic form label, e.g. "involvement (masdar)" or just "involvement".
- Do NOT duplicate a word if already covered: prefer the base/lemma form if the surface is predictably derived.`;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: text },
    ],
    temperature: 0.1,
    max_tokens:  4_000,
    response_format: { type: "json_object" },
  });

  const raw    = completion.choices[0].message.content.trim();
  const parsed = JSON.parse(raw);

  // Sanitise wordGlosses — must be a flat object of string→string pairs.
  const rawGlosses = parsed.wordGlosses || {};
  const wordGlosses = Object.create(null);
  for (const [k, v] of Object.entries(rawGlosses)) {
    if (typeof k === "string" && k.trim() && typeof v === "string" && v.trim()) {
      wordGlosses[k.trim()] = v.trim();
    }
  }

  return {
    available:    true,
    translation:  parsed.translation  || "",
    entities:     Array.isArray(parsed.entities) ? parsed.entities : [],
    wordGlosses,
    disclaimer:   "For teacher support only. ILR rating is based on the original target-language text.",
    entityNote:   "Translation-assisted entity support may be used for ambiguous names and named entities. ILR scoring remains based on the original target-language text only.",
  };
}

async function handleTranslatePassage(req, res) {
  const t0 = Date.now();
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.json({ available: false, unavailableReason: "No text provided." });
    }
    const key = _transCacheKey(text.trim());

    const cached = _transCacheGet(key);
    if (cached) {
      console.log(`[translate-passage] source=cache total=${Date.now() - t0}ms`);
      return res.json(cached);
    }

    if (_transFlight.has(key)) {
      const result = await _transFlight.get(key);
      console.log(`[translate-passage] source=inflight total=${Date.now() - t0}ms`);
      return res.json(result);
    }

    const promise = computePassageTranslation(text.trim());
    _transFlight.set(key, promise);
    try {
      const result = await promise;
      _transCacheSet(key, result);
      console.log(`[translate-passage] source=model total=${Date.now() - t0}ms entities=${result.entities?.length ?? 0}`);
      return res.json(result);
    } finally {
      _transFlight.delete(key);
    }
  } catch (err) {
    console.error("[translate-passage]", err.message);
    return res.status(500).json({ available: false, unavailableReason: "Translation could not be completed." });
  }
}
app.post("/lv/translate-passage",  handleTranslatePassage);
app.post("/api/translate-passage", handleTranslatePassage);

// ── POST /api/feedback — Teacher Feedback submission ──────────────────────────
//
// Accepts a JSON payload from the Teacher Feedback modal and persists it to
// feedback.jsonl (one JSON object per line) in the server directory.
//
// ┌─ TO INTEGRATE A DATABASE ───────────────────────────────────────────────┐
// │  Replace the fs.appendFileSync call below with your INSERT / upsert.    │
// │  The full validated payload object is available as `entry`.             │
// └─────────────────────────────────────────────────────────────────────────┘
app.post(["/api/feedback", "/lv/feedback"], (req, res) => {
  const {
    teacher_name, teacher_email, predicted_level, suggested_level,
    comments, language, skill_type, original_passage, system_analysis,
    rubric_scores, final_level, timestamp,
  } = req.body || {};

  // Basic server-side validation
  if (!teacher_name || !teacher_email || !suggested_level || !comments) {
    return res.status(400).json({ error: "Required fields are missing." });
  }

  const entry = {
    teacher_name:     String(teacher_name).slice(0, 200),
    teacher_email:    String(teacher_email).slice(0, 200),
    predicted_level:  String(predicted_level  || "").slice(0, 20),
    suggested_level:  String(suggested_level).slice(0, 20),
    comments:         String(comments).slice(0, 4000),
    language:         String(language         || "").slice(0, 100),
    skill_type:       String(skill_type       || "").slice(0, 50),
    original_passage: String(original_passage || "").slice(0, 10000),
    system_analysis:  String(system_analysis  || "").slice(0, 5000),
    rubric_scores:    Array.isArray(rubric_scores) ? rubric_scores : [],
    final_level:      String(final_level      || "").slice(0, 20),
    timestamp:        timestamp || new Date().toISOString(),
    received_at:      new Date().toISOString(),
  };

  try {
    const feedbackPath = path.join(__dirname, "feedback.jsonl");
    fs.appendFileSync(feedbackPath, JSON.stringify(entry) + "\n", "utf8");
    console.log(`[feedback] saved from ${entry.teacher_email} predicted=${entry.predicted_level} suggested=${entry.suggested_level}`);
    return res.json({ success: true });
  } catch (err) {
    console.error("[feedback] write error:", err.message);
    return res.status(500).json({ error: "Failed to save feedback. Please try again." });
  }
});

// ── GET /calibration — internal calibration panel ─────────────────────────────
app.get("/calibration", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "calibration.html"));
});

// ── Catch-all — serve index.html for any unknown path ────────────────────────
app.get("*", (req, res) => {
  const indexPath = path.join(__dirname, "public", "index.html");
  console.log("[catch-all] GET", req.path, "→ sending:", indexPath);
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error("[catch-all] sendFile error:", err.message, "| path:", indexPath);
      res.status(500).json({
        error: "sendFile failed",
        resolvedPath: indexPath,
        message: err.message,
      });
    }
  });
});

app.listen(port, async () => {
  console.log(`[startup] __dirname      : ${__dirname}`);
  console.log(`[startup] static root    : ${path.join(__dirname, "public")}`);
  console.log(`[startup] index.html path: ${path.join(__dirname, "public", "index.html")}`);
  console.log(`[startup] BUILD_STAMP         : ${BUILD_STAMP}`);
  console.log(`[startup] TEXT_SCORING_MODEL  : ${TEXT_SCORING_MODEL}`);
  console.log(`[startup] WORD_ANALYSIS_MODEL : ${WORD_ANALYSIS_MODEL}`);
  console.log(`[startup] AUDIO_SCORING_MODEL : ${AUDIO_SCORING_MODEL}`);
  console.log(`[startup] TRANSCRIPTION_MODEL : ${TRANSCRIPTION_MODEL}`);
  console.log(`[startup] FFMPEG_BIN          : ${FFMPEG_BIN}`);
  console.log(`[startup] FFPROBE_BIN         : ${FFPROBE_BIN}`);
  console.log(`SmartILR running on http://localhost:${port}`);
  // Run startup health check — confirms binaries actually launch before any request
  await ensureMediaToolsAvailable();
});
