"""Build an estimated E Ride Pro SS 3.0 assembly GLB from the kit STLs."""
import json
import os
import sys

import numpy as np
import trimesh

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(HERE, "ss3.json")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "models", "eride-ss3.glb")
SCALE = 0.01
FRONT_AXLE = np.array([-76.0, 0.0, 5.4])
REAR_AXLE = np.array([51.4, 0.0, 3.74])
MID_X = (FRONT_AXLE[0] + REAR_AXLE[0]) / 2
GROUND_Z = REAR_AXLE[2] - 28.9


def op_matrix(ops):
    matrix = np.eye(4)
    for op in ops:
        transform = np.eye(4)
        if op[0] == "t":
            transform[:3, 3] = op[1:4]
        elif op[0] in ("rx", "ry", "rz"):
            axis = {"rx": 0, "ry": 1, "rz": 2}[op[0]]
            transform = trimesh.transformations.rotation_matrix(
                np.deg2rad(op[1]), np.eye(3)[axis]
            )
        elif op[0] == "s":
            transform[:3, :3] = np.diag(op[1:4])
        else:
            raise ValueError(f"Unknown transform operation: {op[0]}")
        matrix = transform @ matrix
    return matrix


def to_glb_coordinates(vertices):
    converted = np.column_stack(
        (
            -(vertices[:, 0] - MID_X),
            vertices[:, 2] - GROUND_Z,
            -vertices[:, 1],
        )
    ) * SCALE
    return converted


def load_part(part):
    source = os.path.join(HERE, "models", "ss3-source", part["file"])
    if not os.path.isfile(source):
        raise FileNotFoundError(f"Missing source STL for {part['id']}: {source}")
    mesh = trimesh.load(source, force="mesh", process=False)
    mesh.apply_transform(op_matrix(part.get("ops", [])))
    return mesh


def main():
    with open(MANIFEST, encoding="utf-8") as manifest_file:
        parts = json.load(manifest_file)["parts"]

    frame_meshes = []
    wheels = {}
    seen = set()
    for part in parts:
        if part["id"] in seen:
            raise ValueError(f"Duplicate component id: {part['id']}")
        seen.add(part["id"])
        if part.get("export", True) is False:
            continue

        mesh = load_part(part)
        node = part.get("node")
        if node:
            if node not in ("wheel_front", "wheel_rear") or node in wheels:
                raise ValueError(f"Unexpected or duplicate GLB node: {node}")
            axle = FRONT_AXLE if node == "wheel_front" else REAR_AXLE
            axle_glb = to_glb_coordinates(axle.reshape(1, 3))[0]
            mesh.vertices = to_glb_coordinates(mesh.vertices) - axle_glb
            mesh.faces = mesh.faces[:, ::-1]
            wheels[node] = (mesh, axle_glb)
        else:
            mesh.vertices = to_glb_coordinates(mesh.vertices)
            mesh.faces = mesh.faces[:, ::-1]
            frame_meshes.append(mesh)

    if set(wheels) != {"wheel_front", "wheel_rear"}:
        raise ValueError("Both front and rear wheel nodes are required")

    frame = trimesh.util.concatenate(frame_meshes)
    frame.merge_vertices()
    frame.fix_normals()

    scene = trimesh.Scene()
    scene.add_geometry(frame, node_name="frame", geom_name="frame")
    for node, (mesh, axle) in wheels.items():
        mesh.merge_vertices()
        mesh.fix_normals()
        pose = np.eye(4)
        pose[:3, 3] = axle
        scene.add_geometry(mesh, node_name=node, geom_name=node, transform=pose)

    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    scene.export(OUT)
    print(f"Wrote {OUT}")
    print(f"Frame: {len(frame.faces):,} triangles; front wheel: {len(wheels['wheel_front'][0].faces):,}; "
          f"rear wheel: {len(wheels['wheel_rear'][0].faces):,}")
    print(f"Axles: {wheels['wheel_front'][1].round(4)} and {wheels['wheel_rear'][1].round(4)}; "
          f"ground Y={0:.3f} m")


if __name__ == "__main__":
    main()
