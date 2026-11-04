"""Assemble the supplied MX5 frame/wheel and parts STL kits.

Run python3 configurator/tools/build_mx5.py to regenerate. The swingarm is
separate on the print bed; pivot, fork extension and accessory placements are
estimated from mesh mounts, not factory CAD. Original STLs are preserved.
The fused print-pin/support cluster is omitted. No headlight or front fender
mesh was supplied; the reference photo is not a texture for this STL kit.
Assembly axes: front -X, lateral Y, up Z.
"""
from pathlib import Path

import numpy as np
import trimesh

from build_ss3 import op_matrix

MODELS = Path(__file__).resolve().parents[1] / "models"
SOURCE = MODELS / "mx5-source"
OUTPUT = MODELS / "talaria-mx5.glb"
RAKE = op_matrix([["ry", 25]])
FRONT = np.array([38, 0, 58]) - RAKE[:3, :3] @ np.array([6, 0, 64])


def components(filename):
    mesh = trimesh.load(SOURCE / filename, force="mesh", process=True)
    labels = trimesh.graph.connected_component_labels(
        mesh.face_adjacency, node_count=len(mesh.faces)
    )
    counts = np.bincount(labels)
    return [
        mesh.submesh([np.flatnonzero(labels == i)], append=True, repair=False)
        for i in np.argsort(counts)[::-1] if counts[i] > 100
    ]


def centered(mesh):
    mesh = mesh.copy()
    mesh.apply_translation(-mesh.bounds.mean(axis=0))
    return mesh


def paired_wheel(halves):
    parts = []
    for index, mesh in enumerate(halves):
        mesh = mesh.copy()
        mid = mesh.bounds.mean(axis=0)
        mesh.apply_translation([-mid[0], -mid[1], -mesh.bounds[0, 2]])
        mating = np.all(abs(mesh.triangles[:, :, 2]) < 1e-5, axis=1)
        mesh.update_faces(~mating)
        if index:
            mesh.apply_transform(np.diag([1, 1, -1, 1]))
        parts.append(mesh)
    wheel = trimesh.util.concatenate(parts)
    wheel.merge_vertices()
    wheel.remove_unreferenced_vertices()
    return wheel


def main():
    parts = []

    def add(name, mesh, ops):
        mesh = mesh.copy()
        mesh.apply_transform(op_matrix(ops))
        parts.append((name, mesh))

    def fork(ops):
        return ops + [["ry", 25], ["t", *FRONT]]

    frame, swingarm = components("obj_1_frame mx5.stl")
    add("frame", frame, [["t", 0, -147.47, 0]])
    swing_pose = op_matrix([
        ["t", -94, -158.85, -5.84], ["ry", 12], ["t", 83, 0, 13],
    ])
    swingarm.apply_transform(swing_pose)
    add("swingarm", swingarm, [])
    rear_source = np.array([140.5, 158.85, 3.8, 1])
    rear = (swing_pose @ rear_source)[:3]

    forks = components("obj_9_forks (2).stl")
    for index, lateral in enumerate([-10, 10]):
        lower = forks[index]
        base = lower.bounds[0]
        add(f"fork_lower_{index}", lower, fork([
            ["t", -(base[0] + 3.5), -lower.bounds.mean(axis=0)[1] + lateral, -3.5],
        ]))
        sleeve = centered(forks[index + 2])
        add(f"fork_upper_{index}", sleeve, fork([["t", 6, lateral, 38.5]]))

    tree = centered(components("obj_1_idk the name (1).stl")[0])
    add("steerer", tree, fork([["rz", 90], ["t", 6, 0, 60]]))
    stem = centered(components("obj_3_idk the name.stl")[0])
    add("stem", stem, fork([["rz", 90], ["t", 6, 0, 75.0]]))
    bars = centered(components("obj_8_handlebar.stl")[0])
    add("handlebar", bars, fork([["rz", 90], ["t", 3, 0, 79.5]]))
    grips = components("obj_5_pins and grips.stl")
    for name, mesh, lateral in [
        ("grip_left", grips[1], -32), ("throttle", grips[2], 32),
    ]:
        add(name, centered(mesh), fork([["rx", 90], ["t", 3, lateral, 79.5]]))
    brake = components("obj_7_brake left side.stl")[0]
    brake.apply_translation(-brake.bounds[0] - np.array([9.59, 9.43, 4]))
    for name, lateral, reflection in [
        ("brake_left", -23, [["s", -1, 1, 1]]), ("brake_right", 23, []),
    ]:
        add(name, brake, fork(reflection + [["rz", 90], ["t", 3, lateral, 79.5]]))
    guards = components("obj_2_fork guards.stl")
    for index, lateral in enumerate([-10, 10]):
        add(f"fork_guard_{index}", centered(guards[index]),
            fork([["t", 1, lateral, 16]]))

    wheels = components("obj_2_wheels (1).stl")
    small = sorted(wheels, key=lambda m: m.extents[0])[:2]
    large = sorted(wheels, key=lambda m: m.extents[0])[2:]
    front_wheel, rear_wheel = paired_wheel(large), paired_wheel(small)
    radii = [front_wheel.extents[1] / 2, rear_wheel.extents[1] / 2]
    for name, mesh, axle in [
        ("wheel_front", front_wheel, FRONT), ("wheel_rear", rear_wheel, rear),
    ]:
        add(name, mesh, [["rx", 90], ["t", *axle]])
    for side, mesh, axle in zip(
        ["front", "rear"], components("obj_6_rotors (2).stl"), [FRONT, rear]
    ):
        add(f"{side}_rotor", centered(mesh),
            [["rx", 90], ["t", axle[0], 7.5, axle[2]]])
    sprocket = centered(components("obj_4_sprocket.stl")[0])
    add("rear_sprocket", sprocket,
        [["rx", 90], ["t", rear[0], -7, rear[2]]])

    delta = FRONT - rear
    angle = np.arcsin((radii[0] - radii[1]) / np.hypot(delta[0], delta[2]))
    angle -= np.arctan2(delta[2], -delta[0])
    leveling = op_matrix([["ry", np.rad2deg(angle)]])
    axles = np.array([FRONT, rear]) @ leveling[:3, :3].T
    scale = 1.25 / (axles[1, 0] - axles[0, 0])
    origin = np.array([axles[:, 0].mean(), 0, axles[1, 2] - radii[1]])
    scene = trimesh.Scene()
    for name, mesh in parts:
        mesh.apply_transform(leveling)
        v = mesh.vertices - origin
        mesh.vertices = (np.column_stack((-v[:, 0], v[:, 2], v[:, 1])) * scale).astype(np.float32)
        mesh.update_faces(mesh.nondegenerate_faces(height=1e-9))
        mesh.remove_unreferenced_vertices()
        if not np.isfinite(mesh.vertices).all() or not len(mesh.faces):
            raise ValueError(f"Invalid geometry: {name}")
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    for name in ["wheel_front", "wheel_rear"]:
        if abs(scene.geometry[name].bounds[0, 1]) > 0.001:
            raise ValueError(f"Wheel is not grounded: {name}")
    scene.export(OUTPUT)
    print(f"Wrote {OUTPUT}: {len(parts)} meshes, "
          f"{sum(len(m.faces) for _, m in parts):,} triangles; "
          f"{OUTPUT.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
