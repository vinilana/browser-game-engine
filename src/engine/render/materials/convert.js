import { Color, SRGBColorSpace } from 'three';
import { GBufferMaterial } from './GBufferMaterial.js';

/**
 * Converts the standard three.js materials of an object hierarchy (e.g. a
 * loaded GLTF scene) into deferred G-buffer materials so they are lit by the
 * Aether pipeline (sun/sky/shadows/SSAO/fog). Optionally registers every mesh
 * as a shadow caster.
 *
 * @param {import('three').Object3D} root
 * @param {import('../RenderPipeline.js').RenderPipeline} [pipeline]
 * @param {{castShadow?: boolean}} [opts]
 */
export function convertToGBuffer(root, pipeline, { castShadow = true } = {}) {
  const cache = new Map();
  const convert = (m) => {
    if (!m || m.isGBufferMaterial) return m;
    if (cache.has(m)) return cache.get(m);
    const map = m.map || null;
    if (map) map.colorSpace = SRGBColorSpace;
    const emissive = m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0 ? (m.emissiveIntensity ?? 1) * 2 : 0;
    const g = new GBufferMaterial({
      color: m.color ? m.color.clone() : new Color(1, 1, 1),
      map,
      roughness: m.roughness ?? 0.8,
      metalness: m.metalness ?? 0,
      emissive,
      vertexColors: !!m.vertexColors,
      side: m.side,
      alphaTest: m.alphaTest || (m.transparent ? 0.5 : 0),
    });
    g.isGBufferMaterial = true;
    cache.set(m, g);
    return g;
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
    if (castShadow && pipeline) pipeline.addShadowCaster(o);
  });
  return root;
}
