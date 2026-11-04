"""Assemble the print-oriented SS kit into a local configurator preview.

Placements are estimates from frame mounts and matching kit axes, not factory
assembly transforms. Source assembly coordinates: front -X, lateral Y, up Z.
Run python3 configurator/tools/build_ss.py to regenerate the GLB.
"""
from pathlib import Path

import numpy as np
import trimesh

from build_ss3 import complete_wheel, op_matrix

MODELS = Path(__file__).resolve().parents[1] / "models"
SOURCE = MODELS / "ss-source"
OUTPUT = MODELS / "eride-ss.glb"
FRONT = np.array([-76.0, 0.0, 5.4])
REAR = np.array([51.4, 0.0, 3.74])
SCALE = 1.25 / (REAR[0] - FRONT[0])


def t(x, y, z):
    return ["t", x, y, z]


def fork(ops):
    return ops + [["rz", 180], ["ry", 27], t(*FRONT)]


def load_components(filename):
    mesh = trimesh.load(SOURCE / filename, force="mesh", process=True)
    labels = trimesh.graph.connected_component_labels(
        mesh.face_adjacency, node_count=len(mesh.faces)
    )
    counts = np.bincount(labels)
    components = [
        mesh.submesh([np.flatnonzero(labels == index)], append=True, repair=False)
        for index in np.argsort(counts)[::-1]
        if counts[index] > 100
    ]
    for component in components:
        component.apply_translation(-component.bounds[0])
    return components


def main():
    parts = []

    def add(name, mesh, ops):
        mesh = mesh.copy()
        mesh.apply_transform(op_matrix(ops))
        parts.append((name, mesh))

    frame = trimesh.load(SOURCE / "Eride RAW Model.stl", force="mesh", process=True)
    add("frame", frame, [["rz", 90], t(2.173, -24.9655, -0.511)])

    forks = load_components("Forks.stl")
    add("fork_body", forks[0], fork([t(-4.5, -14.45, -3.5)]))
    add("stem", forks[1], fork([t(-5.2, -13.93, 66)]))
    add("steerer", forks[2], fork([t(-3.6, -13.565, 40)]))
    add("stanchion_right", forks[3], fork([t(-2.33, -12.44, -3.5)]))
    add("stanchion_left", forks[4], fork([t(-2.33, 7.56, -3.5)]))

    holders = load_components("Fork holders.stl")
    for index, lateral in enumerate([-13.75, 6.25]):
        add(f"fork_cap_{index}", holders[index], fork([t(-3.2, lateral, 51.5)]))

    controls = load_components("for bars.stl")
    add("handlebar", controls[0], fork([["rx", -90], t(-2.03, -40, 71.861)]))
    add("brake_left", controls[1], [["rx", 180], t(0, 20.46, 8), ["rx", 90], t(-54.9, -24, 50.5)])
    add("brake_right", controls[2], [["rx", 180], t(0, 20.46, 8), ["rx", -90], t(-54.9, 24, 70.5)])

    grips = load_components("Grips.stl")
    add("grip", grips[0], [["rx", 90], t(-48.4, -24, 63)])
    add("throttle", grips[1], [["rx", -90], t(-48.9, 24, 70.5)])
    add("display", trimesh.load(SOURCE / "screen.stl", force="mesh", process=True),
        [t(-5, -5.585, 0), ["rx", -20], t(-46, 0, 68)])

    wheels = load_components("Wheeks.stl")
    # The bed contains flat-backed print halves, not complete wheel options.
    # Mirror one detailed half per axle to keep the mating seam exact.
    for name, wheel, axle in [
        ("wheel_front", wheels[0], FRONT),
        ("wheel_rear", wheels[2], REAR),
    ]:
        wheel = complete_wheel(wheel)
        add(name, wheel, [["rx", 90], t(*axle)])

    motor = load_components("motor.stl")[0]
    add("motor", motor, [t(-14.525, -11.435, -8.85), ["rx", 90], t(-4, 0, 14)])
    seat = trimesh.load(SOURCE / "Seat.stl", force="mesh", process=True)
    add("seat", seat, [
        ["rx", 37.3], ["rz", -90], t(-6, 10, 35),
        t(-30, 0, -60), ["ry", -8], t(30, 0, 60),
    ])
    holder = trimesh.load(SOURCE / "battery holder.stl", force="mesh", process=True)
    add("battery_holder", holder, [t(-10.87, -13.685, 0), ["rz", 90], t(-14, 0, 34)])
    shock = trimesh.load(SOURCE / "top suspen part.stl", force="mesh", process=True)
    add("shock_mount", shock, [t(-4, -5.605, 0), ["rz", 90], t(-2, 0, 23)])

    pegs = load_components("pegs.stl")
    add("peg_left", pegs[0], [["rx", 90], t(12, -9.5, 8)])
    add("peg_right", pegs[1], [["rx", -90], t(12, 9.5, 16.2)])

    rotor = trimesh.load(SOURCE / "Brake+Rotor.stl", force="mesh", process=True)
    for name, axle in [("front_rotor", FRONT), ("rear_rotor", REAR)]:
        add(name, rotor, [t(-13.65, -13.65, -0.5), ["rx", -90],
                          t(axle[0], 4.5, axle[2])])
    sprocket = trimesh.load(SOURCE / "sprock.stl", force="mesh", process=True)
    add("sprocket", sprocket, [t(-12.49, -12.46, -0.5), ["rx", 90],
                             t(REAR[0], -4.5, REAR[2])])
    pins = load_components("Wheel pinss.stl")
    for name, pin, axle in [
        ("front_axle_pin", pins[0], FRONT),
        ("rear_axle_pin", pins[1], REAR),
    ]:
        pin = pin.copy()
        pin.apply_translation(-pin.bounds.mean(axis=0))
        add(name, pin, [["rx", 90], t(*axle)])
    connector = trimesh.load(SOURCE / "wheelpin.stl", force="mesh", process=True)
    add("rear_connector", connector, [
        t(-1.46, -5.655, -1.5), ["rx", 90],
        t(REAR[0], -6, REAR[2]),
    ])
    scene = trimesh.Scene()
    origin = np.array([(FRONT[0] + REAR[0]) / 2, 0, -25.15])
    for name, mesh in parts:
        vertices = mesh.vertices - origin
        mesh.vertices = np.column_stack(
            (-vertices[:, 0], vertices[:, 2], vertices[:, 1])
        ) * SCALE
        if not np.isfinite(mesh.vertices).all():
            raise ValueError(f"Nonfinite geometry in {name}")
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    scene.export(OUTPUT)
    print(f"Wrote {OUTPUT}: {len(parts)} meshes, "
          f"{sum(len(mesh.faces) for _, mesh in parts):,} triangles; "
          f"{OUTPUT.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
