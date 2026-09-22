# Axiom IntelliCode

Axiom IntelliCode es el motor de autocompletado original de AxiomCode. Combina aprendizaje local del proyecto con asistencia IA opcional de **Victorsia Free**.

No contiene código, modelos ni binarios de Visual Studio IntelliCode de Microsoft.

## Versión 1.3.0

El motor local mantiene:

- índice multiarchivo del workspace;
- modelo n-gram local de 1, 2 y 3 tokens;
- ranking por alcance cercano al cursor;
- mayor peso para el archivo activo y el código reciente;
- símbolos por lenguaje y tipo;
- miembros después de `.`, `?.`, `::` y `->`;
- ghost text local;
- fuzzy matching y camelCase;
- perfiles de memoria ligero, equilibrado y alto;
- caché compacta que no guarda el código fuente completo.

## IA con Victorsia Free

La IA remota es opcional y usa:

```
https://api.victors.qzz.io/v1
```

Antes de generar código, la extensión consulta `GET /models` y selecciona únicamente un identificador completo devuelto por la API. Por defecto prefiere `auto:coding` cuando está disponible.

Las generaciones usan `POST /chat/completions`.

Funciones IA:

- completar código en el cursor;
- explicar una selección;
- corregir y reemplazar una selección;
- ghost text remoto opcional como respaldo del motor local;
- cambiar el modelo devuelto por `/models`;
- diagnóstico de la última solicitud;
- olvidar la API key de la sesión.

## Privacidad y API key

La API key **no forma parte del repositorio, del Setup ni del catálogo de Marketplace**.

La extensión solicita la clave mediante un campo de contraseña y la mantiene únicamente en memoria durante la ejecución. No se escribe en archivos, configuración, Marketplace ni logs; desaparece al descargar la extensión o cerrar el editor.

No se escriben en logs:

- API keys;
- prompts completos;
- respuestas completas.

Los logs de diagnóstico contienen solo metadatos operativos como estado HTTP, modelo, request ID y tiempos.

Cuando se usa una función IA, el fragmento de código necesario para esa operación se envía al proveedor externo. El motor local continúa funcionando sin IA y sin enviar código fuera del equipo.

## Telemetría de solicitudes

Cada solicitud genera un `X-Request-ID` nuevo mediante Web Crypto.

Cuando el proveedor los devuelve, la extensión registra para diagnóstico:

- `X-Request-ID`;
- `X-Response-Time-Ms`;
- `X-RateLimit-Limit`;
- `X-RateLimit-Remaining`;
- `X-RateLimit-Reset`;
- `X-RateLimit-Policy`;
- `X-Local-Request-Interval-Seconds`;
- `prompt_tokens`;
- `completion_tokens`;
- `total_tokens`.

Un `429` respeta el tiempo de espera informado y reintenta una vez. Un `401` solicita revisar la API key. Un `503` se informa como proveedor offline.

## Comandos

### Motor local

- **Axiom IntelliCode: Estado**
- **Axiom IntelliCode: Reindexar proyecto**
- **Axiom IntelliCode: Activar/Pausar**
- **Axiom IntelliCode: Limpiar y reconstruir aprendizaje**
- **Axiom IntelliCode: Cambiar perfil de memoria**
- **Axiom IntelliCode: Activar/Desactivar índice de proyecto**

### IA

- **Axiom IntelliCode IA: Configurar Victorsia Free**
- **Axiom IntelliCode IA: Cambiar modelo**
- **Axiom IntelliCode IA: Completar en cursor**
- **Axiom IntelliCode IA: Explicar selección**
- **Axiom IntelliCode IA: Corregir selección**
- **Axiom IntelliCode IA: Activar/Desactivar ghost text remoto**
- **Axiom IntelliCode IA: Diagnóstico de última solicitud**
- **Axiom IntelliCode IA: Olvidar API key de la sesión**

## Arquitectura

Axiom IntelliCode sigue siendo una extensión 100% de repositorio:

```
extensions/intellicode/
├─ extension.json
├─ runtime.js
└─ README.md
```

AxiomCode no contiene lógica específica de Victorsia ni de IntelliCode. El programa expone el cargador genérico `contributes.rendererRuntime` y una API HTTPS genérica con permisos por host para cualquier extensión. Axiom IntelliCode declara únicamente `api.victors.qzz.io` como host de red permitido.

La extensión se descarga desde AxiomCode Marketplace y se instala en el directorio de extensiones del usuario. El Setup de AxiomCode no incluye esta carpeta ni sus archivos.
