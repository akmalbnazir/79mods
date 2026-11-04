"""Build an SS-derived SR visual approximation (not factory CAD).

Run after build_ss.py. Published SR 19/18 tire sizes determine wheel dimensions;
bodywork, lighting and battery enclosure are approximate reference-image shapes.
The SS frame and suspension geometry are retained, not certified as SR fitment.

References:
https://www.eridepro.com/products/pro-sr
https://www.eridepro.com/products/pro-ss-2-0
"""
from pathlib import Path

import numpy as np
import trimesh

MODELS = Path(__file__).resolve().parents[1] / "models"
OUTPUT = MODELS / "eride-sr.glb"
FRONT_RADIUS = 19 * 0.0254 / 2 + 0.080
REAR_RADIUS = 18 * 0.0254 / 2 + 0.100 * 0.90


def material(mesh, color, metallic=0.0, roughness=0.7):
    srgb = np.array(color[:3], dtype=float) / 255
    linear = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    mesh.visual = trimesh.visual.TextureVisuals(
        material=trimesh.visual.material.PBRMaterial(
            baseColorFactor=[*linear, color[3] / 255], metallicFactor=metallic,
            roughnessFactor=roughness, doubleSided=True,
        )
    )
    return mesh


def box(size, center):
    mesh = trimesh.creation.box(extents=size)
    mesh.apply_translation(center)
    return mesh


def fender():
    points = []
    for x, height, half_width in [
        (0.435, 0.715, 0.045), (0.53, 0.742, 0.06),
        (0.65, 0.746, 0.058), (0.77, 0.724, 0.044),
        (0.82, 0.703, 0.027),
    ]:
        for side in [-1, 1]:
            for thickness in [-0.004, 0.004]:
                points.append([x, height + thickness, side * half_width])
    return trimesh.convex.convex_hull(np.array(points))


def wheel(radius, width, rim_radius, axle):
    rubber = trimesh.creation.torus(radius - 0.045, 0.038, 96, 16)
    rubber.apply_scale([1, 1, (width - 0.012) / 0.076])
    pieces = [rubber]
    for index in range(48):
        angle = index * 2 * np.pi / 48
        for row in [-1, 0, 1]:
            a = angle + (0.025 if row else 0)
            lug = box([0.025, 0.016, width * 0.29], [0, radius - 0.008, row * width * 0.355])
            lug.apply_transform(trimesh.transformations.rotation_matrix(
                a, [0, 0, 1]
            ))
            pieces.append(lug)
    tire = trimesh.util.concatenate(pieces)
    material(tire, [24, 24, 27, 255], roughness=0.95)
    rim = trimesh.creation.torus(rim_radius, 0.011, 96, 12)
    rim.apply_scale([1, 1, width * 0.7 / 0.022])
    metal = [rim, trimesh.creation.cylinder(0.03, width * 0.9, sections=24)]
    for index in range(36):
        angle = index * 2 * np.pi / 36
        side = 1 if index % 2 else -1
        endpoint = [np.cos(angle) * rim_radius, np.sin(angle) * rim_radius, side * width * 0.22]
        metal.append(trimesh.creation.cylinder(
            0.0016, sections=6, segment=[[0, 0, side * width * 0.3], endpoint]
        ))
    spokes = material(trimesh.util.concatenate(metal), [145, 147, 153, 255], 0.7, 0.4)
    for mesh in [tire, spokes]:
        mesh.apply_translation(axle)
    return tire, spokes


def main():
    source = MODELS / "eride-ss.glb"
    if not source.is_file():
        raise FileNotFoundError(f"Build SS before SR: {source}")
    base = trimesh.load(source, force="scene", process=False)
    old_front = base.geometry["wheel_front"].bounds.mean(axis=0)
    old_rear = base.geometry["wheel_rear"].bounds.mean(axis=0)
    # Pitch the whole chassis slightly so both larger tires remain grounded
    # and the axle hardware stays connected, without stretching the frame.
    old_delta = old_front - old_rear
    length = np.linalg.norm(old_delta[:2])
    height_delta = FRONT_RADIUS - REAR_RADIUS
    horizontal = np.sqrt(length ** 2 - height_delta ** 2)
    angle = np.arctan2(height_delta, horizontal) - np.arctan2(old_delta[1], old_delta[0])
    pose = trimesh.transformations.rotation_matrix(angle, [0, 0, 1])
    new_rear = np.array([-horizontal / 2, REAR_RADIUS, 0])
    pose[:3, 3] = new_rear - pose[:3, :3].dot(old_rear)
    new_front = new_rear + np.array([horizontal, height_delta, 0])
    scene = trimesh.Scene()
    for name, geometry in base.geometry.items():
        if name in ("wheel_front", "wheel_rear"):
            continue
        mesh = geometry.copy()
        mesh.apply_transform(pose)
        material(mesh, [33, 33, 37, 255], 0.15)
        scene.add_geometry(mesh, node_name=name, geom_name=name)

    for name, radius, width, rim, axle in [
        ("front", FRONT_RADIUS, 0.080, 19 * 0.0254 / 2, new_front),
        ("rear", REAR_RADIUS, 0.100, 18 * 0.0254 / 2, new_rear),
    ]:
        for suffix, mesh in zip(["tire", "spokes"], wheel(radius, width, rim, axle)):
            scene.add_geometry(mesh, node_name=f"wheel_{name}_{suffix}",
                               geom_name=f"wheel_{name}_{suffix}")

    # These shapes only approximate the visible SR enclosure and accessories.
    extras = {
        "sr_battery": box([0.205, 0.31, 0.15], [0.09, 0.61, 0]),
        "sr_controller": box([0.055, 0.22, 0.15], [0.255, 0.57, 0]),
        "sr_headlight": box([0.04, 0.04, 0.17], [0.421, 0.895, 0]),
        "sr_headlight_lens": box([0.004, 0.025, 0.148], [0.443, 0.895, 0]),
        "sr_number_plate": box([0.022, 0.15, 0.15], [0.438, 0.795, 0]),
        "sr_front_fender": fender(),
    }
    for name, mesh in extras.items():
        mesh.apply_transform(pose)
        material(mesh, [205, 212, 220, 255] if name.endswith("lens") else [29, 29, 33, 255])
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    scene.export(OUTPUT)
    print(f"Wrote {OUTPUT}: {sum(len(m.faces) for m in scene.geometry.values()):,} triangles; "
          f"{OUTPUT.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
