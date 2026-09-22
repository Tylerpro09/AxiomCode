# Axiom IntelliCode

Autocompletado inteligente **original de AxiomCode**, creado desde cero.

No contiene código ni modelos de Visual Studio IntelliCode de Microsoft.

## Qué hace

- Aprende de los archivos que tienes abiertos.
- Usa contexto de 1 y 2 tokens (modelo n-gram local).
- Indexa símbolos y frecuencia de uso.
- Añade plantillas inteligentes por lenguaje.
- Ofrece sugerencias normales de IntelliSense y ghost text inline.
- Reentrena en segundo plano cuando editas código.
- Funciona completamente local.
- Sin cuentas, nube, API keys ni telemetría.

## Lenguajes iniciales

JavaScript, TypeScript, Python, Java, C, C++, C#, Go, Rust, PHP, HTML, CSS/SCSS, JSON, SQL, Shell, PowerShell y Lua.

## Rendimiento

El motor está limitado deliberadamente para PCs modestos:

- hasta 384 KiB por modelo abierto,
- hasta 2 MiB de corpus total,
- hasta 20.000 contextos,
- hasta 12.000 símbolos,
- máximo 16 modelos abiertos por reconstrucción.

La extensión vive en el repositorio y se instala desde AxiomCode Marketplace; no forma parte del Setup principal.

## Arquitectura de extensión

La extensión se instala desde `extensions/intellicode` mediante AxiomCode Marketplace. El editor no contiene lógica específica de IntelliCode: solo expone el cargador genérico `contributes.rendererRuntime`. El manifiesto declara `runtime.js` y el runtime registra sus sugerencias y comandos al activarse.

El Setup de AxiomCode no incluye esta carpeta ni sus archivos.
