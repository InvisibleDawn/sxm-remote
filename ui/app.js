// SXM Remote — © 2026 Invisible_Dawn — GPL-3.0-or-later
const T = window.__TAURI__;
const invoke = T.core.invoke;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n) => `<svg class="lucide" aria-hidden="true"><use href="#i-${n}"/></svg>`;

const PALETTE = ['#1867d8', '#16a34a', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#4f46e5', '#059669'];
const state = { conns: [], settings: {}, peers: [], engine: null, os: 'linux', version: '', update: null, q: '', busy: new Set() };

/* ---------- utilitaires ---------- */
function toast(msg, kind = '', ms = 5000) {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg; t.setAttribute('role', 'status');
  $('#toasts').append(t); setTimeout(() => t.remove(), ms);
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
  catch (e) { toast('Impossible d’enregistrer : ' + e, 'err'); }
}

/* ---------- navigation et barre latérale ---------- */
function show(view) {
  ['home', 'about'].forEach((v) => ($('#view-' + v).hidden = v !== view));
  document.body.classList.toggle('at-home', view === 'home');
  document.body.classList.toggle('at-about', view === 'about');
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('sxm-theme', t); } catch {}
}
const ACTIONS = {
  home: () => show('home'),
  about: () => show('about'),
  add: () => openEdit(),
  quick: () => { show('home'); $('#quick-ip').focus(); },
  tailscale: () => { show('home'); $('#ts-head').scrollIntoView({ behavior: 'smooth' }); loadPeers(); },
  theme: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
};
document.querySelectorAll('#rail [data-act]').forEach((b) => (b.onclick = () => ACTIONS[b.dataset.act]?.()));

/* ---------- cartes des PC ---------- */
function renderCards() {
  const q = state.q.toLowerCase();
  const list = [...state.conns]
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.host.toLowerCase().includes(q));
  const html = list.map((c) => {
    const ts = isTailscale(c.host), busy = state.busy.has(c.id);
    return `<div class="home-card ${busy ? 'busy' : ''}" data-id="${esc(c.id)}" tabindex="0" title="Double-clic pour se connecter">
      <span class="ic" style="--ic:${colorOf(c.id)}">${icon('monitor')}</span>
      <span class="txt"><b>${esc(c.name)}</b>
        <span>${c.user ? esc(c.user) : 'Identifiants demandés à la connexion'}</span>
        <span class="chips"><span class="chip ip">${esc(c.host)}</span><span class="chip ${ts ? 'ts' : 'lan'}">${ts ? 'Tailscale' : 'Réseau local'}</span></span></span>
      <span class="acts">
        <button class="go" data-act="connect" title="${busy ? 'Connexion…' : 'Se connecter'}" aria-label="Se connecter à ${esc(c.name)}">${icon('play')}</button>
        <button class="more" data-act="menu" title="Options" aria-label="Options de ${esc(c.name)}">${icon('ellipsis')}</button>
      </span></div>`;
  }).join('');
  const add = `<button class="home-card add" id="add-card"><span class="ic">${icon('plus')}</span>
      <span class="txt"><b>Ajouter un PC</b><span>Par IP locale ou Tailscale.</span></span></button>`;
  const hint = q && !list.length ? `<p class="empty-hint">Aucun PC ne correspond à « ${esc(state.q)} ».</p>` : '';
  $('#cards').innerHTML = hint + html + add;
  $('#add-card').onclick = () => openEdit();
  const n = state.conns.length;
  $('#pc-count').textContent = n; $('#pc-count').hidden = !n;
  $('#pc-chip').textContent = n ? `${n} PC` : '';
  $('#st-count').textContent = n ? `${n} PC enregistré${n > 1 ? 's' : ''}` : 'Aucun PC enregistré';
}

const connOf = (el) => { const card = el.closest('.home-card[data-id]'); return card && state.conns.find((x) => x.id === card.dataset.id); };
$('#cards').addEventListener('click', (e) => {
  const c = connOf(e.target); if (!c) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'connect') connectTo(c);
  else if (act === 'menu') { const r = e.target.closest('.more').getBoundingClientRect(); openMenu(c, r.right - 200, r.bottom + 6); }
});
$('#cards').addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; const c = connOf(e.target); if (c) connectTo(c); });
$('#cards').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.home-card[data-id]')) { const c = connOf(e.target); if (c) connectTo(c); } });
$('#cards').addEventListener('contextmenu', (e) => {
  const c = connOf(e.target); if (!c) return;
  e.preventDefault(); openMenu(c, e.clientX, e.clientY);
});
$('#q').oninput = (e) => { state.q = e.target.value; renderCards(); };

