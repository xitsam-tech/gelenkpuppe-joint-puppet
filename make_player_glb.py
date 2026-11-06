"""Eigenes Modell fuer die Gelenkpuppe vorbereiten / Prepare your own model for the joint puppet.

Liest ein geriggtes Modell (FBX, GLB/GLTF), entfernt Animationen und Shape-Key-Werte, verkleinert grosse Texturen und schreibt
player.glb plus player_rest.json (Gelenkpositionen der Ruhepose, Bodenhoehe) neben puppe.html.
Reads a rigged model (FBX, GLB/GLTF), strips animations and shape-key values, shrinks large textures and writes player.glb plus
player_rest.json (rest-pose joint positions, floor height) next to puppe.html.

Aufruf / usage:
    blender -b -P make_player_glb.py -- <modell.fbx|.glb> [Mesh-Namen ...]
Ohne Mesh-Namen werden alle Meshes behalten / without mesh names all meshes are kept.

Voraussetzungen / requirements: Blender 3.6+ (getestet mit 5.2), Skelett mit Mixamo-Knochennamen (siehe README),
Figur aufrecht, Blick nach -Y, +Z oben, Meter.
"""
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if not argv:
    sys.exit('Aufruf: blender -b -P make_player_glb.py -- <modell.fbx|.glb> [Mesh-Namen ...]')
SRC, KEEP = os.path.abspath(argv[0]), tuple(argv[1:])
NEEDED = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'] + [s + n for s in ('Left', 'Right') for n in
          ('Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot')]

bpy.ops.wm.read_factory_settings(use_empty=True)
if SRC.lower().endswith('.fbx'):
    bpy.ops.import_scene.fbx(filepath=SRC)
else:
    bpy.ops.import_scene.gltf(filepath=SRC)
print('[glb] Objekte:', [o.name for o in bpy.context.scene.objects][:40])
arm = next((o for o in bpy.context.scene.objects if o.type == 'ARMATURE'), None)
if arm is None:
    sys.exit('[glb] Kein Skelett (Armature) im Modell / no armature found')
missing = [n for n in NEEDED if n not in arm.data.bones]
if missing:
    print('[glb] WARNUNG / WARNING: Knochen fehlen / missing bones:', missing)
if arm.animation_data:
    arm.animation_data.action = None
    for t in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(t)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if KEEP:
    for o in meshes:
        if o.name.split('.')[0] not in KEEP:
            bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in meshes:
    if o.data.shape_keys:
        o.shape_key_clear()
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024)
bpy.context.view_layer.update()
rest = {}
wm = arm.matrix_world
for b in arm.data.bones:
    h = wm @ b.head_local
    t = wm @ b.tail_local
    rest[b.name] = {'head': [round(h.x, 4), round(h.y, 4), round(h.z, 4)], 'tail': [round(t.x, 4), round(t.y, 4), round(t.z, 4)]}
rest['_boden'] = round(min((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices), 4)
print('[glb] Boden / floor', rest['_boden'])
with open(os.path.join(HERE, 'player_rest.json'), 'w') as f:
    json.dump(rest, f, indent=0)
bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, 'player.glb'), export_format='GLB', export_animations=False,
                          export_skins=True, export_morph=False, export_yup=True, export_image_format='JPEG', export_jpeg_quality=80)
print('[glb] fertig / done', len(rest) - 1, 'Knochen / bones', [o.name for o in meshes])
