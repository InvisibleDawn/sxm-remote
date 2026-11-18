#!/usr/bin/env python3
"""SXM Remote v1.2 — client Bureau à distance (RDP) pour Fedora, style SXM.
S'appuie sur FreeRDP. Connexions : ~/.config/sxm-rdp/connections.json
Mots de passe : trousseau (libsecret)."""
import json, os, shutil, subprocess, sys, threading, urllib.request, uuid, zlib
import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gdk, GLib, Pango

try:
    gi.require_version("Secret", "1")
    from gi.repository import Secret
    SCHEMA = Secret.Schema.new("com.sxm.rdp", Secret.SchemaFlags.NONE,
                               {"id": Secret.SchemaAttributeType.STRING})
except Exception:
    Secret = None

VERSION = "1.3"
GITHUB_REPO = "InvisibleDawn/sxm-remote"
RELEASE_API = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"


def vtuple(v):
    out = []
    for p in v.lstrip("vV").split("."):
        num = "".join(ch for ch in p if ch.isdigit())
        out.append(int(num) if num else 0)
    return tuple(out)


def fetch_latest():
    """Retourne (version, url_rpm, notes) ou lève une exception."""
    req = urllib.request.Request(RELEASE_API, headers={
        "Accept": "application/vnd.github+json", "User-Agent": f"SXM-Remote/{VERSION}"})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.load(r)
    url = next((a["browser_download_url"] for a in data.get("assets", [])
                if a["name"].endswith(".noarch.rpm")), None)
    return data.get("tag_name", "0").lstrip("vV"), url, (data.get("body") or "").strip()
CONF_DIR = os.path.join(GLib.get_user_config_dir(), "sxm-rdp")
CONF = os.path.join(CONF_DIR, "connections.json")

PALETTE = [  # (dégradé bandeau, couleur pastille)
    ("#14a38b", "#0f9b8e", "#1aa58f"),
    ("#4f9a3a", "#7cbf4a", "#5aa33f"),
    ("#2f5fb3", "#3d7bd9", "#3567c2"),
    ("#c2185b", "#e0336f", "#cc1f5f"),
    ("#3a4252", "#5b6577", "#454e60"),
    ("#0b5ed7", "#3a8bff", "#1a6be6"),
    ("#8a4bd6", "#a979f0", "#9257de"),
    ("#e07a1f", "#f2a03d", "#e3862a"),
]

CSS = """
window.sxm { background-color: #e6eef8; }
.sxm label { color: #14213d; }
.sidebar { background-color: #ffffff; border-right: 1px solid #e1e7ef; padding: 22px 14px 16px 14px; }
.brand-icon { background-image: linear-gradient(135deg, #3a7cf0, #1f56c7); border-radius: 14px;
              min-width: 50px; min-height: 50px; color: #ffffff; }
.brand-title { font-size: 17pt; font-weight: bold; }
.muted, .sxm .muted { color: #6b7a90; }
.nav-btn { background-image: none; background-color: transparent; border: none; box-shadow: none;
           border-radius: 10px; padding: 10px 14px; }
.nav-btn:hover { background-color: #eef3fb; }
.nav-btn label { font-size: 12pt; }
.nav-btn image { color: #33415c; }
.nav-active, .nav-active:hover { background-color: #1f5fd6; }
.nav-active label, .nav-active image { color: #ffffff; font-weight: bold; }
.badge { background-color: #1f5fd6; color: #ffffff; border-radius: 99px; min-width: 22px; min-height: 22px;
         font-weight: bold; font-size: 9pt; }
.nav-active .badge { background-color: #ffffff; color: #1f5fd6; }
.promo { background-color: #eaf1fc; border-radius: 14px; padding: 16px; }
.hero { background-image: linear-gradient(90deg, #eaf5fb, #9fd8e6 60%, #1aa3b8); border-radius: 0 0 18px 18px;
        min-height: 26px; }
.h1 { font-size: 17pt; font-weight: bold; }
.h2 { font-size: 13pt; font-weight: bold; }
entry.search { background-color: #ffffff; border: 1px solid #dbe3ee; border-radius: 12px; padding: 8px 12px;
               box-shadow: none; background-image: none; color: #14213d; min-width: 220px; }
entry.field { background-color: #ffffff; border: 1px solid #cfd8e5; border-radius: 10px; padding: 8px 12px;
              background-image: none; box-shadow: none; color: #14213d; }
.card { background-color: #ffffff; border-radius: 16px; border: 2px solid #e5ebf3; }
.card:hover { border-color: #1f5fd6; }
.banner { border-radius: 14px 14px 0 0; min-height: 74px; }
.avatar { border-radius: 99px; border: 5px solid #ffffff; min-width: 54px; min-height: 54px; color: #ffffff; }
.card-name { font-size: 14pt; font-weight: bold; }
.chip { background-color: #eef2f7; border-radius: 99px; padding: 4px 12px; font-weight: bold; }
.chip-ts { background-color: #e1f5ea; color: #17804a; }
.chip-lan { background-color: #e5eefc; color: #1f56c7; }
.btn-primary { background-image: none; background-color: #1f5fd6; border: none; border-radius: 10px;
               box-shadow: none; padding: 8px 16px; }
.btn-primary:hover { background-color: #2a6ce8; }
.btn-primary label, .btn-primary image { color: #ffffff; font-weight: bold; }
.btn-big { padding: 14px; border-radius: 14px; }
.btn-big label { font-size: 13pt; }
.btn-ghost { background-image: none; background-color: transparent; border: 1px solid #dbe3ee;
             border-radius: 10px; box-shadow: none; padding: 6px 8px; }
.btn-ghost:hover { background-color: #eef3fb; }
.btn-ghost image { color: #33415c; }
.add-card { border: 2px dashed #c3cede; border-radius: 16px; background-color: rgba(255,255,255,0.55); }
.add-card:hover { border-color: #1f5fd6; background-color: rgba(255,255,255,0.85); }
.plus { border: 2px dashed #b4c1d3; border-radius: 99px; min-width: 56px; min-height: 56px; color: #6b7a90; }
.panel { background-color: #ffffff; border-radius: 16px; border: 1px solid #e1e7ef; padding: 18px; }
.peer { background-image: none; background-color: #f5f8fc; border: 1px solid #e5ebf3; border-radius: 10px;
        box-shadow: none; padding: 8px 10px; }
.peer:hover { border-color: #1f5fd6; }
.dot-on { color: #22a55b; } .dot-off { color: #b4bfcd; }
.info { background-color: #eaf1fc; border-radius: 10px; padding: 10px 12px; }
.info label { color: #1f56c7; }
.update-bar { background-color: #e1f5ea; border: 1px solid #b6e3c8; border-radius: 12px; padding: 10px 14px; }
.update-bar label { color: #17603a; }
.update-bar image { color: #17804a; }
.update-bar .btn-primary label { color: #ffffff; }
"""


