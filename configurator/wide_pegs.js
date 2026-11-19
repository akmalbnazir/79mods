import * as THREE from 'three';
import { mat } from './bike.js?v=release-finishes-31';

const plateStart = 0.013;
const plateThickness = 0.008;
const pinHeight = 0.013;

// Coordinates traced on the single-peg photo. Normalize the widening toward
// the camera before mapping the tread to bike space (~70 x 85 mm with bevels).
function treadPoint(x, y) {
  const row = (y - 290) / 620;
  return [(x - 250 - 39 * row) * 0.065 / (432 + 94 * row), plateStart + row * 0.083];
}

function trace(path, start, segments) {
  const point = (x, y) => {
    const [across, outward] = treadPoint(x, y);
    return [across, -outward];
  };
  path.moveTo(...point(...start));
  for (const [x, y, endX, endY] of segments) {
    if (endX === undefined) path.lineTo(...point(x, y));
    else path.quadraticCurveTo(...point(x, y), ...point(endX, endY));
  }
  path.closePath();
  return path;
}

function treadShape() {
  const outline = trace(new THREE.Shape(), [101, 291], [
    [438, 293], [482, 346, 488, 370], [550, 761], [557, 810, 526, 841],
    [485, 889], [467, 911, 431, 911], [139, 909], [68, 906, 45, 865],
    [31, 842, 40, 817], [43, 804, 31, 796], [28, 728], [31, 706, 50, 694],
    [60, 688, 47, 678], [28, 667, 34, 644], [29, 579], [31, 543, 50, 530],
    [60, 521, 46, 514], [29, 503, 34, 475], [29, 417], [30, 392, 48, 381],
    [56, 376, 44, 368], [29, 358, 45, 342], [101, 291]
  ]);
  outline.holes.push(
    trace(new THREE.Path(), [147, 334], [
      [201, 334], [215, 342, 212, 367], [224, 521], [224, 548, 202, 548],
      [143, 547], [104, 546, 105, 511], [103, 375], [103, 356, 147, 334]
    ]),
    trace(new THREE.Path(), [299, 336], [
      [369, 335], [386, 335, 393, 350], [406, 366, 424, 363],
      [441, 370, 445, 392], [453, 452], [456, 469, 444, 480],
      [431, 495, 447, 511], [472, 538, 441, 551], [333, 550],
      [313, 552, 309, 525], [294, 390], [289, 367, 309, 356], [319, 339, 299, 336]
    ]),
    trace(new THREE.Path(), [145, 594], [
      [163, 589, 175, 606], [191, 624, 214, 608], [226, 594, 242, 595],
      [310, 596], [325, 595, 339, 611], [358, 627, 380, 611],
      [394, 594, 418, 598], [448, 598, 463, 614], [479, 632, 470, 659],
      [463, 680, 479, 700], [486, 713, 488, 737], [497, 775, 465, 792],
      [444, 805, 436, 822], [426, 841, 402, 841], [335, 840],
      [319, 840, 306, 830], [292, 819, 278, 831], [268, 839, 246, 837],
      [153, 838], [113, 836, 112, 795], [108, 638], [107, 605, 145, 594]
    ])
  );
  return outline;
}

function mountingEar() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.013, 0.007);
  shape.lineTo(-0.012, 0.024);
  shape.lineTo(-0.006, 0.029);
  shape.lineTo(0.005, 0.027);
  shape.lineTo(0.019, 0.008);
  shape.lineTo(0.019, 0.002);
  shape.lineTo(0.001, 0.002);
  shape.quadraticCurveTo(-0.009, 0.002, -0.013, 0.007);
  const bore = new THREE.Path();
  bore.absellipse(0, pinHeight, 0.0045, 0.0045, 0, Math.PI * 2, true);
  shape.holes.push(bore);
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.004, bevelSize: 0.0007, bevelThickness: 0.0006, bevelSegments: 2, curveSegments: 16
  });
}

export function widePegKit(color, side, anchor) {
  const group = new THREE.Group();
  group.name = side < 0 ? 'peg_left' : 'peg_right';
  group.position.copy(anchor);
  group.position.y -= pinHeight;
  group.scale.z = side;
  const finish = mat(color || '#d7d7dc', { metal: 0.96, rough: color === '#18181b' ? 0.28 : 0.16 });
  const titanium = mat('#075b9d', { metal: 0.92, rough: 0.22 });
  const hardware = mat('#292b31', { metal: 0.86, rough: 0.28 });
  const add = (name, geometry, material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const platform = add('peg_platform', new THREE.ExtrudeGeometry(treadShape(), {
    depth: plateThickness, bevelSize: 0.0012, bevelThickness: 0.001, bevelSegments: 2, curveSegments: 8
  }), finish);
  platform.rotation.x = -Math.PI / 2;

  const ear = mountingEar();
  for (const x of [-0.010, 0.014]) {
    add('peg_mounting_ear', ear, finish, x).rotation.y = -Math.PI / 2;
  }
  add('peg_mounting_pivot', new THREE.CylinderGeometry(0.0036, 0.0036, 0.029, 20),
    hardware, 0, pinHeight).rotation.z = Math.PI / 2;

  const studs = [[67, 357], [252, 345], [426, 350], [67, 485], [477, 490], [195, 602],
    [360, 602], [71, 647], [501, 659], [72, 816], [475, 811], [303, 861]];
  const collars = new THREE.CylinderGeometry(0.0028, 0.003, 0.0015, 16);
  const tips = new THREE.CylinderGeometry(0.0021, 0.0024, 0.005, 16);
  for (const [px, py] of studs) {
    const [x, z] = treadPoint(px, py);
    add('peg_stud_collar', collars, hardware, x, plateThickness + 0.001, z);
    add('traction_screw', tips, titanium, x, plateThickness + 0.004, z);
  }
  return group;
}
