// Input injection: turns relayed pointer/keyboard events into real OS input.
//
// Event shapes sent by the viewer (coordinates are normalized 0..1):
//   { t:'move',   x, y }
//   { t:'down'|'up', button:'left'|'middle'|'right', x, y }
//   { t:'scroll', dir:'up'|'down', x, y }
//   { t:'type',   text }                         // printable characters
//   { t:'key',    key, mods:{ctrl,alt,shift,meta} }  // named key / shortcut
//
// Linux (X11) uses xdotool, macOS uses cliclick (+ osascript fallback),
// Windows uses a persistent PowerShell with user32 SendInput.

import { spawn, spawnSync } from 'node:child_process';

function has(cmd, probeArgs = ['--version']) {
  try { return spawnSync(cmd, probeArgs, { stdio: 'ignore' }).status === 0; }
  catch { return false; }
}
function run(cmd, args, env) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, ...env } });
    p.on('error', () => resolve(false));
    p.on('close', () => resolve(true));
  });
}
const BTN = { left: 1, middle: 2, right: 3 };

// Collapse runs of consecutive 'move' events to the last one in each run.
function collapseMoves(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.t === 'move' && events[i + 1] && events[i + 1].t === 'move') continue;
    out.push(e);
  }
  return out;
}

// --- Linux / X11 -------------------------------------------------------------
function linuxInjector({ display, size }) {
  const ok = has('xdotool');
  const env = { DISPLAY: display || process.env.DISPLAY || ':0' };
  const px = (e) => [Math.round((e.x ?? 0) * (size.w - 1)), Math.round((e.y ?? 0) * (size.h - 1))];
  // browser KeyboardEvent.key -> X11 keysym
  const KEY = {
    Enter: 'Return', Backspace: 'BackSpace', Tab: 'Tab', Escape: 'Escape', ' ': 'space',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Prior', PageDown: 'Next',
    Control: 'ctrl', Alt: 'alt', Shift: 'shift', Meta: 'super', CapsLock: 'Caps_Lock',
  };
  const keysym = (k) => KEY[k] || (/^F\d{1,2}$/.test(k) ? k : k.length === 1 ? k : null);
  const combo = (ev) => {
    const mods = ev.mods || {};
    const parts = [];
    if (mods.ctrl) parts.push('ctrl');
    if (mods.alt) parts.push('alt');
    if (mods.shift) parts.push('shift');
    if (mods.meta) parts.push('super');
    const ks = keysym(ev.key);
    if (!ks) return null;
    parts.push(ks);
    return parts.join('+');
  };
  return {
    caps: { mouse: ok, keyboard: ok, tool: ok ? 'xdotool' : null },
    async apply(events) {
      if (!ok) return;
      for (const e of collapseMoves(events)) {
        if (e.t === 'move') { const [x, y] = px(e); await run('xdotool', ['mousemove', String(x), String(y)], env); }
        else if (e.t === 'down') { const [x, y] = px(e); await run('xdotool', ['mousemove', String(x), String(y), 'mousedown', String(BTN[e.button] || 1)], env); }
        else if (e.t === 'up') { await run('xdotool', ['mouseup', String(BTN[e.button] || 1)], env); }
        else if (e.t === 'scroll') { await run('xdotool', ['click', e.dir === 'up' ? '4' : '5'], env); }
        else if (e.t === 'type' && e.text) { await run('xdotool', ['type', '--clearmodifiers', '--', e.text], env); }
        else if (e.t === 'key') { const c = combo(e); if (c) await run('xdotool', ['key', '--clearmodifiers', c], env); }
      }
    },
  };
}

// --- macOS -------------------------------------------------------------------
function macInjector({ size }) {
  const cli = has('cliclick', ['-V']);
  const px = (e) => [Math.round((e.x ?? 0) * (size.w - 1)), Math.round((e.y ?? 0) * (size.h - 1))];
  const KEY = { Enter: 'return', Backspace: 'delete', Tab: 'tab', Escape: 'esc', ' ': 'space', ArrowUp: 'arrow-up', ArrowDown: 'arrow-down', ArrowLeft: 'arrow-left', ArrowRight: 'arrow-right', Delete: 'fwd-delete', Home: 'home', End: 'end', PageUp: 'page-up', PageDown: 'page-down' };
  return {
    caps: { mouse: cli, keyboard: true, tool: cli ? 'cliclick' : 'osascript' },
    async apply(events) {
      for (const e of collapseMoves(events)) {
        if (!cli && (e.t === 'move' || e.t === 'down' || e.t === 'up' || e.t === 'scroll')) continue;
        if (e.t === 'move') { const [x, y] = px(e); await run('cliclick', [`m:${x},${y}`]); }
        else if (e.t === 'down') { const [x, y] = px(e); await run('cliclick', [`dd:${x},${y}`]); }
        else if (e.t === 'up') { const [x, y] = px(e); await run('cliclick', [`du:${x},${y}`]); }
        else if (e.t === 'scroll') { const [x, y] = px(e); await run('cliclick', [`m:${x},${y}`, e.dir === 'up' ? 'w:+3' : 'w:-3']); }
        else if (e.t === 'type' && e.text) {
          if (cli) await run('cliclick', [`t:${e.text}`]);
          else await run('osascript', ['-e', `tell application "System Events" to keystroke ${JSON.stringify(e.text)}`]);
        } else if (e.t === 'key') {
          const k = KEY[e.key];
          if (cli && k) await run('cliclick', [`kp:${k}`]);
          else {
            const mods = e.mods || {}; const using = [];
            if (mods.ctrl) using.push('control down'); if (mods.alt) using.push('option down'); if (mods.shift) using.push('shift down'); if (mods.meta) using.push('command down');
            const u = using.length ? ` using {${using.join(', ')}}` : '';
            if (e.key && e.key.length === 1) await run('osascript', ['-e', `tell application "System Events" to keystroke ${JSON.stringify(e.key)}${u}`]);
          }
        }
      }
    },
  };
}

