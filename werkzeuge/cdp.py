"""Gelenkpuppe in einem unsichtbaren Chrome steuern (Chrome DevTools Protocol).
Control the joint puppet in a headless Chrome.

Gemeinsamer Baustein fuer zyklen_speichern.py, bewegung_export.py und kontaktbogen.py.
Voraussetzung / requirement: Chrome oder Edge, Python-Paket `websockets`, laufender puppe_server.py.
Chrome-Pfad notfalls ueber die Umgebungsvariable PUPPE_CHROME / set PUPPE_CHROME for a custom browser path.
"""
import asyncio
import base64
import json
import os
import shutil
import subprocess
import tempfile
import urllib.request

import websockets

CANDIDATES = [os.environ.get('PUPPE_CHROME', ''),
              r'C:\Program Files\Google\Chrome\Application\chrome.exe',
              r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
              shutil.which('google-chrome') or '', shutil.which('chromium') or '', shutil.which('chrome') or '']


def chrome_path():
    for c in CANDIDATES:
        if c and os.path.exists(c):
            return c
    raise SystemExit('Kein Chrome/Edge gefunden / no Chrome or Edge found (PUPPE_CHROME setzen / set PUPPE_CHROME)')


class Puppe:
    """async with Puppe(url) as p: await p.js('...')"""

    def __init__(self, url, debug_port=9350, size=(1200, 800)):
        self.url, self.debug_port, self.size = url, debug_port, size
        self.i = 0

    async def __aenter__(self):
        self.prof = tempfile.mkdtemp(prefix='gelenkpuppe_')
        self.proc = subprocess.Popen([chrome_path(), '--headless=new', f'--remote-debugging-port={self.debug_port}', f'--user-data-dir={self.prof}',
                                      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', f'--window-size={self.size[0]},{self.size[1]}', 'about:blank'],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        tabs = None
        for _ in range(60):
            try:
                tabs = json.load(urllib.request.urlopen(f'http://127.0.0.1:{self.debug_port}/json'))
                break
            except Exception:
                await asyncio.sleep(0.5)
        if tabs is None:
            raise RuntimeError('Chrome antwortet nicht / Chrome not responding')
        tab = [t for t in tabs if t['type'] == 'page'][0]
        self.ws = await websockets.connect(tab['webSocketDebuggerUrl'], max_size=None)
        await self.send('Page.enable')
        await self.send('Runtime.enable')
        await self.send('Page.navigate', url=self.url)
        # warten, bis die Puppe (und ein eigenes Modell, falls vorhanden) geladen ist / wait for puppet and player model
        await self.js('(async()=>{for(let i=0;i<160&&!window.puppe;i++)await new Promise(r=>setTimeout(r,250));'
                      'for(let i=0;i<40&&!window.puppe.player.bones;i++)await new Promise(r=>setTimeout(r,250));return 1;})()')
        return self

    async def __aexit__(self, *exc):
        try:
            await self.ws.close()
        finally:
            self.proc.terminate()
            await asyncio.sleep(0.5)
            shutil.rmtree(self.prof, ignore_errors=True)

    async def send(self, method, **params):
        self.i += 1
        me = self.i
        await self.ws.send(json.dumps({'id': me, 'method': method, 'params': params}))
        while True:
            r = json.loads(await self.ws.recv())
            if r.get('id') == me:
                if 'error' in r:
                    raise RuntimeError(f'{method}: {r["error"]}')
                return r.get('result', r)

    async def js(self, expression):
        """JavaScript ausfuehren (darf ein Promise liefern), Ergebnis als Python-Wert / evaluate JS, return value."""
        r = await self.send('Runtime.evaluate', expression=expression, awaitPromise=True, returnByValue=True)
        if 'exceptionDetails' in r:
            raise RuntimeError(json.dumps(r['exceptionDetails'])[:1200])
        return r['result'].get('value')

    async def screenshot(self, clip=None):
        """PNG-Bytes der Seite oder eines Ausschnitts {x, y, width, height} / PNG bytes of page or clip."""
        params = {'format': 'png'}
        if clip:
            params['clip'] = dict(clip, scale=1)
        r = await self.send('Page.captureScreenshot', **params)
        return base64.b64decode(r['data'])


def server_url(port, query=''):
    return f'http://127.0.0.1:{port}/' + (('?' + query) if query else '')