def find_freerdp():
    for b in ("xfreerdp3", "xfreerdp", "sdl-freerdp3", "sdl-freerdp"):
        p = shutil.which(b)
        if p:
            try:
                out = subprocess.run([p, "--version"], capture_output=True, text=True).stdout
                v3 = "version 3" in out
            except Exception:
                v3 = "3" in b
            return p, v3
    return None, False


def load():
    try:
        with open(CONF) as f:
            return json.load(f)
    except Exception:
        return []


SETTINGS = os.path.join(CONF_DIR, "settings.json")


def load_settings():
    try:
        with open(SETTINGS) as f:
            return json.load(f)
    except Exception:
        return {}


def save_settings(s):
    os.makedirs(CONF_DIR, exist_ok=True)
    with open(SETTINGS, "w") as f:
        json.dump(s, f, indent=2)


def save(conns):
    os.makedirs(CONF_DIR, exist_ok=True)
    with open(CONF, "w") as f:
        json.dump(conns, f, indent=2)
    os.chmod(CONF, 0o600)


def pw_get(cid):
    if Secret:
        try:
            return Secret.password_lookup_sync(SCHEMA, {"id": cid}, None)
        except Exception:
            pass
    return None


def pw_set(cid, pw):
    if not Secret:
        return False
    try:
        if pw:
            Secret.password_store_sync(SCHEMA, {"id": cid}, Secret.COLLECTION_DEFAULT,
                                       f"SXM Remote {cid}", pw, None)
        else:
            Secret.password_clear_sync(SCHEMA, {"id": cid}, None)
        return True
    except Exception:
        return False


def tailscale_peers():
    ts = shutil.which("tailscale")
    if not ts:
        return []
    try:
        data = json.loads(subprocess.run([ts, "status", "--json"], capture_output=True,
                                         text=True, timeout=5).stdout)
        peers = []
        for p in (data.get("Peer") or {}).values():
            ips = p.get("TailscaleIPs") or []
            if ips:
                peers.append((p.get("HostName", "?"), ips[0], p.get("Online", False)))
        return sorted(peers, key=lambda x: (not x[2], x[0].lower()))
    except Exception:
        return []


def is_tailscale(host):
    try:
        a, b = (int(x) for x in host.split(".")[:2])
        return a == 100 and 64 <= b <= 127
    except Exception:
        return host.endswith(".ts.net")


def cls(w, *names):
    ctx = w.get_style_context()
    for n in names:
        ctx.add_class(n)
    return w


