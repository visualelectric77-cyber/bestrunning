// RITMUP · kit de los escenarios REALISTAS · EL CAMINO QUE SERPENTEA. El mundo se sigue construyendo recto (tú en el
// origen, el camino hacia −z: las hileras periódicas de farolas, postes y sombras no cambian) y se CURVA al dibujarlo:
// cada vértice se desplaza de lado según lo lejos que está, con una curva procedural que no se repite (suma de tres
// ondas de periodos sin relación entre sí). Donde tú pisas el camino siempre sale recto hacia delante; por delante
// gira a un lado y a otro, y al avanzar el mundo entero rota alrededor de ti como cuando tomas una curva de verdad.
//   · rumbo del camino a s metros de recorrido:      θ(s) = Σ aᵢ · sen(s / Lᵢ + φᵢ)            (rad, pequeño)
//   · desplazamiento lateral a srel m por delante:   g = f(S + srel) − f(S) − θ(S) · srel,     f = ∫θ
// El escenario gira el cielo, el entorno y el sol con bend.heading (rumbo en tu posición): la luz cambia de lado al
// tomar las curvas. Todo lo que se calcule «en el espacio del camino» (x = distancia al eje, z = −metros por delante)
// usa la posición SIN curvar; lo que dependa de la vista, la posición curvada (x + bendX(z)).
// Sin coste apreciable: 3 cosenos por vértice.

const TAU = Math.PI * 2;

/**
 * @param {object} ctx
 * @param {object} [o]  waves: [[amplitud (rad), L (m; periodo = 2πL), fase], ×3]
 */
export function createBend(ctx, { waves = [[0.16, 92, 2.6], [0.07, 39, 0.4], [0.11, 236, 5.3]] } = {}) {
  const { THREE } = ctx;
  const A = waves.map((w) => w[0]);
  const L = waves.map((w) => w[1]);
  const PH = waves.map((w) => w[2]);
  const u = { uBend: { value: new THREE.Vector4(PH[0], PH[1], PH[2], 0) } };
  const f3 = (v) => v.map((x) => x.toFixed(6)).join(', ');
  const glsl = /* glsl */ `
uniform vec4 uBend;   // xyz fase de cada onda donde estás tú, w tu rumbo (rad)
const vec3 BEND_A = vec3(${f3(A)});
const vec3 BEND_IL = vec3(${f3(L.map((x) => 1 / x))});
const vec3 BEND_AL = vec3(${f3(A.map((a, i) => a * L[i]))});
// desplazamiento lateral (m, hacia +x) del camino en z (z = −metros por delante)
float bendX(float z) {
  return dot(BEND_AL, cos(uBend.xyz) - cos(uBend.xyz - z * BEND_IL)) + uBend.w * z;
}
// cuánto ha girado el camino en z respecto a donde estás (rad; + = hacia la derecha)
float bendTurn(float z) {
  return dot(BEND_A, sin(uBend.xyz - z * BEND_IL)) - uBend.w;
}
`;
  const ph = [0, 0, 0];
  const bend = {
    u, glsl,
    /** Rumbo del camino donde estás (rad; + = girado a la derecha). */
    heading: 0,
    /** Cada fotograma, con los metros recorridos. */
    update(S) {
      let h = 0;
      for (let i = 0; i < 3; i++) {
        ph[i] = ((S / L[i] + PH[i]) % TAU + TAU) % TAU;
        h += A[i] * Math.sin(ph[i]);
      }
      u.uBend.value.set(ph[0], ph[1], ph[2], h);
      bend.heading = h;
      return h;
    },
    /** Desplazamiento lateral (m) a z (z = −metros por delante), con el estado del último update. */
    xAt(z) {
      let x = bend.heading * z;
      for (let i = 0; i < 3; i++) x += A[i] * L[i] * (Math.cos(ph[i]) - Math.cos(ph[i] - z / L[i]));
      return x;
    },
    /** Giro del camino en z respecto a donde estás (rad). */
    turnAt(z) {
      let t = -bend.heading;
      for (let i = 0; i < 3; i++) t += A[i] * Math.sin(ph[i] - z / L[i]);
      return t;
    },
    /**
     * Curva un material de three.js (Standard, Basic…): mueve el vértice y corrige la normal. Las variables propias
     * que otros trozos calculan con `transformed` (vLampW, vStreakW…) quedan en el espacio del camino, sin curvar.
     * Deja bendX / bendTurn disponibles también en el fragmento. LLAMAR EL ÚLTIMO (después de addLamps / addStreaks):
     * amplía la clave del programa.
     */
    apply(mat) {
      const prev = mat.onBeforeCompile;
      const prevKey = mat.customProgramCacheKey;
      mat.onBeforeCompile = (sh, r) => {
        prev?.call(mat, sh, r);
        sh.uniforms.uBend = u.uBend;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>\n${glsl}`)
          .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 bw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
    bw = instanceMatrix * bw;
    #endif
    bw = modelMatrix * bw;
    mvPosition.xyz += viewMatrix[0].xyz * bendX(bw.z);
    gl_Position = projectionMatrix * mvPosition;
    #ifndef FLAT_SHADED
    vec3 bn = inverseTransformDirection(vNormal, viewMatrix);
    bn.z += bn.x * bendTurn(bw.z);
    vNormal = normalize((viewMatrix * vec4(bn, 0.0)).xyz);
    #endif
  }`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${glsl}`);
      };
      mat.customProgramCacheKey = () => `${prevKey ? prevKey.call(mat) : ''}|bend`;
      mat.needsUpdate = true;
      return mat;
    },
  };
  bend.update(0);
  return bend;
}
