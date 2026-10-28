"""Split the fused Light Bee X STL into frame / front wheel / rear wheel and write a GLB.

Source axes: Y = length (front at low Y), Z = up, X = across the bike.
Output axes: +X forward, +Y up, +Z across, metres, ground at Y=0, origin midway between axles.
"""
import sys
import numpy as np
import trimesh

import json
SRC, OUT = sys.argv[1], sys.argv[2]
DEBUG = 'debug' in sys.argv[3:]
# optional JSON override: {"wheelbase_m":..,"front":[y,z],"rear":[y,z],"x_center":..,"half_width":..,"r_out":..}
CFG = next((json.loads(a) for a in sys.argv[3:] if a.startswith('{')), {})

WHEELBASE_M = CFG.get('wheelbase_m', 1.19)  # published wheelbase; sets the scale
AXLES = {'front': tuple(CFG.get('front', (94.5, 17.5))), 'rear': tuple(CFG.get('rear', (161.5, 17.5)))}  # (y, z) in source units
X_CENTER, HALF_WIDTH, R_OUT = CFG.get('x_center', 128.1), CFG.get('half_width', 5.8), CFG.get('r_out', 18.0)

m = trimesh.load(SRC, process=False)
c = m.triangles_center
labels = np.zeros(len(c), dtype=int)  # 0 frame, 1 front wheel, 2 rear wheel
for i, (cy, cz) in enumerate(AXLES.values(), start=1):
    near = np.hypot(c[:, 1] - cy, c[:, 2] - cz) <= R_OUT
    labels[near & (np.abs(c[:, 0] - X_CENTER) <= HALF_WIDTH)] = i

s = WHEELBASE_M / (AXLES['rear'][0] - AXLES['front'][0])
y_mid = (AXLES['front'][0] + AXLES['rear'][0]) / 2

def to_bike(v):
    return np.column_stack([-(v[:, 1] - y_mid), v[:, 2], -(v[:, 0] - X_CENTER)]) * s

scene = trimesh.Scene()
colors = {0: [170, 170, 170, 255], 1: [230, 60, 60, 255], 2: [60, 120, 230, 255]}
names = {0: 'frame', 1: 'wheel_front', 2: 'wheel_rear'}
for k in (0, 1, 2):
    sub = m.submesh([np.where(labels == k)[0]], append=True)
    v = to_bike(sub.vertices)
    pose = np.eye(4)
    if k:
        ay, az = list(AXLES.values())[k - 1]
        axle = np.array([-(ay - y_mid), az, 0]) * np.array([s, s, 1])
        v = v - axle  # wheels are centred on their own axle
        pose[:3, 3] = axle
    mesh = trimesh.Trimesh(v, sub.faces, process=False)
    mesh.merge_vertices()
    if DEBUG:
        mesh.visual.face_colors = colors[k]
    scene.add_geometry(mesh, node_name=names[k], geom_name=names[k], transform=pose)
    print(names[k], len(sub.faces), 'faces')
scene.export(OUT)
