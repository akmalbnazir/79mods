"""Assemble the supplied Talaria XXX print kit for the localhost preview.

Run python3 configurator/tools/build_xxx.py to regenerate. Mount placements
are estimated from the kit, not manufacturer CAD or fitment measurements.
Source assembly axes: front -X, lateral Y, up Z.
The print stand and alternate rotor are omitted; the standard rotor is used
on both axles. Original source STLs are preserved beside the generated asset.
"""
from pathlib import Path

import numpy as np
import trimesh

from build_ss3 import op_matrix

MODELS = Path(__file__).resolve().parents[1] / "models"
SOURCE = MODELS / "xxx-source"
OUTPUT = MODELS / "talaria-xxx.glb"
REAR = np.array([110.98, 0, 3.515])
RAKE = op_matrix([["rz", 90], ["ry", 27]])
HEAD = np.array([8.7, 0, 74.0])
FRONT = HEAD - RAKE[:3, :3] @ np.array([0, -8.89, 74.5])


def load(filename):
    return trimesh.load(SOURCE / filename, force="mesh", process=True)


def center(mesh):
    mesh.apply_translation(-mesh.bounds.mean(axis=0))
    return mesh


def wheel(first, second):
    halves = []
    for index, filename in enumerate([first, second]):
        half = load(filename)
        midpoint = half.bounds.mean(axis=0)
        half.apply_translation([-midpoint[0], -midpoint[1], -half.bounds[0, 2]])
        mating = np.all(abs(half.triangles[:, :, 2]) < 1e-5, axis=1)
        half.update_faces(~mating)
        if index:
            half.apply_transform(np.diag([1, 1, -1, 1]))
        halves.append(half)
    mesh = trimesh.util.concatenate(halves)
    mesh.merge_vertices()
    mesh.remove_unreferenced_vertices()
    return mesh


def main():
    parts = []

    def add(name, mesh, ops):
        mesh.apply_transform(op_matrix(ops))
        parts.append((name, mesh))

    def fork_ops(ops):
        return ops + [["rz", 90], ["ry", 27], ["t", *FRONT]]

    frame = load("X3 Frame.stl")
    frame = frame.simplify_quadric_decimation(face_count=90000)
    add("frame", frame, [["t", 0, -18.975, 0]])
    add("fork_body", load("Fork Body.stl"),
        fork_ops([["t", -14.47, -12.49, -3.5]]))
    for side, lateral in [("Left", -10), ("Right", 10)]:
        stanchion = load(f"Fork Stanchion {side}.stl")
        stanchion.apply_translation([9.95 + lateral, 7.5 - 8.89, -3.5])
        add(f"fork_stanchion_{side.lower()}", stanchion, fork_ops([]))
        add(f"fork_cap_{side.lower()}", center(load(f"Fork Cap {side}.stl")),
            fork_ops([["t", lateral, -8.89, 77.0]]))
    add("fork_steerer", load("Fork Steerer Tube.stl"),
        fork_ops([["t", -13.565, -12.49, 50.5]]))
    add("fork_stem", load("Fork Stem.stl"),
        fork_ops([["t", -13.57, -12.49, 76.5]]))
    add("handlebar", center(load("Handlebars X3.stl")),
        fork_ops([["t", 0, -6.5, 85.5]]))
    for side, sign in [("left", -1), ("right", 1)]:
        filename = "Grip Left.stl" if sign == -1 else "Throttle Right Grip.stl"
        add(f"grip_{side}", center(load(filename)),
            fork_ops([["ry", 90], ["t", sign * 32, -6.5, 85.5]]))
        brake = center(load(f"Brake {side.title()}.stl"))
        add(f"brake_{side}", brake,
            fork_ops([["t", sign * 25, -10.0, 85.5]]))
    add("display", center(load("Display.stl")),
        fork_ops([["t", -9, -9, 87.5]]))

    front = wheel("SUPERMOTO Front P1.stl", "SUPERMOTO Front P2.stl")
    rear = wheel("Supermoto Rear P1.stl", "Supermoto Rear P2.stl")
    radii = [front.extents[1] / 2, rear.extents[1] / 2]
    for name, mesh, axle in [
        ("wheel_front", front, FRONT), ("wheel_rear", rear, REAR)
    ]:
        add(name, mesh, [["rx", 90], ["t", *axle]])
    for name, axle, filename in [
        ("front_axle", FRONT, "Fork Axle.stl"),
        ("rear_axle", REAR, "Rear Axle.stl"),
    ]:
        add(name, center(load(filename)), [["rx", 90], ["t", *axle]])
    for name, axle in [("front_rotor", FRONT), ("rear_rotor", REAR)]:
        add(name, center(load("Brake Rotors.stl")),
            [["rx", 90], ["t", axle[0], 7.7, axle[2]]])
    add("rear_sprocket", center(load("Rear Sprocket.stl")),
        [["rz", 90], ["t", REAR[0], -8.0, REAR[2]]])
    add("wheel_connector", center(load("Wheel Connector.stl")),
        [["rz", 90], ["t", REAR[0], -10.5, REAR[2]]])
    add("rear_shock_top", load("Rear Shock Top.stl"),
        [["ry", -35], ["t", 70, 0, 33]])
    add("rear_mudguard", center(load("Rear Mudguard.stl")),
        [["rz", 90], ["ry", 60], ["t", 86, 0, 31]])

    # Pitch the whole chassis rigidly so different tire radii share the floor.
    delta = FRONT - REAR
    distance = np.hypot(delta[0], delta[2])
    angle = np.arcsin((radii[0] - radii[1]) / distance) - np.arctan2(
        delta[2], -delta[0]
    )
    leveling = op_matrix([["ry", np.rad2deg(angle)]])
    axles = np.array([FRONT, REAR]) @ leveling[:3, :3].T
    scale = 1.25 / (axles[1, 0] - axles[0, 0])
    origin = np.array([axles[:, 0].mean(), 0, axles[1, 2] - radii[1]])
    scene = trimesh.Scene()
    for name, mesh in parts:
        mesh.apply_transform(leveling)
        vertices = mesh.vertices - origin
        mesh.vertices = (np.column_stack(
            (-vertices[:, 0], vertices[:, 2], vertices[:, 1])
        ) * scale).astype(np.float32)
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
          f"{sum(len(mesh.faces) for _, mesh in parts):,} triangles; "
          f"{OUTPUT.stat().st_size / 1e6:.2f} MB")
    print(f"Wheel radii: {np.array(radii) * scale}; scale: {scale:.6f}")


if __name__ == "__main__":
    main()
