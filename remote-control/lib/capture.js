// Screen capture via ffmpeg, as a continuous MJPEG stream.
//
// ffmpeg is a system tool (not an npm package), so the agent stays
// dependency-free. One ffmpeg process per platform grabs the screen and emits
// MJPEG on stdout; the agent pipes that straight into the relay.

import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';

export function hasFfmpeg() {
  try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; }
  catch { return false; }
}

/**
 * Build the ffmpeg input arguments for the current platform.
 * @param {object} opt
 * @param {number} opt.fps
 * @param {string} opt.display   X11 display, e.g. ":0"
 * @param {string} opt.avInput   macOS avfoundation input spec, e.g. "1:none"
 * @param {boolean} opt.demo     use a synthetic test pattern (no real screen)
 */
function inputArgs({ fps, display, avInput, demo }) {
  // -re throttles the synthetic source to real time (otherwise ffmpeg floods).
  if (demo) return ['-re', '-f', 'lavfi', '-i', `testsrc=size=1280x720:rate=${fps}`];
  switch (process.platform) {
    case 'linux':
      return ['-f', 'x11grab', '-framerate', String(fps), '-i', display || process.env.DISPLAY || ':0.0'];
    case 'darwin':
      return ['-f', 'avfoundation', '-capture_cursor', '1', '-framerate', String(fps), '-i', avInput || '1:none'];
    case 'win32':
      return ['-f', 'gdigrab', '-framerate', String(fps), '-i', 'desktop'];
    default:
      throw new Error(`piattaforma non supportata per la cattura: ${process.platform}`);
  }
}

/**
 * Start the capture stream.
 * @returns {{ proc: import('node:child_process').ChildProcess, stdout: NodeJS.ReadableStream }}
 */
export function startCapture(opt) {
  const fps = Math.max(1, Math.min(30, opt.fps || 8));
  const quality = Math.max(2, Math.min(31, opt.quality || 7)); // ffmpeg -q:v (lower = better)
  const args = ['-nostdin', '-loglevel', 'error', ...inputArgs({ ...opt, fps })];
  if (opt.scale) args.push('-vf', `scale=${opt.scale}:flags=fast_bilinear`);
  args.push('-f', 'mjpeg', '-q:v', String(quality), '-');
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', d => { const s = d.toString().trim(); if (s) console.error('[ffmpeg]', s); });
  return { proc, stdout: proc.stdout };
}

/**
 * Grab a single frame to learn the real (unscaled) screen resolution, so that
 * normalized pointer coordinates map correctly even when the stream is scaled.
 * @returns {{w:number,h:number}|null}
 */
export function probeSize(opt) {
  if (opt.demo) return { w: 1280, h: 720 };
  const args = ['-nostdin', '-loglevel', 'error', ...inputArgs({ ...opt, fps: 1, demo: false }), '-frames:v', '1', '-f', 'mjpeg', '-'];
  const r = spawnSync('ffmpeg', args, { maxBuffer: 64 * 1024 * 1024, timeout: 8000 });
  if (r.status !== 0 || !r.stdout || !r.stdout.length) return null;
  // Minimal JPEG SOF parse.
  const buf = r.stdout; let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

export function osLabel() {
  const map = { linux: 'Linux', darwin: 'macOS', win32: 'Windows' };
  return `${map[process.platform] || process.platform} (${os.hostname()})`;
}
