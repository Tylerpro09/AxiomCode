# Modo Scratch para AxiomCode

AxiomCode integra Scratch 3 oficial y abre proyectos `.sb3` desde **Ver → Modo Scratch (bloques)** o desde el botón de Scratch de la barra lateral.

## Scratch 2.4.1 · Power Mode

Esta versión convierte Modo Scratch en un entorno mucho más abierto para juegos, simulaciones, herramientas educativas y aplicaciones visuales.

### Capacidad de proyectos

- Proyectos `.sb3` de hasta **512 MiB**.
- Proyectos legacy `.axiomscratch` de hasta **100 MiB**.
- Hasta **50.000 bloques** en el modo legacy.
- Hasta **64 niveles** de anidación.
- Hasta **1.000.000 de pasos** antes del corte anti-loop.
- Repeticiones de hasta **100.000**.
- Esperas de hasta **3.600 segundos**.
- Textos de hasta **20.000 caracteres**.
- Motor legacy iterativo optimizado para proyectos grandes.

## Axiom 3D

Axiom 3D renderiza WebGL sobre el escenario Scratch.

- Hasta **4.096 objetos 3D**.
- Cubos y esferas.
- Posición, rotación y escala X/Y/Z.
- Coordenadas de hasta ±1.000.000.
- Visibilidad, color y opacidad.
- Duplicado de objetos.
- Eliminación individual o por prefijo.
- Cámara libre, cámara orbital y cámara siguiendo objetos.
- Velocidad X/Y/Z por objeto.
- Gravedad configurable por objeto.
- Física por pasos con delta de tiempo, suelo y rebote.
- Movimiento hacia objetivos.
- Detección de proximidad/contacto.
- Colisiones por prefijo y metas.
- Reporteros de posición, rotación, escala, velocidad y distancia.

## Axiom Power

La categoría **Axiom Power** añade capacidades fuera del Scratch tradicional.

### Web

- `web GET [URL]`
- `web POST [URL] texto [BODY]`
- Estado HTTP y URL final.
- Abrir enlaces en el navegador con confirmación.

Las peticiones del puente privilegiado aceptan solo **HTTPS** y bloquean direcciones locales/privadas para evitar que un proyecto explore la red interna del equipo.

### JSON y datos

- Leer una ruta dentro de JSON.
- Modificar una ruta JSON.
- Validar JSON.
- Codificar/decodificar URL.
- Base64 UTF-8.
- SHA-256.

### Almacenamiento persistente

- Guardar valor por clave.
- Leer valor por clave.
- Borrar clave.
- Enumerar claves.

El almacén Axiom Power tiene un límite de seguridad de **10 MiB**.

### Archivos y portapapeles

- Elegir y leer un archivo de texto mediante diálogo.
- Guardar texto mediante diálogo.
- Guardar captura PNG del escenario.
- Copiar texto al portapapeles.
- Leer portapapeles con autorización explícita del usuario.

Un proyecto Scratch no obtiene acceso libre al disco: las operaciones de archivo pasan por un selector visible para el usuario.

### Sistema y dispositivos

- Información del sistema operativo, arquitectura, CPU, memoria, idioma y versión de AxiomCode.
- Notificaciones del sistema.
- Texto a voz.
- Gamepad: ejes y botones.
- Estado online.
- Ancho, alto y pixel ratio de la vista.
- Fecha/hora ISO.
- Tiempo Unix en milisegundos.
- UUID.

## Extensiones JavaScript locales

Power Mode permite añadir categorías y bloques propios sin recompilar AxiomCode.

En la barra superior de Scratch pulsa **Extensión JS** y selecciona manualmente un archivo `.js`.

El JavaScript se ejecuta dentro del iframe Scratch aislado. No recibe acceso directo a Node.js, terminal ni al sistema de archivos. Para operaciones privilegiadas puede usar las funciones controladas de **Axiom Power**.

Ejemplo incluido:

`extensions/scratch-mode/examples/hola-axiom.js`

Formato mínimo:

```js
class MiExtension {
  getInfo() {
    return {
      id: 'miextension',
      name: 'Mi extensión',
      blocks: [
        {
          opcode: 'hola',
          blockType: 'reporter',
          text: 'hola [NOMBRE]',
          arguments: {
            NOMBRE: {type: 'string', defaultValue: 'mundo'}
          }
        }
      ]
    };
  }

  hola(args) {
    return 'Hola ' + args.NOMBRE;
  }
}

module.exports = MiExtension;
```

También puede registrarse directamente:

```js
AxiomScratchSDK.register(miObjetoExtension);
```

Y puede usar el puente controlado:

```js
await AxiomScratchSDK.power('storageSet', {
  key: 'nivel',
  value: '8'
});
```

### Seguridad del SDK

Los archivos JavaScript locales solo se cargan cuando el usuario pulsa **Extensión JS** y elige el archivo. Antes de ejecutarse pasan por **AxiomGuard**, que bloquea indicadores críticos de malware, scripts del sistema y loaders peligrosos. El código no se incrusta ni se autoejecuta al abrir un `.sb3`.

Esto permite crear bloques muy avanzados sin convertir un proyecto Scratch recibido de Internet en ejecución automática de código del sistema.

## Actualizaciones

Modo Scratch viene incluido con AxiomCode. Si la Marketplace publica una versión superior, la vista de Extensiones muestra **Actualizar**. Si esa versión requiere una nueva versión de AxiomCode, el botón enlaza con el actualizador integrado del editor.

## Compatibilidad

El modo oficial conserva bloques, sprites, disfraces, sonidos, variables, listas, extensiones oficiales y guardado/reapertura `.sb3`. El modo legacy `.axiomscratch` sigue disponible por compatibilidad.
