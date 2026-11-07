"""Kontaktbogen einer Bewegung: ausgewaehlte Bilder von vorn und von der Seite / contact sheet of a motion (front and side).

Zum Pruefen jeder neuen oder geaenderten Bewegung (Fehler nach hinten sieht man nur seitlich).
Aufruf / usage:
    python werkzeuge/kontaktbogen.py [--port 8765] [--bilder 8] [--ansichten front,right] [--puppe] --ziel ORDNER <posen-name> [...]
--puppe: Gelenkpuppe statt eigener Figur zeigen / show the puppet instead of the player model.
Schreibt / writes ORDNER/<posen-name>.png (Zeilen = Ansichten, Spalten = Bilder, mit Zeit in s).
Braucht / needs Pillow.
"""
import argparse
import asyncio
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw

from cdp import Puppe, server_url

SET = """(async()=>{const p=window.puppe;
if(!window.__kb||window.__kb.name!==%(n)s)window.__kb=Object.assign(await (await fetch('/api/posen/'+encodeURIComponent(%(n)s))).json(),{name:%(n)s});
const d=window.__kb,key=d.keys[Math.min(%(i)d,d.keys.length-1)],j=p.pose.j;p.opts.ground=false;
const box=document.getElementById('optPlayer');if(box&&!box.disabled&&box.checked===%(puppe)s){box.checked=!%(puppe)s;if(box.onchange)box.onchange();}
for(const id in j)for(const k in j[id])j[id][k]=key.winkel[id]&&key.winkel[id][k]!==undefined?key.winkel[id][k]:0;
p.applyPose();p.setView(%(v)s);
await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const c=document.querySelector('canvas').getBoundingClientRect();
return JSON.stringify({n:d.keys.length,fps:d.fps||30,x:c.x,y:c.y,w:c.width,h:c.height});})()"""


async def run(port, names, count, views, puppe):
    sheets = {}
    async with Puppe(server_url(port), debug_port=9353, size=(1400, 900)) as p:
        for n in names:
            args = {'n': json.dumps(n), 'i': 0, 'v': json.dumps(views[0]), 'puppe': json.dumps(puppe)}
            info = json.loads(await p.js(SET % args))
            idx = sorted({round(k * (info['n'] - 1) / max(1, count - 1)) for k in range(count)})
            rows = []
            for v in views:
                row = []
                for i in idx:
                    info = json.loads(await p.js(SET % dict(args, i=i, v=json.dumps(v))))
                    side = min(info['w'], info['h'])
                    clip = {'x': info['x'] + (info['w'] - side * 0.62) / 2, 'y': info['y'] + side * 0.02, 'width': side * 0.62, 'height': side * 0.96}
                    row.append((i / info['fps'], Image.open(io.BytesIO(await p.screenshot(clip)))))
                rows.append(row)
            sheets[n] = rows
    return sheets


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--bilder', type=int, default=8)
    ap.add_argument('--ansichten', default='front,right')
    ap.add_argument('--puppe', action='store_true')
    ap.add_argument('--ziel', required=True)
    ap.add_argument('names', nargs='+')
    a = ap.parse_args()
    sheets = asyncio.run(run(a.port, a.names, a.bilder, a.ansichten.split(','), a.puppe))
    ziel = Path(a.ziel)
    ziel.mkdir(parents=True, exist_ok=True)
    for n, rows in sheets.items():
        w, h = rows[0][0][1].size
        ch = 300
        cw = int(w * ch / h)
        img = Image.new('RGB', (cw * len(rows[0]), (ch + 18) * len(rows)), 'white')
        d = ImageDraw.Draw(img)
        for r, row in enumerate(rows):
            for c, (t, im) in enumerate(row):
                img.paste(im.convert('RGB').resize((cw, ch)), (c * cw, r * (ch + 18) + 18))
                d.text((c * cw + 4, r * (ch + 18) + 3), f'{t:.2f} s', fill='black')
        img.save(ziel / f'{n}.png')
        print(ziel / f'{n}.png')


if __name__ == '__main__':
    main()
