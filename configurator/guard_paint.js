import * as THREE from 'three';

export const paintColors = {
  Silver: ['#bfc3cc'],
  'Blue/Purple ColorShift': ['#1748ac', '#792eb0'],
  'Green/Teal ColorShift': ['#268341', '#149ca5'],
  'Light Blue': ['#70c4ed'],
  'Dark Blue': ['#16479d'],
  'Light Purple': ['#bc8ce3'],
  'Dark Purple': ['#662a96'],
  Red: ['#c82136'],
  'Light Pink': ['#f3a6c6'],
  'Hot Pink': ['#e32691'],
  'Dark Grey': ['#454852'],
  White: ['#f4f3f1'],
  Grey: ['#90949c'],
  Black: ['#151518']
};

export const paintEffects = {
  'No Fade/ Iridescent (Just Main Color)': { label: 'Solid main color', fade: 0, sparkle: false },
  '#1 Color Fade into Black in the Middle and Then Back to Color': { label: 'Fade #1: Color / Black / Color', fade: 1, sparkle: false },
  '#2 Color Fade Black to Color Then to Black': { label: 'Fade #2: Black / Color / Black', fade: 2, sparkle: false },
  'Iridescent sparkle + #1 Fade': { label: 'Iridescent sparkle + Fade #1', fade: 1, sparkle: true },
  'Iridescent sparkle + #2 Fade': { label: 'Iridescent sparkle + Fade #2', fade: 2, sparkle: true },
  'Iridescent sparkle': { label: 'Iridescent sparkle', fade: 0, sparkle: true }
};

export function guardPaint(variant) {
  if (!Object.hasOwn(paintColors, variant?.option1) || !Object.hasOwn(paintEffects, variant?.option2)) {
    throw new Error(`Paint preview unavailable for ${variant?.title || 'this option'}. Please retry the catalog.`);
  }
  const colors = paintColors[variant.option1];
  const effect = paintEffects[variant.option2];
  return {
    colorName: variant.option1,
    effectName: variant.option2,
    color: colors[0],
    shiftColor: colors[1] || colors[0],
    colorShift: colors.length > 1,
    ...effect
  };
}

export function validateGuardPaintProduct(product) {
  if (product.options?.length !== 2 || !Array.isArray(product.variants) || !product.variants.length
    || product.options.some((option, index) => !Array.isArray(option.values) || !option.values.length
      || option.values.some((value) => !Object.hasOwn(index === 0 ? paintColors : paintEffects, value)))) {
    throw new Error('Invalid or unsupported paint color/effect options. Please retry the catalog.');
  }
  for (const variant of product.variants) {
    guardPaint(variant);
    if (!product.options[0].values.includes(variant.option1) || !product.options[1].values.includes(variant.option2)) {
      throw new Error('Inconsistent paint color/effect options. Please retry the catalog.');
    }
  }
}

export function guardPaintMaterial(finish) {
  const material = new THREE.MeshPhysicalMaterial({
    color: finish.color,
    metalness: finish.colorName === 'Silver' ? 0.65 : 0.18,
    roughness: 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.16
  });
  material.userData.paintFinish = finish;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      guardColor: { value: new THREE.Color(finish.color) },
      guardShiftColor: { value: new THREE.Color(finish.shiftColor) },
      guardColorShift: { value: Number(finish.colorShift) },
      guardFade: { value: finish.fade },
      guardSparkle: { value: Number(finish.sparkle) }
    });
    shader.vertexShader = `attribute float guardAlong;\nvarying float vGuardAlong;\nvarying vec3 vGuardPosition;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGuardPosition = position;\nvGuardAlong = guardAlong;');
    shader.fragmentShader = `
      varying vec3 vGuardPosition;
      varying float vGuardAlong;
      uniform vec3 guardColor;
      uniform vec3 guardShiftColor;
      uniform float guardColorShift;
      uniform float guardFade;
      uniform float guardSparkle;
      ${shader.fragmentShader}
    `.replace('#include <normal_fragment_begin>', `
      #include <normal_fragment_begin>
      float guardFacing = abs(dot(normal, normalize(vViewPosition)));
      vec3 guardPaintColor = mix(guardColor, guardShiftColor, pow(1.0 - guardFacing, 0.8) * guardColorShift);
      float guardEnds = abs(2.0 * clamp(vGuardAlong, 0.0, 1.0) - 1.0);
      float guardColorAmount = guardFade < 0.5 ? 1.0
        : smoothstep(0.08, 0.75, guardFade < 1.5 ? guardEnds : 1.0 - guardEnds);
      diffuseColor.rgb = mix(vec3(0.007, 0.007, 0.009), guardPaintColor, guardColorAmount);
      vec3 guardCell = floor(vGuardPosition * 1600.0);
      float guardFlake = fract(sin(dot(guardCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      float guardGlint = smoothstep(0.985, 0.999, guardFlake)
        * pow(max(0.0, sin(guardFacing * 28.0 + guardFlake * 20.0)), 12.0) * guardSparkle;
      vec3 guardRainbow = 0.65 + 0.35 * cos(vec3(0.0, 2.094, 4.188) + guardFlake * 6.283 + guardFacing * 8.0);
      diffuseColor.rgb += guardRainbow * guardGlint * 0.7;
    `);
  };
  material.customProgramCacheKey = () => '79mods-guard-paint-v2';
  return material;
}
