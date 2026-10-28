"""Convert assembled 79Bike Falcon STLs to cleaned, decimated configurator GLBs.

Usage: python build_falcon.py [gt|pro ...]   (defaults to all models)

Output axes: +X forward, +Y up, +Z across, metres, ground at Y=0, origin midway
between the axles. Every source-to-output axis mapping must be a proper rotation
(determinant +1); a mirror flips triangle winding and renders inside-out.
"""
import os
import sys

import fast_simplification
import numpy as np
import trimesh

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(HERE, "models")
WHEELBASE_METERS = 1.22
MIN_COMPONENT_FACES = 60

# "axes" rows map source XYZ onto output XYZ.
BIKES = {
    "gt": {
        "source": "falcon-gt-source.stl",
        "output": "falcon-gt.glb",
        # source: +Y forward, Z up, X across
        "axes": [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
        "front_axle": (0.0, 0.355, -0.15),
        "rear_axle": (0.0, -0.355, -0.15),
        "ground": -0.295,
        "target_faces": 160_000,
    },
    "pro": {
        "source": "falcon-pro-source.stl",
        "output": "falcon-pro.glb",
        # source: -X forward, Z up, Y across
        "axes": [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
        "front_axle": (-0.33177, 0.0, 0.158),
        "rear_axle": (0.33169, 0.0, 0.158),
        "ground": 0.0,
        "target_faces": 220_000,
    },
}


def drop_fragments(mesh):
    """Remove tiny disconnected shards left over from the STL export."""
    labels = trimesh.graph.connected_component_labels(mesh.face_adjacency, node_count=len(mesh.faces))
    keep = np.bincount(labels)[labels] >= MIN_COMPONENT_FACES
    mesh.update_faces(keep)
    mesh.remove_unreferenced_vertices()
    return int((~keep).sum())


def build(name):
    cfg = BIKES[name]
    source = os.path.join(MODELS, cfg["source"])
    if not os.path.isfile(source):
        raise FileNotFoundError(f"{name} source STL not found: {source}")

    axes = np.array(cfg["axes"], dtype=float)
    if not np.isclose(np.linalg.det(axes), 1.0):
        raise ValueError(f"{name} axis mapping must be a rotation, not a mirror")

    mesh = trimesh.load(source, force="mesh", process=True)
    raw_faces = len(mesh.faces)
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.update_faces(mesh.unique_faces())
    dropped = drop_fragments(mesh)

    target = cfg["target_faces"]
    if len(mesh.faces) > target:
        vertices, faces = fast_simplification.simplify(
            mesh.vertices.astype(np.float32),
            mesh.faces.astype(np.int32),
            target_reduction=1 - target / len(mesh.faces),
        )
        mesh = trimesh.Trimesh(vertices, faces, process=True)

    front, rear = np.array(cfg["front_axle"]), np.array(cfg["rear_axle"])
    scale = WHEELBASE_METERS / np.linalg.norm(front - rear)
    origin = (front + rear) / 2
    origin[2] = cfg["ground"]
    mesh.vertices = (mesh.vertices - origin) @ axes.T * scale

    front_out = (front - origin) @ axes.T * scale
    if front_out[0] <= 0:
        raise ValueError(f"{name} front axle does not face +X")

    scene = trimesh.Scene()
    scene.add_geometry(mesh, node_name="frame", geom_name="frame")
    output = os.path.join(MODELS, cfg["output"])
    scene.export(output)
    print(
        f"{name}: {raw_faces:,} -> {len(mesh.faces):,} triangles "
        f"(dropped {dropped:,} fragment faces); {os.path.getsize(output) / 1e6:.1f} MB; "
        f"bounds {np.round(mesh.bounds, 3).tolist()}"
    )


if __name__ == "__main__":
    for bike in sys.argv[1:] or BIKES:
        build(bike)
