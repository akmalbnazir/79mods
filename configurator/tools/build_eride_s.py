"""Convert the assembled E Ride Pro S OBJ into the local configurator GLB.

The OBJ's referenced MTL is not supplied, so materials are deliberately omitted;
the configurator applies its dark bike finish. Source axes are -Z forward, Y up,
X lateral. Scale uses the configurator's 1.25 m wheelbase.
Requires numpy, trimesh and mapbox-earcut for concave OBJ polygons.
"""
from pathlib import Path

import numpy as np
import trimesh
import mapbox_earcut

MODELS = Path(__file__).resolve().parents[1] / "models"
SOURCE = MODELS / "eride-s-source.obj"
OUTPUT = MODELS / "eride-s.glb"
FRONT_Z = -2.7061
REAR_Z = -0.0002
LATERAL_X = 0.2447
GROUND_Y = 0.1507
WHEELBASE = 1.25


def load_geometry():
    vertices, faces = [], []
    with SOURCE.open(encoding="utf-8") as source:
        for line in source:
            fields = line.split()
            if not fields:
                continue
            if fields[0] == "v":
                vertices.append([float(value) for value in fields[1:4]])
            elif fields[0] == "f":
                indices = [int(value.split("/")[0]) for value in fields[1:]]
                indices = np.array([
                    index - 1 if index > 0 else len(vertices) + index
                    for index in indices
                ])
                if len(indices) == 3:
                    faces.append(indices)
                    continue
                points = np.array([vertices[index] for index in indices])
                centered = points - points.mean(axis=0)
                _, singular, axes = np.linalg.svd(centered, full_matrices=False)
                if singular[1] < 1e-10:
                    continue
                projected = np.ascontiguousarray(centered @ axes[:2].T)
                triangles = mapbox_earcut.triangulate_float64(
                    projected, np.array([len(indices)], dtype=np.uint32)
                ).reshape(-1, 3)
                if not len(triangles):
                    raise ValueError(f"Unable to triangulate OBJ polygon: {line[:100]}")
                # Earcut chooses its own winding; match the source polygon.
                normal = np.cross(centered, np.roll(centered, -1, axis=0)).sum(axis=0)
                for triangle in triangles:
                    a, b, c = points[triangle]
                    if np.dot(np.cross(b - a, c - a), normal) < 0:
                        triangle = triangle[::-1]
                    faces.append(indices[triangle])
    mesh = trimesh.Trimesh(vertices, faces, process=False)
    mesh.update_faces(mesh.nondegenerate_faces())
    return mesh


def main():
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Missing E Ride Pro S source: {SOURCE}")
    mesh = load_geometry()
    if not len(mesh.faces) or not np.isfinite(mesh.vertices).all():
        raise ValueError("E Ride Pro S source must contain finite mesh geometry")

    vertices = mesh.vertices.copy()
    scale = WHEELBASE / (REAR_Z - FRONT_Z)
    mesh.vertices = np.column_stack(
        (
            -(vertices[:, 2] - (FRONT_Z + REAR_Z) / 2),
            vertices[:, 1] - GROUND_Y,
            vertices[:, 0] - LATERAL_X,
        )
    ) * scale

    labels = trimesh.graph.connected_component_labels(
        mesh.face_adjacency, node_count=len(mesh.faces)
    )
    wheel_components = {}
    for component in np.unique(labels):
        face_ids = np.flatnonzero(labels == component)
        if len(face_ids) < 1000:
            continue
        candidate = mesh.submesh([face_ids], append=True, repair=False)
        center = candidate.bounds.mean(axis=0)
        extent = candidate.extents
        if extent[0] > 0.45 and extent[1] > 0.45 and extent[2] < 0.1:
            name = "wheel_front" if center[0] > 0 else "wheel_rear"
            if name in wheel_components:
                raise ValueError(f"Multiple connected components detected for {name}")
            wheel_components[name] = (candidate, face_ids, center)
    if set(wheel_components) != {"wheel_front", "wheel_rear"}:
        raise ValueError(
            "Expected one independently connected mesh for each S wheel; "
            f"found {sorted(wheel_components)}"
        )

    scene = trimesh.Scene()
    wheel_faces = np.concatenate([wheel_components[n][1] for n in wheel_components])
    mesh.update_faces(~np.isin(np.arange(len(mesh.faces)), wheel_faces))
    mesh.remove_unreferenced_vertices()
    scene.add_geometry(mesh, node_name="frame", geom_name="frame")
    for name, (wheel, _, center) in wheel_components.items():
        wheel.vertices -= center
        pose = np.eye(4)
        pose[:3, 3] = center
        scene.add_geometry(wheel, node_name=name, geom_name=name, transform=pose)

    scene.export(OUTPUT)
    print(
        f"Wrote {OUTPUT}: {sum(len(m.faces) for m in scene.geometry.values()):,} triangles; "
        f"{OUTPUT.stat().st_size / 1e6:.2f} MB; "
        f"bounds {np.round(mesh.bounds, 4).tolist()}"
    )


if __name__ == "__main__":
    main()
