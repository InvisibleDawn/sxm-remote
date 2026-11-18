// SXM Remote — © 2026 Invisible_Dawn — GPL-3.0-or-later
const T = window.__TAURI__;
const invoke = T.core.invoke;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PALETTE = ['#16A08A', '#5AA33F', '#2F6CC7', '#D02A64', '#4A5468', '#1A6BE6', '#8A4BD6', '#E3862A'];
const ICON_PC = '<svg class="pc" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/></svg>';
const ICON_WM = '<svg class="wm" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
const ICON_MORE = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

const state = { conns: [], settings: {}, peers: [], engine: null, os: 'linux', version: '', update: null, q: '', busy: new Set() };

/* ---------- utilitaires ---------- */
function toast(msg, ms = 4500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms);
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
function colorOf(id) {
  let h = 2166136261; for (const c of String(id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return PALETTE[h % PALETTE.length];
}
function isTailscale(host) {
  const m = /^(\d+)\.(\d+)\./.exec(host || '');
  return (m && +m[1] === 100 && +m[2] >= 64 && +m[2] <= 127) || /\.ts\.net$/i.test(host || '');
}
const vt = (v) => String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
function newer(a, b) {
  const x = vt(a), y = vt(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
async function saveConns() {
  try { await invoke('save_connections', { conns: state.conns }); }
  catch (e) { toast('Impossible d’enregistrer : ' + e); }
}

/* ---------- navigation ---------- */
function show(view) {
  ['home', 'about'].forEach((v) => ($('#view-' + v).hidden = v !== view));
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
}
document.querySelectorAll('.nav-item').forEach((b) => (b.onclick = () => show(b.dataset.view)));

/* ---------- cartes ---------- */
function renderCards() {
  const q = state.q.toLowerCase();
  const list = [...state.conns]
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.host.toLowerCase().includes(q));
  const html = list.map((c) => {
    const ts = isTailscale(c.host);
    return `<article class="card ${state.busy.has(c.id) ? 'busy' : ''}" data-id="${esc(c.id)}" style="--c:${colorOf(c.id)}">
      <div class="banner">${ICON_WM}</div>
      <div class="top"><div class="disc" style="background:${colorOf(c.id)}">${ICON_PC}</div>
        <div><h4 title="${esc(c.name)}">${esc(c.name)}</h4></div></div>
      <div class="who">${c.user ? esc(c.user) : 'Identifiants demandés à la connexion'}</div>
      <div class="foot"><span class="pill">${esc(c.host)}</span>
        <span class="tag ${ts ? 'ts' : 'lan'}">${ts ? 'Tailscale' : 'Réseau local'}</span></div>
      <div class="acts"><button class="primary" data-act="connect">${ICON_PLAY}<span>${state.busy.has(c.id) ? 'Connexion…' : 'Se connecter'}</span></button>
        <button class="more" data-act="menu" aria-label="Options de ${esc(c.name)}">${ICON_MORE}</button></div>
    </article>`;
  }).join('');
  const add = `<button class="card add" id="add-card">
      <div class="disc"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div>
      <h4>Ajouter un PC</h4><p>Par IP locale ou Tailscale</p></button>`;
  const hint = q && !list.length ? `<p class="empty-hint">Aucun PC ne correspond à « ${esc(state.q)} ».</p>` : '';
  $('#cards').innerHTML = hint + html + add;
  $('#add-card').onclick = () => openEdit();
  const n = state.conns.length;
  $('#pc-count').textContent = n; $('#pc-count').hidden = !n;
}

$('#cards').addEventListener('click', (e) => {
  const card = e.target.closest('.card[data-id]'); if (!card) return;
  const c = state.conns.find((x) => x.id === card.dataset.id); if (!c) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'connect') connectTo(c);
  else if (act === 'menu') { const r = e.target.closest('.more').getBoundingClientRect(); openMenu(c, r.right - 180, r.bottom + 6); }
});
$('#cards').addEventListener('dblclick', (e) => {
  if (e.target.closest('button')) return;
  const card = e.target.closest('.card[data-id]');
  const c = card && state.conns.find((x) => x.id === card.dataset.id);
  if (c) connectTo(c);
});
$('#cards').addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.card[data-id]'); if (!card) return;
  e.preventDefault();
  const c = state.conns.find((x) => x.id === card.dataset.id);
  if (c) openMenu(c, e.clientX, e.clientY);
});
$('#q').oninput = (e) => { state.q = e.target.value; renderCards(); };