/* ---------- menu contextuel ---------- */
let menuConn = null;
function openMenu(c, x, y) {
  menuConn = c;
  const m = $('#menu'); m.hidden = false;
  m.style.left = Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 10)) + 'px';
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
const openModal = (id) => ($(id).hidden = false);
const closeModal = (id) => ($(id).hidden = true);
document.querySelectorAll('.modal-bg').forEach((m) => {
  m.addEventListener('mousedown', (e) => { if (e.target === m) m.querySelector('[data-close]')?.click(); });
  m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => (m.hidden = true)));
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.modal-bg:not([hidden])').forEach((m) => m.querySelector('[data-close]')?.click());
  $('#menu').hidden = true;
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
  if (!/^[A-Za-z0-9.\-:\[\]_]+$/.test(host)) {
    $('#edit-err').textContent = 'Indique une adresse IP ou un nom de PC valide.'; $('#edit-err').hidden = false; $('#f-host').focus(); return;
  }
  const vals = {
    name: $('#f-name').value.trim() || host, host, user: $('#f-user').value.trim(),
    fullscreen: $('#f-full').checked, multimon: $('#f-multi').checked, clipboard: $('#f-clip').checked,
    sound: $('#f-sound').checked, drive: $('#f-drive').checked,
  };
  let c = editing;
  if (c) Object.assign(c, vals); else { c = { id: uid(), ...vals }; state.conns.push(c); }
  try { await invoke('pw_set', { id: c.id, password: $('#f-pw').value }); }
  catch (err) { toast('Le mot de passe n’a pas pu être mémorisé : ' + err, 'err'); }
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
    $('#login').querySelector('[data-close]').onclick = () => { closeModal('#login'); resolve(null); };
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      c.user = $('#l-user').value.trim();
      const pw = $('#l-pw').value;
      if ($('#l-save').checked) { try { await invoke('pw_set', { id: c.id, password: pw }); } catch (err) { toast('Trousseau indisponible : ' + err, 'err'); } }
      await saveConns(); renderCards(); closeModal('#login'); resolve(pw);
    };
  });
}

/* ---------- connexion ---------- */
async function connectTo(c) {
  if (!state.engine?.path) { show('home'); $('#engine-warn').scrollIntoView({ behavior: 'smooth' }); toast('Installe d’abord FreeRDP (voir l’encadré orange).', 'err'); return; }
  if (state.busy.has(c.id)) return;
  let pw = null;
  try { pw = await invoke('pw_get', { id: c.id }); } catch {}
  if (!pw || !c.user) { pw = await askLogin(c); if (pw === null) return; }
  state.busy.add(c.id); renderCards();
  setTimeout(() => { state.busy.delete(c.id); renderCards(); }, 6000);
  try { await invoke('connect', { conn: c, password: pw }); }
  catch (e) { state.busy.delete(c.id); renderCards(); toast(String(e), 'err'); }
}

T.event.listen('rdp-exit', async ({ payload }) => {
  state.busy.delete(payload.id); renderCards();
  const c = state.conns.find((x) => x.id === payload.id); const name = c ? c.name : 'le PC';
  if (payload.kind === 'auth') {
    try { await invoke('pw_set', { id: payload.id, password: '' }); } catch {}
    toast(`Identifiant ou mot de passe incorrect pour ${name}. Il te sera redemandé.`, 'err', 7000);
  } else if (payload.kind === 'unreachable') {
    toast(`Impossible de joindre ${name}.\nVérifie l’IP, Tailscale et que le Bureau à distance est activé sur le PC.`, 'err', 8000);
  } else if (payload.kind === 'error') {
    toast(`La connexion à ${name} s’est arrêtée (${payload.detail}).`, 'err', 7000);
  }
});

