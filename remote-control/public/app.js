'use strict';

const $ = (id) => document.getElementById(id);
const screens = { login: $('login'), devices: $('devices'), control: $('control') };
function show(name) { for (const k in screens) screens[k].hidden = (k !== name); }

let token = sessionStorage.getItem('rc_token') || '';
let current = null;           // device being controlled
let pollTimer = null;

// ---------------------------------------------------------------- auth / list
async function api(path, opts = {}) {
  const u = new URL(path, location.origin);
  u.searchParams.set('token', token);
  const res = await fetch(u, opts);
  if (res.status === 401) throw new Error('unauthorized');
  return res;
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  token = $('token').value.trim();
  $('loginErr').hidden = true;
  try {
    const res = await api('/api/devices');
    if (!res.ok) throw new Error();
    sessionStorage.setItem('rc_token', token);
    enterDevices();
  } catch {
    $('loginErr').textContent = 'Token non valido o relay irraggiungibile.';
    $('loginErr').hidden = false;
  }
});

$('logout').addEventListener('click', () => {
  sessionStorage.removeItem('rc_token'); token = '';
  clearInterval(pollTimer); show('login');
});

function enterDevices() {
  show('devices');
  refresh();
  clearInterval(pollTimer);
  pollTimer = setInterval(refresh, 2000);
}

async function refresh() {
  let data;
  try { data = await (await api('/api/devices')).json(); }
  catch { $('dot').classList.remove('on'); return; }
  $('dot').classList.add('on');
  const list = data.devices || [];
  $('empty').hidden = list.length > 0;
  const ul = $('deviceList');
  ul.innerHTML = '';
  for (const d of list) {
    const li = document.createElement('li');
    li.className = 'device';
    const input = d.caps && (d.caps.mouse || d.caps.keyboard);
    li.innerHTML = `
      <span class="name"></span>
      <span class="meta"></span>
      <div class="tags">
        <span class="tag ${d.streaming ? 'live' : ''}">${d.streaming ? '● in diretta' : 'in attesa'}</span>
        <span class="tag">${input ? 'input attivo' : 'sola visione'}</span>
        ${d.viewers ? `<span class="tag">${d.viewers} spettatori</span>` : ''}
      </div>`;
    li.querySelector('.name').textContent = d.name;
    li.querySelector('.meta').textContent = `${d.os} · ${d.width || '?'}×${d.height || '?'}`;
    li.addEventListener('click', () => startControl(d));
    ul.appendChild(li);
  }
}

// ---------------------------------------------------------------- control view
const stage = $('stage');
const img = $('screen');
let queue = [];
let flushTimer = null;

function startControl(dev) {
  current = dev;
  clearInterval(pollTimer);
  show('control');
  $('ctrlName').textContent = dev.name;
  $('ctrlInfo').textContent = ` ${dev.os} · ${dev.width}×${dev.height}`;
  $('viewOnly').checked = !(dev.caps && (dev.caps.mouse || dev.caps.keyboard));
  const u = new URL(`/stream/${encodeURIComponent(dev.id)}`, location.origin);
  u.searchParams.set('token', token);
  u.searchParams.set('_', Date.now());
  img.src = u.toString();
  stage.focus();
  $('hint').classList.remove('hide');
  setTimeout(() => $('hint').classList.add('hide'), 4000);
  flushTimer = setInterval(flush, 33);
}

function stopControl() {
  img.src = '';
  current = null;
  queue = [];
  clearInterval(flushTimer);
  enterDevices();
}

$('back').addEventListener('click', stopControl);
$('fs').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen?.();
});

const inputEnabled = () => current && !$('viewOnly').checked && current.caps && (current.caps.mouse || current.caps.keyboard);

// map a pointer event to normalized [0..1] coords inside the letterboxed image
function norm(ev) {
  const r = img.getBoundingClientRect();
  const natW = current.width || img.naturalWidth || r.width;
  const natH = current.height || img.naturalHeight || r.height;
  const scale = Math.min(r.width / natW, r.height / natH);
  const w = natW * scale, h = natH * scale;
  const ox = r.left + (r.width - w) / 2, oy = r.top + (r.height - h) / 2;
  const x = (ev.clientX - ox) / w, y = (ev.clientY - oy) / h;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

function push(evt, immediate) {
  queue.push(evt);
  if (immediate) flush();
}
async function flush() {
  if (!current || !queue.length) return;
  const events = queue; queue = [];
  try {
    await api(`/input/${encodeURIComponent(current.id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
  } catch {}
}

const BTN = { 0: 'left', 1: 'middle', 2: 'right' };

stage.addEventListener('pointermove', (e) => {
  if (!inputEnabled()) return;
  const n = norm(e); push({ t: 'move', x: n.x, y: n.y }, false);
});
stage.addEventListener('pointerdown', (e) => {
  stage.focus();
  if (!inputEnabled()) return;
  e.preventDefault();
  stage.setPointerCapture?.(e.pointerId);
  const n = norm(e); push({ t: 'down', button: BTN[e.button] || 'left', x: n.x, y: n.y }, true);
});
stage.addEventListener('pointerup', (e) => {
  if (!inputEnabled()) return;
  e.preventDefault();
  const n = norm(e); push({ t: 'up', button: BTN[e.button] || 'left', x: n.x, y: n.y }, true);
});
stage.addEventListener('contextmenu', (e) => { if (inputEnabled()) e.preventDefault(); });
stage.addEventListener('wheel', (e) => {
  if (!inputEnabled()) return;
  e.preventDefault();
  const n = norm(e); push({ t: 'scroll', dir: e.deltaY < 0 ? 'up' : 'down', x: n.x, y: n.y }, true);
}, { passive: false });

// keyboard — only while the control view is visible and focused
window.addEventListener('keydown', (e) => {
  if (!current || screens.control.hidden || !inputEnabled()) return;
  // let the user leave fullscreen / refresh with the browser's own keys
  if (e.key === 'F5' || e.key === 'F11' || (e.key === 'F12')) return;
  e.preventDefault();
  const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (printable) push({ t: 'type', text: e.key }, true);
  else push({ t: 'key', key: e.key, mods: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey } }, true);
}, true);

// ---------------------------------------------------------------- boot
if (token) {
  api('/api/devices').then(r => { if (r.ok) enterDevices(); else show('login'); }).catch(() => show('login'));
} else {
  show('login');
}