/* ---------- menu contextuel ---------- */
let menuConn = null;
function openMenu(c, x, y) {
  menuConn = c;
  const m = $('#menu'); m.hidden = false;
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 10) + 'px';
  m.style.top = Math.min(y, innerHeight - m.offsetHeight - 10) + 'px';
}
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) $('#menu').hidden = true; });
$('#menu').onclick = async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act || !menuConn) return;
  $('#menu').hidden = true;
  const c = menuConn;
  if (act === 'connect') connectTo(c);
  if (act === 'edit') openEdit(c);
  if (act === 'dup') {
    const n = { ...c, id: uid(), name: c.name + ' (copie)' };
    try { const pw = await invoke('pw_get', { id: c.id }); if (pw) await invoke('pw_set', { id: n.id, password: pw }); } catch {}
    state.conns.push(n); await saveConns(); renderCards();
  }
  if (act === 'del') askDelete(c);
};

/* ---------- fenêtres ---------- */
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }
document.querySelectorAll('.modal').forEach((m) => {
  m.addEventListener('mousedown', (e) => { if (e.target === m) m.hidden = true; });
  m.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => (m.hidden = true)));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { document.querySelectorAll('.modal').forEach((m) => (m.hidden = true)); $('#menu').hidden = true; }
});

let editing = null, afterSave = null;
async function openEdit(conn = null, prefill = {}, then = null) {
  editing = conn; afterSave = then;
  const c = { fullscreen: true, clipboard: true, sound: true, ...prefill, ...(conn || {}) };
  $('#edit-title').textContent = conn ? 'Modifier le PC' : 'Ajouter un PC';
  $('#f-name').value = c.name || ''; $('#f-host').value = c.host || ''; $('#f-user').value = c.user || '';
  $('#f-pw').value = '';
  $('#f-full').checked = !!c.fullscreen; $('#f-multi').checked = !!c.multimon; $('#f-clip').checked = !!c.clipboard;
  $('#f-sound').checked = !!c.sound; $('#f-drive').checked = !!c.drive;
  $('#edit-err').hidden = true;
  $('#f-ts').innerHTML = '<option value="">Tailscale…</option>' + (state.peers.length
    ? state.peers.map((p, i) => `<option value="${i}">${p.online ? '● ' : '○ '}${esc(p.name)}</option>`).join('')
    : '<option disabled>Aucun appareil</option>');
  openModal('#edit');
  (c.host ? $('#f-user') : $('#f-host')).focus();
  if (conn) { try { $('#f-pw').value = (await invoke('pw_get', { id: conn.id })) || ''; } catch {} }
}
$('#f-ts').onchange = (e) => {
  const p = state.peers[e.target.value]; if (!p) return;
  $('#f-host').value = p.ip; if (!$('#f-name').value.trim()) $('#f-name').value = p.name;
  e.target.value = '';
};
$('#edit-form').onsubmit = async (e) => {
  e.preventDefault();
  const host = $('#f-host').value.trim();
  if (!/^[A-Za-z0-9.\-:\[\]_]+$/.test(host)) { $('#edit-err').textContent = 'Indique une adresse IP ou un nom de PC valide.'; $('#edit-err').hidden = false; $('#f-host').focus(); return; }
  const vals = {
    name: $('#f-name').value.trim() || host, host, user: $('#f-user').value.trim(),
    fullscreen: $('#f-full').checked, multimon: $('#f-multi').checked, clipboard: $('#f-clip').checked,
    sound: $('#f-sound').checked, drive: $('#f-drive').checked,
  };
  let c = editing;
  if (c) Object.assign(c, vals); else { c = { id: uid(), ...vals }; state.conns.push(c); }
  try { await invoke('pw_set', { id: c.id, password: $('#f-pw').value }); }
  catch (err) { toast('Le mot de passe n’a pas pu être mémorisé : ' + err); }
  await saveConns(); renderCards(); renderPeers(); closeModal('#edit');
  const then = afterSave; afterSave = null; if (then) then(c);
};

