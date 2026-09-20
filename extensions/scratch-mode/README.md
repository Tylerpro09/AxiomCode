# Modo Scratch para AxiomCode

AxiomCode integra el editor Scratch 3 oficial y abre proyectos `.sb3` desde **Ver → Modo Scratch (bloques)** o desde el botón de bloques de la barra lateral.

## Versión 2.3.0

Esta versión amplía los límites internos y añade más capacidades a Axiom 3D.

### Proyectos

- Proyectos `.sb3` de hasta **512 MiB**.
- Proyectos legacy `.axiomscratch` de hasta **100 MiB**.
- Hasta **50.000 bloques** en el modo legacy.
- Profundidad de bloques anidados de hasta **64 niveles**.
- Hasta **1.000.000 de pasos de ejecución** antes del corte de seguridad.
- Repeticiones de hasta **100.000** por bloque.
- Esperas de hasta **3.600 segundos**.
- Textos de hasta **20.000 caracteres**.
- Coordenadas legacy de hasta ±1.000.000.

Los límites siguen existiendo para impedir que un proyecto accidentalmente bloquee Electron o consuma memoria sin control.

## Axiom 3D

La categoría **Axiom 3D** se registra automáticamente dentro del Scratch oficial. Renderiza con WebGL sobre el escenario de Scratch y se puede combinar con sprites 2D normales.

### Capacidad

- Hasta **4.096 objetos 3D** simultáneos.
- Escalas de hasta **1.000.000**.
- Coordenadas de hasta ±1.000.000.
- Distancia de renderizado ampliada.

### Bloques disponibles

- Reiniciar, mostrar u ocultar la escena 3D.
- Crear cubos y esferas.
- Posicionar y mover objetos en X, Y y Z.
- Rotar objetos por los tres ejes.
- Cambiar escala y color.
- Cambiar opacidad.
- Mostrar u ocultar objetos individuales.
- Duplicar objetos.
- Eliminar un objeto o grupos por prefijo.
- Posicionar la cámara y elegir el punto al que mira.
- Orbitar la cámara con radio, yaw y pitch.
- Cambiar campo de visión.
- Configurar color/opacidad del fondo 3D.
- Consultar posición, rotación y escala por eje.
- Comprobar si un objeto existe.
- Consultar distancia entre objetos.
- Asignar y modificar velocidad X/Y/Z.
- Configurar multiplicador de gravedad por objeto.
- Simular física con delta de tiempo, gravedad, suelo y rebote.
- Mover un objeto hacia otro objetivo.
- Detectar contacto/proximidad entre dos objetos.
- Consultar velocidad por eje.
- Cámara siguiendo un objeto con offset configurable.
- Movimiento con colisiones por prefijo.
- Comprobación de meta.
- Consultar cantidad de objetos y disponibilidad de WebGL.

La cámara empieza en **(0, 0, 8)** mirando al origen. Los proyectos que usan bloques Axiom 3D se guardan como `.sb3`; al volver a abrirlos en AxiomCode, la extensión se registra antes de cargar el proyecto para que los bloques 3D sigan disponibles.

## Actualizaciones

Modo Scratch es una extensión incluida con AxiomCode. Cuando la marketplace detecta una versión de Scratch superior a la instalada, aparece el botón **Actualizar** en la vista de Extensiones. Si esa versión viene incluida en una nueva versión de AxiomCode, el botón enlaza con el actualizador integrado del editor para descargar e instalar la Release correspondiente.

## Compatibilidad

El modo oficial conserva bloques, disfraces, sonidos, sprites, extensiones oficiales y guardado/reapertura `.sb3`. El editor legacy `.axiomscratch` continúa incluido por compatibilidad.