def label(text, *classes, xalign=0, wrap=False, ellipsize=False):
    l = Gtk.Label(label=text, xalign=xalign)
    if wrap:
        l.set_line_wrap(True)
        l.set_max_width_chars(30)
    if ellipsize:
        l.set_ellipsize(Pango.EllipsizeMode.END)
        l.set_max_width_chars(16)
    return cls(l, *classes)


def icon(name, size=16):
    img = Gtk.Image.new_from_icon_name(name, Gtk.IconSize.BUTTON)
    img.set_pixel_size(size)
    return img


def color_css(cid, idx):
    return f"""
    .bn-{idx} {{ background-image: linear-gradient(120deg, {PALETTE[idx][0]}, {PALETTE[idx][1]}); }}
    .av-{idx} {{ background-color: {PALETTE[idx][2]}; }}"""


class EditDialog(Gtk.Dialog):
    def __init__(self, parent, conn=None, prefill=None):
        super().__init__(title="Modifier le PC" if conn else "Ajouter un PC",
                         transient_for=parent, modal=True)
        self.add_buttons("Annuler", Gtk.ResponseType.CANCEL, "Enregistrer", Gtk.ResponseType.OK)
        self.set_default_response(Gtk.ResponseType.OK)
        self.set_default_size(460, -1)
        c = dict(prefill or {}, **(conn or {}))
        g = Gtk.Grid(column_spacing=12, row_spacing=10, margin=18)
        self.get_content_area().add(g)

        self.name = Gtk.Entry(text=c.get("name", ""), placeholder_text="PC Bureau")
        self.host = Gtk.Entry(text=c.get("host", ""), placeholder_text="192.168.1.20 ou 100.x.x.x")
        self.user = Gtk.Entry(text=c.get("user", ""), placeholder_text="Administrateur ou DOMAINE\\utilisateur")
        self.pw = Gtk.Entry(visibility=False, placeholder_text="Facultatif")
        if conn:
            self.pw.set_text(pw_get(conn["id"]) or "")
        self.full = Gtk.CheckButton(label="Plein écran", active=c.get("fullscreen", True))
        self.multi = Gtk.CheckButton(label="Utiliser tous les écrans", active=c.get("multimon", False))
        self.clip = Gtk.CheckButton(label="Presse-papiers partagé", active=c.get("clipboard", True))
        self.sound = Gtk.CheckButton(label="Son du PC distant", active=c.get("sound", True))
        self.drive = Gtk.CheckButton(label="Partager mon dossier personnel", active=c.get("drive", False))

        ts_btn = Gtk.MenuButton(label="Tailscale")
        menu = Gtk.Menu()
        peers = tailscale_peers()
        if not peers:
            menu.append(Gtk.MenuItem(label="Aucun appareil Tailscale trouvé", sensitive=False))
        for hn, ip, online in peers:
            it = Gtk.MenuItem(label=f"{'●' if online else '○'}  {hn}  ({ip})")
            it.connect("activate", lambda _w, hn=hn, ip=ip: (
                self.host.set_text(ip), self.name.get_text() or self.name.set_text(hn)))
            menu.append(it)
        menu.show_all()
        ts_btn.set_popup(menu)

        rows = [("Nom", self.name), ("Adresse IP", self.host),
                ("Utilisateur", self.user), ("Mot de passe", self.pw)]
        for i, (lbl, w) in enumerate(rows):
            g.attach(Gtk.Label(label=lbl, xalign=1), 0, i, 1, 1)
            w.set_hexpand(True)
            w.set_activates_default(True)
            g.attach(w, 1, i, 1, 1)
        g.attach(ts_btn, 2, 1, 1, 1)
        for j, cb in enumerate((self.full, self.multi, self.clip, self.sound, self.drive)):
            g.attach(cb, 1, len(rows) + j, 2, 1)
        if not Secret:
            g.attach(Gtk.Label(label="Trousseau indisponible : le mot de passe ne sera pas mémorisé.",
                               wrap=True), 0, 10, 3, 1)
        self.show_all()

    def values(self):
        return dict(name=self.name.get_text().strip() or self.host.get_text().strip(),
                    host=self.host.get_text().strip(), user=self.user.get_text().strip(),
                    fullscreen=self.full.get_active(), multimon=self.multi.get_active(),
                    clipboard=self.clip.get_active(), sound=self.sound.get_active(),
                    drive=self.drive.get_active()), self.pw.get_text()


