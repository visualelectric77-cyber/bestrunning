# three.js vendorizado

- **Versión:** three@0.186.1 (registro npm, publicada el 2026-09-24). Licencia MIT (ver `LICENSE`).
- **Uso:** escena 3D HYPERTRACK del reproductor (`js/player/scene3d.js`). Sin CDN ni import map: todo local.

## Contenido

| Archivo | Origen |
|---|---|
| `build/three.module.min.js` | `build/three.module.js` + `build/three.core.js` del paquete npm, empaquetados en un único ES module y minificados con esbuild 0.28.2 (`--bundle --format=esm --minify --legal-comments=inline --target=es2020`). El paquete npm de r186 ya no trae `three.module.min.js`; este archivo es equivalente. |
| `examples/jsm/postprocessing/{EffectComposer,RenderPass,ShaderPass,UnrealBloomPass,OutputPass,MaskPass,Pass}.js` | Copia literal del paquete. |
| `examples/jsm/shaders/{CopyShader,LuminosityHighPassShader,OutputShader}.js` | Copia literal del paquete. |

Única modificación en los addons: `from 'three'` → `from '../../../build/three.module.min.js'`.

## Actualizar

```sh
npm pack three@<versión>            # en un directorio temporal
tar -xzf three-<versión>.tgz
npx esbuild package/build/three.module.js --bundle --format=esm --minify \
  --legal-comments=inline --target=es2020 --outfile=js/vendor/three/build/three.module.min.js
# copiar los addons de arriba y reescribir los imports de 'three'
```
