# Axiom IntelliCode

Autocompletado inteligente **original de AxiomCode**, creado desde cero.

No contiene código, modelos ni binarios de Visual Studio IntelliCode de Microsoft.

## Versión 1.1.0

La extensión ahora combina varias fuentes locales de contexto:

- índice del proyecto completo, no solo los archivos abiertos;
- modelo n-gram local de 1, 2 y 3 tokens;
- símbolos por lenguaje y tipo (clases, funciones, variables, etc.);
- aprendizaje de miembros después de `.`, `?.`, `::` y `->`;
- mayor peso para el archivo actualmente abierto;
- ghost text basado en líneas aprendidas y contexto local;
- fuzzy matching y coincidencia camelCase;
- plantillas específicas por lenguaje;
- caché local compacta de símbolos, sin guardar el código fuente completo;
- perfil de memoria adaptativo según el hardware;
- reindexación manual, pausa/activación y limpieza del aprendizaje.

Todo funciona localmente. No usa nube, API keys ni telemetría.

## Indexación del proyecto

Cuando abres un workspace, Axiom IntelliCode recorre archivos fuente compatibles evitando carpetas pesadas como:

`.git`, `node_modules`, `vendor`, `dist`, `build`, `target`, `.venv`, `coverage` y otras similares.

Perfiles aproximados:

- **Ligero:** hasta 28 archivos / 1.5 MiB de corpus.
- **Equilibrado:** hasta 64 archivos / 4 MiB.
- **Alto:** hasta 96 archivos / 6 MiB.

Los archivos abiertos se mantienen en un índice separado y reciben mayor peso para que las sugerencias respondan a lo que estás editando ahora.

## Lenguajes

JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Rust, PHP, HTML, CSS, SCSS, JSON, SQL, Shell, PowerShell, Lua, YAML, XML, Markdown y Batch/CMD.

## Comandos

- **Axiom IntelliCode: Estado**
- **Axiom IntelliCode: Reindexar proyecto**
- **Axiom IntelliCode: Activar/Pausar**
- **Axiom IntelliCode: Limpiar y reconstruir aprendizaje**

## Arquitectura

Axiom IntelliCode sigue siendo una extensión 100% de repositorio:

```
extensions/intellicode/
├─ extension.json
├─ runtime.js
└─ README.md
```

AxiomCode no contiene lógica específica de IntelliCode. El editor solo expone el cargador genérico `contributes.rendererRuntime`.

La extensión se descarga desde AxiomCode Marketplace y se instala en el directorio de extensiones del usuario. El Setup de AxiomCode no incluye esta carpeta ni sus archivos.