function askDelete(c) {
  $('#confirm-title').textContent = `Supprimer « ${c.name} » ?`;
  $('#confirm-text').textContent = 'Le PC et son mot de passe enregistré seront retirés de SXM Remote.';
  $('#confirm-ok').onclick = async () => {
    closeModal('#confirm');
    try { await invoke('pw_set', { id: c.id, password: '' }); } catch {}
    state.conns = state.conns.filter((x) => x.id !== c.id); await saveConns(); renderCards(); renderPeers();
  };
  openModal('#confirm');
}

function askLogin(c) {
  return new Promise((resolve) => {
    $('#login-title').textContent = `Connexion à ${c.name}`;
    $('#l-user').value = c.user || ''; $('#l-pw').value = '';
    openModal('#login');
    (c.user ? $('#l-pw') : $('#l-user')).focus();
    const cancel = () => { resolve(null); };
    $('#login').querySelector('[data-close]').onclick = () => { closeModal('#login'); cancel(); };
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      c.user = $('#l-user').value.trim();
      const pw = $('#l-pw').value;
      if ($('#l-save').checked) { try { await invoke('pw_set', { id: c.id, password: pw }); } catch (err) { toast('Trousseau indisponible : ' + err); } }
      await saveConns(); renderCards(); closeModal('#login'); resolve(pw);
    };
  });
}

/* ---------- connexion ---------- */
async function connectTo(c) {
  if (!state.engine?.path) { show('home'); $('#engine-warn').scrollIntoView({ behavior: 'smooth' }); toast('Installe d’abord FreeRDP (voir l’encadré orange).'); return; }
  if (state.busy.has(c.id)) return;
  let pw = null;
  try { pw = await invoke('pw_get', { id: c.id }); } catch {}
  if (!pw || !c.user) { pw = await askLogin(c); if (pw === null) return; }
  state.busy.add(c.id); renderCards();
  setTimeout(() => { state.busy.delete(c.id); renderCards(); }, 6000);
  try { await invoke('connect', { conn: c, password: pw }); }
  catch (e) { state.busy.delete(c.id); renderCards(); toast(String(e)); }
}

T.event.listen('rdp-exit', async ({ payload }) => {
  state.busy.delete(payload.id); renderCards();
  const c = state.conns.find((x) => x.id === payload.id); const name = c ? c.name : 'le PC';
  if (payload.kind === 'auth') {
    try { await invoke('pw_set', { id: payload.id, password: '' }); } catch {}
    toast(`Identifiant ou mot de passe incorrect pour ${name}. Il te sera redemandé.`, 6000);
  } else if (payload.kind === 'unreachable') {
    toast(`Impossible de joindre ${name}.\nVérifie l’IP, Tailscale et que le Bureau à distance est activé sur le PC.`, 7000);
  } else if (payload.kind === 'error') {
    toast(`La connexion à ${name} s’est arrêtée (${payload.detail}).`, 6000);
  }
});

/* ---------- connexion rapide et Tailscale ---------- */
$('#quick').onsubmit = (e) => {
  e.preventDefault();
  const ip = $('#quick-ip').value.trim(); if (!ip) return;
  $('#quick-ip').value = '';
  const known = state.conns.find((c) => c.host === ip);
  if (known) return connectTo(known);
  openEdit(null, { name: ip, host: ip }, (c) => connectTo(c));
};

function renderPeers() {
  const box = $('#peers');
  if (!state.peers.length) { box.innerHTML = '<div class="info">Tailscale n’est pas installé ou pas connecté sur cet ordinateur.</div>'; return; }
  box.innerHTML = state.peers.slice(0, 8).map((p, i) => {
    const known = state.conns.some((c) => c.host === p.ip);
    return `<button class="peer ${known ? 'known' : ''}" data-i="${i}" title="${known ? 'Se connecter' : 'Ajouter ce PC'}">
      <span class="d ${p.online ? 'on' : ''}"></span>
      <span class="n"><b>${esc(p.name)}</b><small>${esc(p.ip)}</small></span>
      <span class="plus">${known ? 'Enregistré' : '+ Ajouter'}</span></button>`;
  }).join('');
}
$('#peers').onclick = (e) => {
  const b = e.target.closest('.peer'); if (!b) return;
  const p = state.peers[b.dataset.i];
  const known = state.conns.find((c) => c.host === p.ip);
  if (known) connectTo(known); else openEdit(null, { name: p.name, host: p.ip });
};
async function loadPeers() {
  try { state.peers = await invoke('tailscale_peers'); } catch { state.peers = []; }
  renderPeers();
}
$('#ts-refresh').onclick = loadPeers;
$('#add-big').onclick = () => openEdit();

