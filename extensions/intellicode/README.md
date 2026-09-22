# Axiom IntelliCode

Autocompletado inteligente **original de AxiomCode**, creado desde cero.

No contiene código, modelos ni binarios de Visual Studio IntelliCode de Microsoft.

## Versión 1.2.0

Axiom IntelliCode combina aprendizaje local del proyecto con el contexto del archivo activo:

- índice multiarchivo del workspace;
- modelo n-gram local de 1, 2 y 3 tokens;
- ranking adicional por alcance cercano al cursor;
- mayor peso para el archivo activo y para el código escrito recientemente;
- aprendizaje de símbolos por lenguaje y tipo;
- miembros después de `.`, `?.`, `::` y `->`;
- ghost text por línea aprendida y por siguiente línea probable;
- fuzzy matching y coincidencia camelCase;
- plantillas específicas por lenguaje;
- caché compacta de símbolos que no almacena el código fuente completo;
- exclusión de lockfiles, bundles, archivos minificados y carpetas generadas;
- perfil de memoria automático o seleccionable;
- índice de proyecto opcional para equipos extremadamente limitados.

Todo funciona localmente. No usa nube, API keys ni telemetría.

## Perfiles de rendimiento

- **Ligero:** hasta 28 archivos / 1.5 MiB de corpus / concurrencia baja.
- **Equilibrado:** hasta 64 archivos / 4 MiB.
- **Alto:** hasta 96 archivos / 6 MiB.

El modo automático usa la memoria aproximada expuesta por Chromium para escoger un perfil. También puede cambiarse manualmente desde la paleta de comandos.

## Indexación inteligente

Se omiten carpetas y archivos que normalmente añaden ruido o consumo innecesario:

`.git`, `node_modules`, `vendor`, `dist`, `build`, `target`, `.venv`, `coverage`, lockfiles, sourcemaps, bundles, archivos minificados y generados.

Los archivos de entrada comunes como `index.*`, `main.*`, `app.*`, `server.*` y `core.*` reciben prioridad.

## Lenguajes

JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Rust, PHP, HTML, CSS, SCSS, JSON, SQL, Shell, PowerShell, Lua, YAML, XML, Markdown y Batch/CMD.

## Comandos

- **Axiom IntelliCode: Estado**
- **Axiom IntelliCode: Reindexar proyecto**
- **Axiom IntelliCode: Activar/Pausar**
- **Axiom IntelliCode: Limpiar y reconstruir aprendizaje**
- **Axiom IntelliCode: Cambiar perfil de memoria**
- **Axiom IntelliCode: Activar/Desactivar índice de proyecto**

## Arquitectura

Axiom IntelliCode es una extensión 100% de repositorio:

```
extensions/intellicode/
├─ extension.json
├─ runtime.js
└─ README.md
```

AxiomCode no contiene lógica específica de IntelliCode. El editor solo expone el cargador genérico `contributes.rendererRuntime`.

La extensión se descarga desde AxiomCode Marketplace y se instala en el directorio de extensiones del usuario. El Setup de AxiomCode no incluye esta carpeta ni sus archivos.
