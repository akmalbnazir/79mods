"""Write the estimated E Ride Pro SS 3.0 kit assembly to ss3.json."""
import copy
import json
import math
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(HERE, "ss3.json")
config = json.load(open(MANIFEST))
parts = {part["id"]: part for part in config["parts"]}

FRONT_AXLE = (-76, 0, 5.4)
REAR_AXLE = (51.4, 0, 3.74)
FORK_TILT = 27
FORK_AXLE = (4.5, 14.45, 3.5)
FORK_LEG_X = 5.1
FORK_LEG_Y = (4.5, 24.5)


def t(x, y, z):
    return ["t", x, y, z]


def fork(ops):
    return ops + [
        ["rz", 180],
        ["ry", FORK_TILT],
        t(*FRONT_AXLE),
    ]


def place(part_id, ops, **metadata):
    parts[part_id]["ops"] = ops
    parts[part_id].update(metadata)


# The wheel STL thickness is its local Z axis. The fork kit is oriented up its
# local Z axis, with the supplied frame coordinate system's Z pointing up.
place("frame", [])
for wheel_id, axle in (
    ("wfront_a", FRONT_AXLE),
    ("wfront_b", FRONT_AXLE),
    ("wrear_a", REAR_AXLE),
    ("wrear_b", REAR_AXLE),
):
    place(
        wheel_id,
        [["rx", 90], t(*axle)],
        node="wheel_front" if wheel_id.startswith("wfront") else "wheel_rear",
        export=wheel_id.endswith("_a"),
    )

# Fork body axle holes are at approximately (4.5, 4.5, 3.5) and
# (4.5, 24.5, 3.5). Re-center every fork component on that axle midpoint
# before applying the common steering-axis pose.
place(
    "forkbody",
    fork([t(-FORK_AXLE[0], -FORK_AXLE[1], -FORK_AXLE[2])]),
)
stanchion_center = (2.93, 2.49)
stanchion_z = -FORK_AXLE[2]
right_leg_offset = (
    FORK_LEG_X - FORK_AXLE[0] - stanchion_center[0],
    FORK_LEG_Y[0] - FORK_AXLE[1] - stanchion_center[1],
    stanchion_z,
)
left_leg_offset = (
    right_leg_offset[0],
    FORK_LEG_Y[1] - FORK_AXLE[1] + stanchion_center[1],
    stanchion_z,
)
place("stanchion", fork([t(*right_leg_offset)]))
stanchion_left_ops = fork(
    [
        ["s", 1, -1, 1],
        t(*left_leg_offset),
    ]
)
if "stanchionL" in parts:
    parts["stanchionL"]["ops"] = stanchion_left_ops
else:
    stanchion_left = copy.deepcopy(parts["stanchion"])
    stanchion_left["id"] = "stanchionL"
    stanchion_left["ops"] = stanchion_left_ops
    config["parts"].append(stanchion_left)
    parts["stanchionL"] = stanchion_left

# The steerer and stem meshes are centered laterally on their own tube axes;
# their STL origins are not at those axes.
place("steerer", fork([t(-3.6, -13.565, 40)]))
place("stem", fork([t(-5.2, -13.93, 66)]))
cap_center = (3.99, 4.0)
place("capL", fork([t(FORK_LEG_X - FORK_AXLE[0] - cap_center[0], -13.95, 55)]))
place("capR", fork([t(FORK_LEG_X - FORK_AXLE[0] - cap_center[0], 6.05, 55)]))

# Seat and frame-bay components are positioned against the supplied frame
# silhouette. The motor's long dimension is oriented along the bike.
seat_level_angle = math.degrees(math.atan2(32.0, 42.0))
place(
    "seat",
    [
        ["rx", seat_level_angle],
        ["rz", -90],
        t(-29, 10, 25),
    ],
)
place("battery", [t(-7, -8.5, 17)])
place("controller", [t(-24, -9.75, 14)])
place("hatch", [["rz", 90], t(10, 3.2, 22)])
place("motor", [["rz", -90], t(4, 10.2, 20)])

# Foot pegs sit either side of the lower frame; the one-piece rear gear and
# rotor are attached to opposite sides of the rear wheel.
place("pegL", [["rx", 90], t(22, -9.5, 22)])
place("pegR", [["rx", -90], t(22, 9.5, 22)])
place("sprocket", [t(-12.5, -12.5, 0), ["rx", 90], t(REAR_AXLE[0], -4.5, REAR_AXLE[2])])
place("rotor", [t(-13, -13, 0), ["rx", -90], t(REAR_AXLE[0], 4.5, REAR_AXLE[2])])
place("wconn", [t(0, -5.65, 0), t(REAR_AXLE[0], -4, REAR_AXLE[2])])

# Handlebar follows the steering axis. The grips and brake clamps are placed
# from their measured STL axes so their bores meet the handlebar ends.
place("bar", fork([t(-2.03, -40, 66.9)]))
place("grip", [["rx", 90], t(-48.4, -40, 63.0)])
place("throttle", [["rx", -90], t(-48.9, 40, 70.5)])
place("brakeL", [["rx", 90], t(-54.9, -36, 50.5)])
place("brakeR", [["rx", -90], t(-54.9, 36, 70.5)])

json.dump(config, open(MANIFEST, "w"), indent=1)
print("Wrote estimated placements for", len(config["parts"]), "kit components")