/* ---------- moteur FreeRDP ---------- */
function renderEngine() {
  const w = $('#engine-warn');
  if (state.engine?.path) {
    w.hidden = true;
    $('#about-engine').textContent = `Moteur : FreeRDP ${state.engine.version || ''} — ${state.engine.path}`;
    return;
  }
  w.hidden = false;
  w.innerHTML = state.os === 'macos'
    ? '<b>FreeRDP n’est pas installé.</b> Installe-le avec Homebrew dans le Terminal : <code>brew install freerdp</code>, puis relance SXM Remote.'
    : '<b>FreeRDP n’est pas installé.</b> Installe-le dans un terminal : <code>sudo dnf install freerdp</code>, puis relance SXM Remote.';
  $('#about-engine').textContent = 'Moteur : FreeRDP non installé.';
}

/* ---------- mises à jour ---------- */
async function checkUpdate(manual) {
  $('#upd-check').disabled = true;
  if (manual) $('#upd-status').textContent = 'Recherche en cours…';
  try {
    const r = await invoke('check_update');
    if (r.url && newer(r.version, state.version)) {
      state.update = r;
      $('#update-text').innerHTML = `<b>SXM Remote ${esc(r.version)} est disponible.</b> Tu as la version ${esc(state.version)}.`;
      $('#update-bar').hidden = false; $('#upd-dot').hidden = false;
      $('#upd-status').textContent = `Nouvelle version ${r.version} disponible (installée : ${state.version}).`;
      $('#upd-install').textContent = `Installer la ${r.version}`; $('#upd-install').hidden = false;
    } else if (manual) {
      $('#upd-status').textContent = `SXM Remote est à jour (version ${state.version}).`;
    }
  } catch {
    if (manual) $('#upd-status').textContent = 'Impossible de vérifier les mises à jour. Vérifie ta connexion Internet.';
  } finally { $('#upd-check').disabled = false; }
}

async function installUpdate() {
  const u = state.update; if (!u) return;
  const btns = [$('#update-go'), $('#upd-install')];
  btns.forEach((b) => (b.disabled = true));
  const say = (m) => { $('#update-text').textContent = m; $('#upd-status').textContent = m; };
  say(`Téléchargement de la version ${u.version}…`);
  if (state.os !== 'macos') setTimeout(() => say('Installation… Fedora va te demander ton mot de passe.'), 2500);
  try {
    const res = await invoke('install_update', { url: u.url });
    if (res === 'opened') {
      say(`La version ${u.version} est téléchargée. Glisse SXM Remote dans Applications pour remplacer l’ancienne, puis relance-la.`);
    } else {
      say(`SXM Remote ${u.version} est installée. Redémarrage…`);
      setTimeout(() => invoke('restart'), 1200);
    }
  } catch (e) {
    say(e === 'cancelled' ? 'Mise à jour annulée.' : 'La mise à jour a échoué.');
    if (e !== 'cancelled') toast('La mise à jour n’a pas pu être installée :\n' + e, 8000);
    btns.forEach((b) => (b.disabled = false));
  }
}
$('#update-go').onclick = installUpdate;
$('#upd-install').onclick = installUpdate;
$('#upd-check').onclick = () => checkUpdate(true);
$('#upd-auto').onchange = async (e) => {
  state.settings.auto_update = e.target.checked;
  try { await invoke('save_settings', { settings: state.settings }); } catch {}
};

/* ---------- démarrage ---------- */
(async function init() {
  [state.version, state.os, state.engine, state.settings] = await Promise.all([
    invoke('app_version'), invoke('platform'), invoke('engine'), invoke('load_settings'),
  ]);
  const raw = await invoke('load_connections');
  state.conns = (Array.isArray(raw) ? raw : []).filter((c) => c && c.host).map((c) => ({ ...c, id: c.id || uid(), name: c.name || c.host }));
  $('#ver').textContent = 'v' + state.version;
  $('#about-title').textContent = 'SXM Remote ' + state.version;
  $('#upd-status').textContent = `Version installée : ${state.version}`;
  $('#upd-auto').checked = state.settings.auto_update !== false;
  document.body.classList.add('os-' + state.os);
  renderEngine(); renderCards(); renderPeers();
  loadPeers();
  if (state.settings.auto_update !== false) setTimeout(() => checkUpdate(false), 2500);
})();
