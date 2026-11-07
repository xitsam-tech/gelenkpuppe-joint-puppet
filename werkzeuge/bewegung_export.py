"""Bewegungen der Gelenkpuppe fuer eine Spiel-Engine exportieren / export puppet motions for a game engine.

Stellt jeden Key einer gespeicherten Bewegung an der eigenen Figur (player.glb) ein und liest je Knochen die Weltdrehung
gegenueber der Bindepose (q = Welt x Bindung^-1) sowie die Beckenposition. Engine-neutral, in den Achsen der Puppe
(three.js: +x links der Figur, +y oben, +z vorn; Meter; Quaternion [x, y, z, w]). Die Umrechnung in die Achsen der Engine
und auf deren Bindepose macht das Importskript des Spiels, siehe README (Unity: (x, -y, -z, w); Unreal: Achsen y und z tauschen).

Aufruf / usage:
    python werkzeuge/bewegung_export.py [--port 8765] --ziel ORDNER <posen-name> [<posen-name> ...]
Schreibt / writes ORDNER/<posen-name>.json: {name, fps, laenge_bilder, bones, frames: [{f, q: [x, y, z, w je Knochen], hips: [x, y, z]}]}
"""
import argparse
import asyncio
import json
from pathlib import Path

from cdp import Puppe, server_url

JS = """(async()=>{const p=window.puppe;
if(!p.player.bones)throw new Error('Kein eigenes Modell geladen (player.glb) / no player model loaded');
p.opts.ground=false;
const d=await (await fetch('/api/posen/'+encodeURIComponent(%s))).json();
const frames=[];
for(const key of d.keys){
  const j=p.pose.j;
  for(const id in j)for(const k in j[id])j[id][k]=key.winkel[id]&&key.winkel[id][k]!==undefined?key.winkel[id][k]:0;
  p.applyPose();p.player.root.updateMatrixWorld(true);
  const q=[];
  for(const n of p.player.order){const b=p.player.bones[n];const w=b.getWorldQuaternion(p.player.bind[n].clone()).multiply(p.player.bind[n].clone().invert());
    q.push(+w.x.toFixed(5),+w.y.toFixed(5),+w.z.toFixed(5),+w.w.toFixed(5));}
  frames.push({f:key.frame,q,hips:p.wpos('Hips').toArray().map(v=>+v.toFixed(4))});
}
return JSON.stringify({name:d.name,fps:d.fps||30,laenge_bilder:d.laenge_bilder,bones:p.player.order,frames});})()"""


async def run(port, names):
    out = {}
    async with Puppe(server_url(port), debug_port=9351) as p:
        for n in names:
            out[n] = json.loads(await p.js(JS % json.dumps(n)))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--ziel', required=True, help='Ausgabeordner / output folder')
    ap.add_argument('names', nargs='+')
    a = ap.parse_args()
    res = asyncio.run(run(a.port, a.names))
    ziel = Path(a.ziel)
    ziel.mkdir(parents=True, exist_ok=True)
    for n, d in res.items():
        (ziel / f'{n}.json').write_text(json.dumps(d), encoding='utf-8')
        ys = [f['hips'][1] for f in d['frames']]
        print(f'{n}: {len(d["frames"])} Bilder, {len(d["bones"])} Knochen, Becken {min(ys):.2f}..{max(ys):.2f} m')


if __name__ == '__main__':
    main()
