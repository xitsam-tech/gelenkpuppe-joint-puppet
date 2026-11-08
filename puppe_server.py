"""Kleiner lokaler Server fuer die Gelenkpuppe.

Liefert puppe.html aus und speichert/liest Posen als JSON im Ordner posen/ neben diesem Skript (oder --posen ORDNER).
Nur an 127.0.0.1 gebunden (nicht im Netz erreichbar). Nur Python-Standardbibliothek.

Eigene Figur: player.glb/player_rest.json neben diesem Skript oder aus --modell ORDNER (z. B. je Spielprojekt eine Figur).

Start:  python puppe_server.py [--port 8765] [--posen ORDNER] [--modell ORDNER] [--no-browser]
"""
import argparse
import http.server
import json
import os
import re
import shutil
import socket
import time
import urllib.parse
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
POSEN = os.path.join(HERE, "posen")   # mit --posen aenderbar
MODELL = HERE                         # Ordner mit player.glb / player_rest.json, mit --modell aenderbar
MODELL_FILES = ("/player.glb", "/player_rest.json", "/finger_limits.json")
NAME_RE = re.compile(r"^[\w\-äöüÄÖÜß ]{1,80}$")


def pose_path(name):
    if not NAME_RE.match(name):
        raise ValueError("ungueltiger Name")
    p = os.path.abspath(os.path.join(POSEN, name + ".json"))
    if os.path.dirname(p) != POSEN:
        raise ValueError("ungueltiger Pfad")
    return p


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # Browser soll immer die aktuelle Fassung der Puppe laden
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/api/" in (self.path or ""):
            super().log_message(fmt, *args)

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, text):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _name(self):
        rest = urllib.parse.unquote(self.path.split("?")[0][len("/api/posen"):]).strip("/")
        return rest

    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/index.html"):
            self.path = "/puppe.html" + ("?" + self.path.split("?", 1)[1] if "?" in self.path else "")
        if self.path.split("?")[0] in MODELL_FILES and MODELL != HERE:
            p = os.path.join(MODELL, self.path.split("?")[0].lstrip("/"))
            if not os.path.exists(p):
                return self._err(404, "nicht gefunden")
            with open(p, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "model/gltf-binary" if p.endswith(".glb") else "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not self.path.startswith("/api/posen"):
            return super().do_GET()
        name = self._name()
        os.makedirs(POSEN, exist_ok=True)
        if not name:
            out = []
            for fn in sorted(os.listdir(POSEN)):
                if not fn.endswith(".json"):
                    continue
                p = os.path.join(POSEN, fn)
                try:
                    with open(p, encoding="utf-8") as f:
                        d = json.load(f)
                    out.append({"name": fn[:-5], "beschreibung": d.get("beschreibung", ""),
                                "keys": len(d.get("keys", [])), "geaendert": os.path.getmtime(p)})
                except (OSError, ValueError):
                    out.append({"name": fn[:-5], "beschreibung": "(nicht lesbar)", "keys": 0, "geaendert": os.path.getmtime(p)})
            out.sort(key=lambda x: -x["geaendert"])
            return self._json(200, out)
        try:
            p = pose_path(name)
        except ValueError as e:
            return self._err(400, str(e))
        if not os.path.exists(p):
            return self._err(404, "nicht gefunden")
        with open(p, encoding="utf-8") as f:
            return self._json(200, json.load(f))

    def do_POST(self):
        if not self.path.startswith("/api/posen/"):
            return self._err(404, "unbekannt")
        try:
            p = pose_path(self._name())
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > 50_000_000:
                raise ValueError("leer oder zu gross")
            data = json.loads(self.rfile.read(n).decode("utf-8"))
            if data.get("format") != "gelenkpuppe":
                raise ValueError("keine Gelenkpuppen-Datei")
        except ValueError as e:
            return self._err(400, str(e))
        os.makedirs(POSEN, exist_ok=True)
        if os.path.exists(p):   # alte Fassung sichern statt still ueberschreiben
            alt = os.path.join(POSEN, ".alt")
            os.makedirs(alt, exist_ok=True)
            stem = os.path.basename(p)[:-5]
            shutil.copy2(p, os.path.join(alt, f"{stem}_{time.strftime('%Y%m%d-%H%M%S')}.json"))
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, p)
        return self._json(200, {"ok": True, "pfad": p})


def port_busy(port):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--posen", help="Ordner fuer die Posen-Dateien (Standard: posen/ neben diesem Skript)")
    ap.add_argument("--modell", help="Ordner mit player.glb und player_rest.json (Standard: neben diesem Skript)")
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    global POSEN
    if a.posen:
        POSEN = os.path.abspath(a.posen)
    global MODELL
    if a.modell:
        MODELL = os.path.abspath(a.modell)
    url = f"http://127.0.0.1:{a.port}/"
    if port_busy(a.port):
        print(f"Laeuft schon: {url}")
        if not a.no_browser:
            webbrowser.open(url)
        return
    os.makedirs(POSEN, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"Gelenkpuppe: {url}\nPosen-Ordner: {POSEN}\nBeenden mit Strg+C")
    if not a.no_browser:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