/* ---------- connexion rapide et Tailscale ---------- */
$('#quick').onsubmit = (e) => {
  e.preventDefault();
  const ip = $('#quick-ip').value.trim(); if (!ip) { $('#quick-ip').focus(); return; }
  $('#quick-ip').value = '';
  const known = state.conns.find((c) => c.host === ip);
  if (known) return connectTo(known);
  openEdit(null, { name: ip, host: ip }, (c) => connectTo(c));
};

function renderPeers() {
  const box = $('#peers');
  const online = state.peers.filter((p) => p.online).length;
  $('#st-ts').innerHTML = state.peers.length
    ? `<span class="live">●</span> Tailscale : ${online} appareil${online > 1 ? 's' : ''} en ligne`
    : 'Tailscale non détecté';
  if (!state.peers.length) { box.innerHTML = '<div class="info">Tailscale n’est pas installé ou pas connecté sur cet ordinateur. Tes PC restent joignables par leur IP locale.</div>'; return; }
  box.innerHTML = state.peers.slice(0, 9).map((p, i) => {
    const known = state.conns.some((c) => c.host === p.ip);
    return `<button class="home-card" data-i="${i}" title="${known ? 'Se connecter' : 'Ajouter ce PC'}">
      <span class="ic">${icon('laptop')}<i class="${p.online ? 'on' : ''}"></i></span>
      <span class="txt"><b>${esc(p.name)}</b><span>${esc(p.ip)} · ${p.online ? 'en ligne' : 'hors ligne'}</span></span>
      <span class="chip ${known ? '' : 'ts'}">${known ? 'Enregistré' : '+ Ajouter'}</span></button>`;
  }).join('');
}
$('#peers').onclick = (e) => {
  const b = e.target.closest('[data-i]'); if (!b) return;
  const p = state.peers[b.dataset.i];
  const known = state.conns.find((c) => c.host === p.ip);
  if (known) connectTo(known); else openEdit(null, { name: p.name, host: p.ip });
};
async function loadPeers() {
  try { state.peers = await invoke('tailscale_peers'); } catch { state.peers = []; }
  renderPeers();
}
$('#ts-refresh').onclick = loadPeers;

/* ---------- moteur de connexion ---------- */
function renderEngine() {
  const w = $('#engine-warn');
  const e = state.engine;
  if (e?.path) {
    w.hidden = true;
    const label = e.kind === 'mstsc' ? 'Bureau à distance Windows' : `FreeRDP ${e.version || ''}`.trim();
    $('#about-engine').textContent = `Moteur : ${label} — ${e.path}`;
    $('#st-engine').textContent = label;
    return;
  }
  w.hidden = false;
  w.innerHTML = icon('triangle-alert') + (state.os === 'macos'
    ? '<span><b>FreeRDP n’est pas installé.</b> Dans le Terminal : <code>brew install freerdp</code>, puis relance SXM Remote.</span>'
    : '<span><b>FreeRDP n’est pas installé.</b> Dans un terminal : <code>sudo dnf install freerdp</code>, puis relance SXM Remote.</span>');
  $('#about-engine').textContent = 'Moteur : FreeRDP non installé.';
  $('#st-engine').textContent = 'Moteur non installé';
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
  if (state.os === 'linux') setTimeout(() => say('Installation… Fedora va te demander ton mot de passe.'), 2500);
  try {
    const res = await invoke('install_update', { url: u.url });
    if (res === 'opened') {
      say(`La version ${u.version} est téléchargée. Glisse SXM Remote dans Applications pour remplacer l’ancienne, puis relance-la.`);
    } else if (res === 'launched') {
      say(`L’installation de la version ${u.version} démarre…`);
    } else {
      say(`SXM Remote ${u.version} est installée. Redémarrage…`);
      setTimeout(() => invoke('restart'), 1200);
    }
  } catch (e) {
    say(e === 'cancelled' ? 'Mise à jour annulée.' : 'La mise à jour a échoué.');
    if (e !== 'cancelled') toast('La mise à jour n’a pas pu être installée :\n' + e, 'err', 9000);
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
  if (state.os === 'windows') $('#fs-key').textContent = 'Pause';
  document.body.classList.add('os-' + state.os);
  show('home'); renderEngine(); renderCards(); renderPeers();
  loadPeers();
  if (state.settings.auto_update !== false) setTimeout(() => checkUpdate(false), 2500);
})();
