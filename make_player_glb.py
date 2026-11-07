"""Eigenes Modell fuer die Gelenkpuppe vorbereiten / Prepare your own model for the joint puppet.

Liest ein geriggtes Modell (FBX, GLB/GLTF), entfernt Animationen und Shape-Key-Werte, verkleinert grosse Texturen und schreibt
player.glb plus player_rest.json (Gelenkpositionen der Ruhepose, Bodenhoehe) neben puppe.html.
Reads a rigged model (FBX, GLB/GLTF), strips animations and shape-key values, shrinks large textures and writes player.glb plus
player_rest.json (rest-pose joint positions, floor height) next to puppe.html.

Aufruf / usage:
    blender -b -P make_player_glb.py -- <modell.fbx|.glb> [Mesh-Namen ...] [--namen ue5] [--ziel ORDNER]
Ohne Mesh-Namen werden alle Meshes behalten / without mesh names all meshes are kept.
--namen ue5: Skelett von Unreal Engine 5 (Manny/Quinn, MetaHuman-Koerper) wird auf Mixamo-Namen umbenannt
             (pelvis -> Hips, upperarm_l -> LeftArm ...). Knochen ohne Gegenstueck (spine_02, Drehknochen) behalten ihren Namen.
             UE5 skeleton (Manny/Quinn, MetaHuman body) is renamed to Mixamo names; bones without a match keep their names.
--ziel ORDNER: player.glb und player_rest.json dorthin statt neben puppe.html (fuer puppe_server.py --modell ORDNER).
               write player.glb and player_rest.json there instead of next to puppe.html.

Voraussetzungen / requirements: Blender 3.6+ (getestet mit 5.2), Skelett mit Mixamo-Knochennamen (siehe README) oder --namen ue5,
Figur aufrecht, Blick nach -Y, +Z oben, Meter. Ein UE-FBX (Zentimeter) wird beim Import automatisch auf Meter gebracht.
"""
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OPT = {}
for flag in ('--namen', '--ziel'):
    if flag in argv:
        i = argv.index(flag)
        OPT[flag] = argv[i + 1]
        del argv[i:i + 2]
if not argv:
    sys.exit('Aufruf: blender -b -P make_player_glb.py -- <modell.fbx|.glb> [Mesh-Namen ...] [--namen ue5] [--ziel ORDNER]')
SRC, KEEP = os.path.abspath(argv[0]), tuple(argv[1:])
OUT = os.path.abspath(OPT.get('--ziel', HERE))
os.makedirs(OUT, exist_ok=True)
# Unreal Engine 5 (Manny/Quinn, MetaHuman-Koerper) -> Mixamo. Wirbelsaeule: UE hat 5 Wirbel, die Puppe 3 (Spine, Spine1, Spine2);
# spine_02 und spine_04 gehen starr mit. Hals: neck_02 geht mit neck_01. Mittelhandknochen und Drehknochen bleiben unberuehrt.
UE5 = {'pelvis': 'Hips', 'spine_01': 'Spine', 'spine_03': 'Spine1', 'spine_05': 'Spine2', 'neck_01': 'Neck', 'head': 'Head'}
for s_ue, s_mx in (('l', 'Left'), ('r', 'Right')):
    UE5.update({f'clavicle_{s_ue}': s_mx + 'Shoulder', f'upperarm_{s_ue}': s_mx + 'Arm', f'lowerarm_{s_ue}': s_mx + 'ForeArm',
                f'hand_{s_ue}': s_mx + 'Hand', f'thigh_{s_ue}': s_mx + 'UpLeg', f'calf_{s_ue}': s_mx + 'Leg', f'foot_{s_ue}': s_mx + 'Foot',
                f'ball_{s_ue}': s_mx + 'ToeBase'})
    for f_ue, f_mx in (('thumb', 'Thumb'), ('index', 'Index'), ('middle', 'Middle'), ('ring', 'Ring'), ('pinky', 'Pinky')):
        for k in (1, 2, 3):
            UE5[f'{f_ue}_0{k}_{s_ue}'] = f'{s_mx}{f_mx}{k}'
NAMES = {'ue5': UE5}
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
if '--namen' in OPT:
    table = NAMES.get(OPT['--namen'])
    if table is None:
        sys.exit('[glb] Unbekannte Namensliste / unknown naming: ' + OPT['--namen'])
    renamed = 0
    for b in arm.data.bones:
        if b.name in table:
            b.name = table[b.name]
            renamed += 1
    print(f'[glb] {renamed} Knochen umbenannt / bones renamed ({OPT["--namen"]})')
# Zentimeter-Modelle (z. B. FBX aus Unreal) auf Meter bringen: Figur muss etwa 1,5-2,2 m hoch sein
bpy.context.view_layer.update()
zs = [(arm.matrix_world @ b.head_local).z for b in arm.data.bones]
if max(zs) - min(zs) > 20:
    for o in [o for o in bpy.context.scene.objects if o.parent is None]:
        o.scale *= 0.01
        o.location *= 0.01
    bpy.context.view_layer.update()
    for o in [o for o in bpy.context.scene.objects if o.parent is None]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    print('[glb] Zentimeter -> Meter / centimeters -> meters')
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
with open(os.path.join(OUT, 'player_rest.json'), 'w') as f:
    json.dump(rest, f, indent=0)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'player.glb'), export_format='GLB', export_animations=False,
                          export_skins=True, export_morph=False, export_yup=True, export_image_format='JPEG', export_jpeg_quality=80)
print('[glb] fertig / done', len(rest) - 1, 'Knochen / bones', [o.name for o in meshes])