// --- Windows -----------------------------------------------------------------
function winInjector({ size }) {
  // Persistent PowerShell that loads a user32 SendInput helper once.
  const bootstrap = `
$ErrorActionPreference='SilentlyContinue'
Add-Type @"
using System;using System.Runtime.InteropServices;
public class RC{
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);
 [DllImport("user32.dll")] public static extern void keybd_event(byte v,byte s,uint f,int e);
 public static void Down(int b){uint f=b==2?0x0008u:b==3?0x0020u:0x0002u;mouse_event(f,0,0,0,0);}
 public static void Up(int b){uint f=b==2?0x0010u:b==3?0x0040u:0x0004u;mouse_event(f,0,0,0,0);}
 public static void Wheel(int d){mouse_event(0x0800,0,0,(uint)d,0);}
}
"@
Add-Type -AssemblyName System.Windows.Forms
function Esc($s){ $s -replace '([+^%~(){}\[\]])','{$1}' }
`;
  let proc = null;
  const ensure = () => {
    if (proc && !proc.killed) return proc;
    proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], { stdio: ['pipe', 'ignore', 'ignore'] });
    proc.on('error', () => { proc = null; });
    proc.stdin.write(bootstrap + '\n');
    return proc;
  };
  const px = (e) => [Math.round((e.x ?? 0) * (size.w - 1)), Math.round((e.y ?? 0) * (size.h - 1))];
  const feed = (line) => { const p = ensure(); try { p.stdin.write(line + '\n'); } catch {} };
  return {
    caps: { mouse: true, keyboard: true, tool: 'powershell' },
    async apply(events) {
      for (const e of collapseMoves(events)) {
        if (e.t === 'move') { const [x, y] = px(e); feed(`[RC]::SetCursorPos(${x},${y})`); }
        else if (e.t === 'down') { const [x, y] = px(e); feed(`[RC]::SetCursorPos(${x},${y});[RC]::Down(${BTN[e.button] || 1})`); }
        else if (e.t === 'up') { feed(`[RC]::Up(${BTN[e.button] || 1})`); }
        else if (e.t === 'scroll') { feed(`[RC]::Wheel(${e.dir === 'up' ? 120 : -120})`); }
        else if (e.t === 'type' && e.text) { feed(`[System.Windows.Forms.SendKeys]::SendWait((Esc ${JSON.stringify(e.text)}))`); }
        else if (e.t === 'key') {
          const SK = { Enter: '{ENTER}', Backspace: '{BACKSPACE}', Tab: '{TAB}', Escape: '{ESC}', Delete: '{DEL}', ArrowUp: '{UP}', ArrowDown: '{DOWN}', ArrowLeft: '{LEFT}', ArrowRight: '{RIGHT}', Home: '{HOME}', End: '{END}', PageUp: '{PGUP}', PageDown: '{PGDN}', ' ': ' ' };
          let base = SK[e.key] || (e.key && e.key.length === 1 ? e.key : null);
          if (!base) continue;
          const m = e.mods || {}; let pre = '';
          if (m.ctrl) pre += '^'; if (m.alt) pre += '%'; if (m.shift) pre += '+';
          feed(`[System.Windows.Forms.SendKeys]::SendWait(${JSON.stringify(pre + base)})`);
        }
      }
    },
  };
}

export function createInjector(opt) {
  if (opt.noInput) return { caps: { mouse: false, keyboard: false, tool: 'disabled' }, async apply() {} };
  switch (process.platform) {
    case 'linux': return linuxInjector(opt);
    case 'darwin': return macInjector(opt);
    case 'win32': return winInjector(opt);
    default: return { caps: { mouse: false, keyboard: false, tool: null }, async apply() {} };
  }
}
