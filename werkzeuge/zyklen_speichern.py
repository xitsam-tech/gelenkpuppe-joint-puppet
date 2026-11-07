"""Feste Bewegungen der Gelenkpuppe ohne Training speichern / save fixed puppet motions without training.

Zyklen (CYCLES, aus Fussbahnen geloest) und Moves (MOVES, aus Schluesselhaltungen) aus training.js werden gebacken und als
<posen>/training3_<name>.json gespeichert (Ordner des laufenden puppe_server.py). Gibt je Zyklus die Fusshoehen aus
(Standfuss nahe 0, nie unter 0) und je Move tiefsten Punkt, Becken- und Fusshoehe.

Aufruf / usage:
    python werkzeuge/zyklen_speichern.py [--port 8765] [--detail] <name> [<name> ...]
Beispiel: python werkzeuge/zyklen_speichern.py --port 8766 bb_sprungwurf bb_brustpass seitwaerts_laufen
"""
import argparse
import asyncio
import json

from cdp import Puppe, server_url

JS = """(async()=>{for(let i=0;i<160&&!window.__trainingSave;i++)await new Promise(r=>setTimeout(r,250));
const M=window.__moves||{},names=%s,mv=names.filter(n=>M[n]),rest=names.filter(n=>!M[n]);
if(rest.length)await window.__trainingSave(true,rest);
const out={};for(const n of rest)out[n]=window.__cycleReport[n];
if(mv.length){const r=await window.__movesSave(mv);for(const n of mv)out[n]={move:r[n]};}
return JSON.stringify(out);})()"""


async def run(port, names):
    # langes Training angeben: so speichert die Seite nichts Gelerntes von selbst (erst nach 60 s)
    async with Puppe(server_url(port, 'training=3&minuten=600'), debug_port=9352) as p:
        return json.loads(await p.js(JS % json.dumps(names)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--detail', action='store_true', help='jedes Bild ausgeben / print every frame')
    ap.add_argument('names', nargs='+')
    a = ap.parse_args()
    rep = asyncio.run(run(a.port, a.names))
    for n, rows in rep.items():
        if isinstance(rows, dict) and 'move' in rows:
            mv = rows['move']
            low_air = min((r['tiefster'] for r in mv if not r['boden']), default=None)
            low_all = min(r['tiefster'] for r in mv)
            print(f"{n}: Move gespeichert, {len(mv)} Bilder, tiefster Punkt {low_all:.3f} m (im Flug {low_air}), "
                  f"Becken {min(r['becken'] for r in mv):.2f}..{max(r['becken'] for r in mv):.2f} m, rechter Fuss max {max(r['fussRhoehe'] for r in mv):.2f} m")
            if a.detail:
                for r in mv:
                    print('   ', r)
            continue
        if not rows:
            print(f"{n}: gespeichert (Gangart, kein Fussbericht)")
            continue
        stand = [r['fussL'] for r in rows if r['standL']] + [r['fussR'] for r in rows if r['standR']]
        low = min(min(r['fussL'], r['fussR']) for r in rows)
        if a.detail:
            for r in rows:
                if (r['standL'] and r['fussL'] > .02) or (r['standR'] and r['fussR'] > .02) or min(r['fussL'], r['fussR']) < -.016:
                    print('   ', r)
        print(f"{n}: Standfuss {min(stand):.3f}..{max(stand):.3f} m, tiefster Punkt {low:.3f} m")


if __name__ == '__main__':
    main()