class App(Gtk.Window):
    def __init__(self):
        super().__init__(title="SXM Remote")
        cls(self, "sxm")
        self.set_default_size(1280, 800)
        self.set_icon_name("preferences-desktop-remote-desktop")
        self.conns = load()
        self.settings = load_settings()
        self.update = None
        self.freerdp, self.v3 = find_freerdp()
        self.dyn_css = Gtk.CssProvider()

        screen = Gdk.Screen.get_default()
        prov = Gtk.CssProvider()
        prov.load_from_data(CSS.encode())
        Gtk.StyleContext.add_provider_for_screen(screen, prov, Gtk.STYLE_PROVIDER_PRIORITY_USER)
        Gtk.StyleContext.add_provider_for_screen(screen, self.dyn_css, Gtk.STYLE_PROVIDER_PRIORITY_USER)
        css = "".join(color_css(None, i) for i in range(len(PALETTE)))
        self.dyn_css.load_from_data(css.encode())

        root = Gtk.Box()
        self.add(root)
        root.pack_start(self.build_sidebar(), False, False, 0)

        self.pages = Gtk.Stack(transition_type=Gtk.StackTransitionType.CROSSFADE)
        root.pack_start(self.pages, True, True, 0)
        self.pages.add_named(self.build_home(), "home")
        self.pages.add_named(self.build_about(), "about")

    # ---------- barre latérale ----------
    def build_sidebar(self):
        side = cls(Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8), "sidebar")
        side.set_size_request(240, -1)

        brand = Gtk.Box(spacing=14, margin_bottom=22, margin_start=6)
        bi = cls(Gtk.Box(valign=Gtk.Align.CENTER), "brand-icon")
        img = icon("preferences-desktop-remote-desktop-symbolic", 26)
        bi.pack_start(img, True, True, 0)
        brand.pack_start(bi, False, False, 0)
        t = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, valign=Gtk.Align.CENTER)
        t.add(label("SXM Remote", "brand-title"))
        t.add(label(f"v{VERSION}", "muted"))
        brand.pack_start(t, False, False, 0)
        side.add(brand)

        self.nav = {}
        for key, ic, txt in (("home", "go-home-symbolic", "Mes PC"),
                             ("about", "help-about-symbolic", "À propos")):
            b = cls(Gtk.Button(), "nav-btn")
            row = Gtk.Box(spacing=14)
            row.pack_start(icon(ic, 18), False, False, 0)
            row.pack_start(label(txt), True, True, 0)
            if key == "home":
                self.badge = cls(Gtk.Label(), "badge")
                row.pack_end(self.badge, False, False, 0)
            b.add(row)
            b.connect("clicked", lambda _b, k=key: self.go(k))
            side.add(b)
            self.nav[key] = b

        spacer = Gtk.Box(vexpand=True)
        side.add(spacer)

        promo = cls(Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10), "promo")
        pi = icon("network-workgroup-symbolic", 54)
        cls(pi, "muted")
        promo.add(pi)
        promo.add(label("Tous tes PC, à un clic.", "muted", xalign=0.5))
        side.add(promo)
        return side

    def go(self, key):
        self.pages.set_visible_child_name(key)
        for k, b in self.nav.items():
            ctx = b.get_style_context()
            (ctx.add_class if k == key else ctx.remove_class)("nav-active")
        return False

    # ---------- page d'accueil ----------
    def build_home(self):
        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        hero = cls(Gtk.Box(margin_start=24, margin_end=24), "hero")
        outer.add(hero)

        body = Gtk.Box(spacing=22, margin=24)
        outer.pack_start(body, True, True, 0)

        # colonne centrale
        center = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16, hexpand=True)
        head = Gtk.Box(spacing=12)
        head.pack_start(label("Mes PC", "h1"), True, True, 0)
        self.search = cls(Gtk.SearchEntry(placeholder_text="Rechercher un PC…"), "search")
        self.search.connect("search-changed", lambda *_: self.flow.invalidate_filter())
        head.pack_end(self.search, False, False, 0)
        center.add(head)

        # bandeau de mise à jour (caché tant qu'il n'y a rien)
        self.upd_bar = cls(Gtk.Box(spacing=12), "update-bar")
        self.upd_bar.set_no_show_all(True)
        self.upd_bar.pack_start(icon("software-update-available-symbolic", 20), False, False, 0)
        self.upd_label = label("", wrap=True)
        self.upd_bar.pack_start(self.upd_label, True, True, 0)
        self.upd_btn = cls(Gtk.Button(label="Mettre à jour"), "btn-primary")
        self.upd_btn.connect("clicked", lambda *_: self.install_update())
        self.upd_bar.pack_end(self.upd_btn, False, False, 0)
        center.add(self.upd_bar)

        if not self.freerdp:
            bar = Gtk.InfoBar(message_type=Gtk.MessageType.WARNING)
            bar.get_content_area().add(Gtk.Label(
                label="FreeRDP introuvable. Installe-le : sudo dnf install freerdp"))
            center.add(bar)

        sw = Gtk.ScrolledWindow(hscrollbar_policy=Gtk.PolicyType.NEVER)
        self.flow = Gtk.FlowBox(selection_mode=Gtk.SelectionMode.NONE, homogeneous=True,
                                min_children_per_line=1, max_children_per_line=4,
                                row_spacing=18, column_spacing=18, valign=Gtk.Align.START)
        self.flow.set_filter_func(self.filter)
        sw.add(self.flow)
        center.pack_start(sw, True, True, 0)
        body.pack_start(center, True, True, 0)

        body.pack_start(self.build_right(), False, False, 0)
        self.refresh()
        return outer

    def build_right(self):
        col = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18)
        col.set_size_request(290, -1)

        # connexion rapide
        p = cls(Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12), "panel")
        p.add(label("Connexion rapide", "h2"))
        self.quick = cls(Gtk.Entry(placeholder_text="Adresse IP du PC"), "field")
        self.quick.connect("activate", self.on_quick)
        p.add(self.quick)
        p.add(label("IP locale (192.168.x.x, 10.x.x.x) ou Tailscale (100.x.x.x).",
                    "muted", wrap=True))
        col.add(p)

        # tailscale
        t = cls(Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10), "panel")
        h = Gtk.Box()
        h.pack_start(label("Appareils Tailscale", "h2"), True, True, 0)
        rb = cls(Gtk.Button(), "btn-ghost")
        rb.add(icon("view-refresh-symbolic"))
        rb.set_tooltip_text("Actualiser")
        rb.connect("clicked", lambda *_: self.fill_peers())
        h.pack_end(rb, False, False, 0)
        t.add(h)
        self.peers_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        t.add(self.peers_box)
        col.add(t)
        self.fill_peers()

        go = cls(Gtk.Button(), "btn-primary", "btn-big")
        r = Gtk.Box(spacing=10, halign=Gtk.Align.CENTER)
        r.add(icon("list-add-symbolic", 18))
        r.add(Gtk.Label(label="Ajouter un PC"))
        go.add(r)
        go.connect("clicked", self.on_add)
        col.add(go)
        return col

    def fill_peers(self):
        for ch in self.peers_box.get_children():
            self.peers_box.remove(ch)
        peers = tailscale_peers()
        if not peers:
            box = cls(Gtk.Box(), "info")
            box.add(label("Tailscale n'est pas installé ou pas connecté.", wrap=True))
            self.peers_box.add(box)
        for hn, ip, online in peers[:6]:
            b = cls(Gtk.Button(), "peer")
            row = Gtk.Box(spacing=10)
            row.pack_start(cls(Gtk.Label(label="●"), "dot-on" if online else "dot-off"), False, False, 0)
            v = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
            v.add(label(hn, ellipsize=True))
            v.add(label(ip, "muted"))
            row.pack_start(v, True, True, 0)
            row.pack_end(icon("list-add-symbolic"), False, False, 0)
            b.add(row)
            b.set_tooltip_text("Ajouter ce PC")
            b.connect("clicked", lambda _b, hn=hn, ip=ip: self.on_add(prefill={"name": hn, "host": ip}))
            self.peers_box.add(b)
        self.peers_box.show_all()

    def build_about(self):
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14, margin=40,
                      valign=Gtk.Align.START)
        p = cls(Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12), "panel")
        p.add(label("À propos de SXM Remote", "h1"))
        p.add(label(f"Version {VERSION}. Client Bureau à distance (RDP) basé sur FreeRDP.",
                    "muted", wrap=True))
        p.add(label("Raccourcis", "h2"))
        p.add(label("Ctrl + Alt + Entrée : basculer plein écran / fenêtre", wrap=True))
        p.add(label("Double-clic sur une carte : se connecter", wrap=True))
        moteur = self.freerdp or "non installé"
        p.add(label(f"Moteur : {moteur}", "muted", wrap=True))
        box.add(p)

        u = cls(Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12), "panel")
        u.add(label("Mises à jour", "h2"))
        self.about_status = label(f"Version installée : {VERSION}", "muted", wrap=True)
        u.add(self.about_status)
        row = Gtk.Box(spacing=10)
        self.check_btn = cls(Gtk.Button(label="Rechercher une mise à jour"), "btn-primary")
        self.check_btn.connect("clicked", lambda *_: self.check_update(manual=True))
        row.pack_start(self.check_btn, False, False, 0)
        self.about_install = cls(Gtk.Button(label="Installer"), "btn-primary")
        self.about_install.set_no_show_all(True)
        self.about_install.connect("clicked", lambda *_: self.install_update())
        row.pack_start(self.about_install, False, False, 0)
        u.add(row)
        self.auto_check = Gtk.CheckButton(label="Vérifier automatiquement au démarrage",
                                          active=self.settings.get("auto_update", True))
        self.auto_check.connect("toggled", self.on_auto_toggled)
        u.add(self.auto_check)
        box.add(u)
        return box

    # ---------- mises à jour ----------
    def on_auto_toggled(self, cb):
        self.settings["auto_update"] = cb.get_active()
        save_settings(self.settings)

    def check_update(self, manual=False):
        self.check_btn.set_sensitive(False)
        if manual:
            self.about_status.set_text("Recherche en cours…")

        def work():
            try:
                res = fetch_latest()
                err = None
            except Exception as e:
                res, err = None, e
            GLib.idle_add(self.on_checked, res, err, manual)
        threading.Thread(target=work, daemon=True).start()

    def on_checked(self, res, err, manual):
        self.check_btn.set_sensitive(True)
        if err or not res:
            if manual:
                self.about_status.set_text("Impossible de vérifier les mises à jour. "
                                           "Vérifie ta connexion Internet.")
            return False
        ver, url, notes = res
        if url and vtuple(ver) > vtuple(VERSION):
            self.update = (ver, url)
            self.upd_label.set_markup(f"<b>SXM Remote {GLib.markup_escape_text(ver)} est disponible.</b>  "
                                      f"Tu as la version {VERSION}.")
            for ch in self.upd_bar.get_children():
                ch.show_all()
            self.upd_bar.show()
            self.about_status.set_text(f"Nouvelle version {ver} disponible (installée : {VERSION}).")
            self.about_install.set_label(f"Installer la {ver}")
            self.about_install.show()
        elif manual:
            self.about_status.set_text(f"SXM Remote est à jour (version {VERSION}).")
        return False

    def install_update(self):
        if not getattr(self, "update", None):
            return
        ver, url = self.update
        if not shutil.which("pkexec"):
            return self.error("pkexec est introuvable.\n\nsudo dnf install polkit")
        for b in (self.upd_btn, self.about_install):
            b.set_sensitive(False)
        self.upd_label.set_text(f"Téléchargement de la version {ver}…")
        self.about_status.set_text(f"Téléchargement de la version {ver}…")
        dest = os.path.join(GLib.get_user_cache_dir(), "sxm-remote", f"sxm-remote-{ver}.noarch.rpm")

        def work():
            try:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                req = urllib.request.Request(url, headers={"User-Agent": f"SXM-Remote/{VERSION}"})
                with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
                    shutil.copyfileobj(r, f)
                GLib.idle_add(self.upd_label.set_text, "Installation… (mot de passe demandé)")
                p = subprocess.run(["pkexec", "dnf", "install", "-y", dest],
                                   capture_output=True, text=True)
                ok, msg = p.returncode == 0, (p.stderr or p.stdout)[-400:]
            except Exception as e:
                ok, msg = False, str(e)
            GLib.idle_add(self.on_installed, ok, msg, ver)
        threading.Thread(target=work, daemon=True).start()

    def on_installed(self, ok, msg, ver):
        for b in (self.upd_btn, self.about_install):
            b.set_sensitive(True)
        if not ok:
            self.upd_label.set_text("La mise à jour a échoué.")
            self.about_status.set_text("La mise à jour a échoué.")
            if "126" not in msg and "dismissed" not in msg.lower():
                self.error("La mise à jour n'a pas pu être installée.\n\n" + msg)
            return False
        d = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.INFO,
                              buttons=Gtk.ButtonsType.OK,
                              text=f"SXM Remote {ver} est installée.")
        d.format_secondary_text("L'application va redémarrer.")
        d.run()
        d.destroy()
        exe = shutil.which("sxm-remote") or sys.argv[0]
        os.execv(sys.executable, [sys.executable, exe])
        return False

    # ---------- cartes ----------
    def filter(self, child):
        c = getattr(child, "conn", None)
        if c is None:
            return True
        q = self.search.get_text().lower()
        return not q or q in c["name"].lower() or q in c["host"].lower()

    def refresh(self):
        for ch in self.flow.get_children():
            self.flow.remove(ch)
        for c in sorted(self.conns, key=lambda x: x["name"].lower()):
            self.flow.add(self.card(c))
        self.flow.add(self.add_card())
        self.flow.show_all()
        n = len(self.conns)
        self.badge.set_text(str(n))
        self.badge.set_visible(n > 0)

    def card(self, c):
        idx = zlib.crc32(c["id"].encode()) % len(PALETTE)
        child = Gtk.FlowBoxChild()
        child.conn = c
        ev = Gtk.EventBox()
        ev.connect("button-press-event", self.on_card_click, c)
        cardbox = cls(Gtk.Box(orientation=Gtk.Orientation.VERTICAL), "card")
        cardbox.set_size_request(220, -1)

        ov = Gtk.Overlay()
        top = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        top.set_size_request(-1, 104)
        banner = cls(Gtk.Box(), "banner", f"bn-{idx}")
        banner.set_size_request(-1, 74)
        bi = icon("computer-symbolic", 64)
        bi.set_opacity(0.18)
        bi.set_halign(Gtk.Align.END)
        bi.set_margin_end(18)
        banner.pack_end(bi, False, False, 0)
        top.add(banner)
        ov.add(top)
        av = cls(Gtk.Box(), "avatar", f"av-{idx}")
        av.set_halign(Gtk.Align.START); av.set_valign(Gtk.Align.END)
        av.set_margin_start(18)
        ai = icon("computer-symbolic", 26)
        av.pack_start(ai, True, True, 0)
        ov.add_overlay(av)
        name = label(c["name"], "card-name", ellipsize=True)
        name.set_valign(Gtk.Align.END); name.set_halign(Gtk.Align.FILL)
        name.set_margin_start(96); name.set_margin_end(14); name.set_margin_bottom(4)
        ov.add_overlay(name)
        cardbox.add(ov)

        inner = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12,
                        margin_start=18, margin_end=18, margin_top=10, margin_bottom=16)
        user = c.get("user") or "Utilisateur demandé à la connexion"
        inner.add(label(user, "muted", ellipsize=True))
        chips = Gtk.Box(spacing=8)
        chips.pack_start(cls(Gtk.Label(label=c["host"]), "chip"), False, False, 0)
        ts = is_tailscale(c["host"])
        chips.pack_end(cls(Gtk.Label(label="Tailscale" if ts else "Réseau local"),
                           "chip", "chip-ts" if ts else "chip-lan"), False, False, 0)
        inner.add(chips)

        actions = Gtk.Box(spacing=8)
        cb = cls(Gtk.Button(), "btn-primary")
        r = Gtk.Box(spacing=8, halign=Gtk.Align.CENTER)
        r.add(icon("media-playback-start-symbolic"))
        r.add(Gtk.Label(label="Se connecter"))
        cb.add(r)
        cb.connect("clicked", lambda *_: self.connect_to(c))
        actions.pack_start(cb, True, True, 0)
        mb = cls(Gtk.MenuButton(), "btn-ghost")
        mb.add(icon("view-more-symbolic"))
        mb.set_popup(self.card_menu(c))
        actions.pack_end(mb, False, False, 0)
        inner.add(actions)
        cardbox.add(inner)

        ev.add(cardbox)
        child.add(ev)
        return child

    def card_menu(self, c):
        m = Gtk.Menu()
        for lbl, fn in (("Modifier", self.on_edit), ("Dupliquer", self.on_dup),
                        ("Supprimer", self.on_delete)):
            it = Gtk.MenuItem(label=lbl)
            it.connect("activate", lambda _i, fn=fn: fn(c))
            m.append(it)
        m.show_all()
        return m

    def add_card(self):
        child = Gtk.FlowBoxChild()
        child.conn = None
        ev = Gtk.EventBox()
        ev.connect("button-press-event", lambda *_: (self.on_add(), True)[1])
        box = cls(Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10,
                          valign=Gtk.Align.FILL), "add-card")
        box.set_size_request(220, 262)
        inner = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10,
                        valign=Gtk.Align.CENTER, vexpand=True)
        plus = cls(Gtk.Box(halign=Gtk.Align.CENTER), "plus")
        pi = icon("list-add-symbolic", 22)
        plus.pack_start(pi, True, True, 0)
        inner.add(plus)
        inner.add(label("Ajouter un PC", "h2", xalign=0.5))
        inner.add(label("Par IP locale ou Tailscale", "muted", xalign=0.5))
        box.add(inner)
        ev.add(box)
        child.add(ev)
        return child

    def on_card_click(self, _w, ev, c):
        if ev.button == 1 and ev.type == Gdk.EventType._2BUTTON_PRESS:
            self.connect_to(c)
            return True
        if ev.button == 3:
            m = self.card_menu(c)
            m.popup_at_pointer(ev)
            return True
        return False

    # ---------- actions ----------
    def on_quick(self, *_):
        ip = self.quick.get_text().strip()
        if not ip:
            return
        self.quick.set_text("")
        self.on_add(prefill={"name": ip, "host": ip}, connect=True)

    def on_add(self, *_a, prefill=None, connect=False):
        d = EditDialog(self, prefill=prefill)
        new = None
        if d.run() == Gtk.ResponseType.OK:
            vals, pw = d.values()
            if vals["host"]:
                vals["id"] = str(uuid.uuid4())
                self.conns.append(vals)
                pw_set(vals["id"], pw)
                save(self.conns)
                self.refresh()
                new = vals
        d.destroy()
        if new and connect:
            self.connect_to(new)

    def on_edit(self, c):
        d = EditDialog(self, c)
        if d.run() == Gtk.ResponseType.OK:
            vals, pw = d.values()
            c.update(vals)
            pw_set(c["id"], pw)
            save(self.conns)
            self.refresh()
        d.destroy()

    def on_dup(self, c):
        n = dict(c, id=str(uuid.uuid4()), name=c["name"] + " (copie)")
        pw_set(n["id"], pw_get(c["id"]) or "")
        self.conns.append(n)
        save(self.conns)
        self.refresh()

    def on_delete(self, c):
        d = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.QUESTION,
                              buttons=Gtk.ButtonsType.YES_NO, text=f"Supprimer « {c['name']} » ?")
        if d.run() == Gtk.ResponseType.YES:
            pw_set(c["id"], "")
            self.conns.remove(c)
            save(self.conns)
            self.refresh()
        d.destroy()

    def ask_password(self, c):
        d = Gtk.Dialog(title=f"Connexion à {c['name']}", transient_for=self, modal=True)
        d.add_buttons("Annuler", Gtk.ResponseType.CANCEL, "Se connecter", Gtk.ResponseType.OK)
        d.set_default_response(Gtk.ResponseType.OK)
        g = Gtk.Grid(column_spacing=10, row_spacing=8, margin=16)
        u = Gtk.Entry(text=c.get("user", ""), hexpand=True, activates_default=True)
        p = Gtk.Entry(visibility=False, hexpand=True, activates_default=True)
        rem = Gtk.CheckButton(label="Mémoriser", active=bool(Secret), sensitive=bool(Secret))
        g.attach(Gtk.Label(label="Utilisateur", xalign=1), 0, 0, 1, 1); g.attach(u, 1, 0, 1, 1)
        g.attach(Gtk.Label(label="Mot de passe", xalign=1), 0, 1, 1, 1); g.attach(p, 1, 1, 1, 1)
        g.attach(rem, 1, 2, 1, 1)
        d.get_content_area().add(g)
        d.show_all()
        p.grab_focus()
        res = None
        if d.run() == Gtk.ResponseType.OK:
            c["user"] = u.get_text().strip()
            res = p.get_text()
            if rem.get_active():
                pw_set(c["id"], res)
            save(self.conns)
            self.refresh()
        d.destroy()
        return res

    def connect_to(self, c):
        if not self.freerdp:
            return self.error("FreeRDP n'est pas installé.\n\nsudo dnf install freerdp")
        pw = pw_get(c["id"])
        if not pw or not c.get("user"):
            pw = self.ask_password(c)
            if pw is None:
                return
        user, domain = c.get("user", ""), None
        if "\\" in user:
            domain, user = user.split("\\", 1)
        args = [self.freerdp, f"/v:{c['host']}", f"/u:{user}", f"/p:{pw}",
                f"/t:{c['name']}", "/dynamic-resolution", "/gfx", "+auto-reconnect"]
        if domain:
            args.append(f"/d:{domain}")
        args.append("/cert:ignore" if self.v3 else "/cert-ignore")
        args.append("/f" if c.get("fullscreen") else "/size:1600x900")
        if c.get("multimon"):
            args.append("/multimon")
        if c.get("clipboard"):
            args.append("+clipboard")
        if c.get("sound"):
            args.append("/sound")
        if c.get("drive"):
            args.append(f"/drive:Linux,{GLib.get_home_dir()}")
        try:
            proc = subprocess.Popen(args, stderr=subprocess.PIPE, text=True)
        except Exception as e:
            return self.error(str(e))
        GLib.child_watch_add(GLib.PRIORITY_DEFAULT, proc.pid, self.on_exit, (proc, c))

    def on_exit(self, _pid, status, data):
        proc, c = data
        err = proc.stderr.read() if proc.stderr else ""
        code = os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else status
        if code not in (0, 1, 11, 12, 255):
            msg = "Connexion impossible."
            low = err.lower()
            if "logon_failure" in low or "authentication" in low:
                msg = "Identifiant ou mot de passe incorrect."
                pw_set(c["id"], "")
            elif "connect" in low or "unreachable" in low or "timed out" in low:
                msg = (f"Impossible de joindre {c['host']}.\nVérifie l'IP, Tailscale et que le "
                       "Bureau à distance est activé sur le PC.")
            self.error(msg)

    def error(self, txt):
        d = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.ERROR,
                              buttons=Gtk.ButtonsType.OK, text=txt)
        d.run()
        d.destroy()


if __name__ == "__main__":
    w = App()
    w.connect("destroy", Gtk.main_quit)
    w.show_all()
    w.refresh()
    w.go("home")
    if w.settings.get("auto_update", True):
        GLib.timeout_add_seconds(3, lambda: (w.check_update(), False)[1])
    Gtk.main()
