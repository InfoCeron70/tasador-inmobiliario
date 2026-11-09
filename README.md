# Asistente de Tasación Inmobiliaria

**Estimador de tasación de propiedades en Chile asistido por IA**, con historial de tasaciones persistido en SQLite.

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D%2020.17-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-CDN-38BDF8?logo=tailwindcss&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3.x-003B57?logo=sqlite&logoColor=white)
![DeepSeek](https://img.shields.io/badge/IA-DeepSeek-4D6BFE)
![Licencia](https://img.shields.io/badge/licencia-MIT-green)

**Versión:** 1.2.0

---

## ¿Qué hace?

Aplicación web que recibe los datos de un inmueble (comuna, tipo, superficie, dormitorios, antigüedad, etc.)
junto con **2 a 5 propiedades comparables de mercado**, y devuelve una **tasación referencial en pesos chilenos (CLP)**
generada por un modelo de lenguaje de **DeepSeek**:

- Valor de referencia estimado y **rango** (mínimo / máximo).
- **Valor por m²** calculado y justificado.
- Tabla de **comparables ajustados** con su factor de ajuste (0,85 – 1,15).
- **Factores de ajuste** aplicados (superficie, ubicación, estado, etc.).
- **Advertencias** y supuestos declarados por el modelo.

Además, cada tasación exitosa se **guarda automáticamente** en una base **SQLite** y puede consultarse
desde la sección *Ver Historial* de la interfaz o vía API.

El resultado también puede **descargarse como PDF o Excel** con un clic: el informe incluye los datos
del inmueble, el valor de referencia destacado, el rango, la tabla de comparables analizados, los
factores de ajuste y las advertencias. Los archivos se generan **en memoria** (nunca en disco) y se
envían como descarga.

## Stack

| Capa | Tecnología |
|---|---|
| **Backend** | Node.js + Express 4 (`server.js`, `src/`) |
| **Base de datos** | SQLite (`sqlite3`) — archivo local `tasaciones.db` |
| **IA** | API de DeepSeek (`/chat/completions`, `response_format: json_object`) |
| **Exportación** | `exceljs` (.xlsx) y `pdfkit` (.pdf) — generados en memoria como `Buffer` |
| **Frontend** | HTML5 + JavaScript vanilla + **Tailwind CSS** (CDN) |

## Requisitos previos

- **Node.js >= 20.17** (requisito de `sqlite3@6`; el proyecto se probó con Node 24). Verifica con:
  ```bash
  node -v
  npm -v
  ```
- **API key de DeepSeek** — se obtiene en <https://platform.deepseek.com>.
- **npm** (incluido con Node.js).
- *(Solo Windows, si no hay binario precompilado)* herramientas de compilación para módulos nativos:
  `npm install --global windows-build-tools` o Visual Studio Build Tools + Python. Normalmente **no es necesario**.

## Instalación y ejecución local

```bash
# 1) Clonar el repositorio
git clone https://github.com/InfoCeron70/P2_DS_TASACIONES.git
cd P2_DS_TASACIONES

# 2) Instalar dependencias
npm install

# 3) Crear el archivo de variables de entorno a partir de la plantilla
#    Windows (PowerShell)
Copy-Item .env.example .env
#    Linux / macOS
cp .env.example .env
```

4) Abrir `.env` y completar la clave real:

```ini
DEEPSEEK_API_KEY=sk-tu-clave-real-aqui
```

```bash
# 5) Arrancar el servidor
npm start
```

La aplicación queda disponible en **<http://localhost:3000>**.
La base de datos `tasaciones.db` se crea automáticamente en la raíz del proyecto la primera vez que se usa.

> Para detener el servidor: `Ctrl + C` (cierra el servidor HTTP y la conexión SQLite de forma ordenada).

## Variables de entorno

Todas son **opcionales** salvo `DEEPSEEK_API_KEY` (el código aplica los valores por defecto indicados).

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor HTTP. |
| `DEEPSEEK_API_KEY` | — | **Obligatoria.** Clave de la API de DeepSeek. |
| `DEEPSEEK_API_URL` | `https://api.deepseek.com/chat/completions` | Endpoint de chat completions. |
| `DEEPSEEK_MODEL` | `deepseek-flash` | Modelo a utilizar (`deepseek-chat`, `deepseek-reasoner`, …). |
| `DEEPSEEK_TIMEOUT_MS` | `120000` | Timeout por llamada (ms). Las respuestas largas pueden tardar ~50 s. |
| `DEEPSEEK_MAX_TOKENS` | `8192` | Presupuesto de tokens de salida. **No bajar de 8192**: en modelos con razonamiento los *tokens de pensamiento* consumen este mismo presupuesto. |
| `DEEPSEEK_MAX_TOKENS_LIMITE` | `32768` | Tope al que se puede ampliar `max_tokens` si la respuesta se trunca. |
| `DEEPSEEK_MAX_INTENTOS` | `3` | Reintentos por tasación (cubre respuestas vacías o truncadas). |
| `DEBUG_DEEPSEEK` | *(vacío)* | `1` imprime en consola el contenido crudo devuelto por el modelo (diagnóstico). |
| `DB_PATH` | `./tasaciones.db` | Ruta alternativa del archivo SQLite. |

> ⚠️ **Nunca** subas el archivo `.env` al repositorio: contiene la API key. Ya está incluido en `.gitignore`.

## Endpoints disponibles

### `POST /api/tasacion`

Calcula la tasación de una propiedad y la guarda en el historial.

**Cuerpo de la petición** (`application/json`):

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `comuna` | `string` | ✅ | Comuna de la propiedad (ej. `Providencia`). |
| `tipoPropiedad` | `string` | ✅ | `casa`, `departamento`, `oficina`, `terreno`, `local`, `industrial`, `otro`. |
| `superficieUtil` | `number` | ✅ | Superficie útil en m² (mayor que 0). |
| `comparables` | `array` | ✅ | Entre **2 y 5** propiedades de referencia. |
| `direccion` | `string` | — | Dirección de la propiedad. |
| `dormitorios` / `banos` / `estacionamientos` | `number` | — | Cantidad (mayor o igual a 0). |
| `anioConstruccion` | `number` | — | Año de construcción (desde 1800). |
| `antiguedad` | `number` | — | Antigüedad en años. |
| `precioReferencia` | `number` | — | Precio de referencia en CLP para comparar con la estimación. |
| `estadoConservacion` | `string` | — | `nuevo`, `excelente`, `bueno`, `regular`, `a refaccionar`. |
| `observaciones` | `string` | — | Comentarios libres. |

Cada elemento de `comparables`:

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `superficieM2` | `number` | ✅ | Superficie del comparable en m². |
| `precio` | `number` | ✅ | Precio en CLP. |
| `distanciaKm` | `number` | — | Distancia a la propiedad tasada. |
| `nota` | `string` | — | Diferencia o aclaración del comparable. |

**Ejemplo de petición:**

```bash
curl -X POST http://localhost:3000/api/tasacion \
  -H "Content-Type: application/json" \
  -d '{
    "comuna": "Providencia",
    "tipoPropiedad": "departamento",
    "superficieUtil": 85,
    "dormitorios": 3,
    "banos": 2,
    "antiguedad": 12,
    "estadoConservacion": "bueno",
    "precioReferencia": 150000000,
    "comparables": [
      { "superficieM2": 75, "precio": 145000000, "distanciaKm": 0.8 },
      { "superficieM2": 92, "precio": 178000000, "distanciaKm": 1.4 }
    ]
  }'
```

```powershell
# Equivalente en PowerShell
$body = @{
  comuna = 'Providencia'; tipoPropiedad = 'departamento'; superficieUtil = 85
  dormitorios = 3; banos = 2; antiguedad = 12; estadoConservacion = 'bueno'
  precioReferencia = 150000000
  comparables = @(
    @{ superficieM2 = 75; precio = 145000000; distanciaKm = 0.8 },
    @{ superficieM2 = 92; precio = 178000000; distanciaKm = 1.4 }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri http://localhost:3000/api/tasacion -Method Post `
  -ContentType 'application/json' -Body $body
```

**Respuesta `200 OK` (resumida):**

```json
{
  "ok": true,
  "data": {
    "resumen": "Departamento de 85 m² en Providencia con 3 dormitorios...",
    "valorM2": { "calculado": 1891684, "moneda": "CLP", "justificacion": "Promedio ponderado..." },
    "comparables": [
      {
        "referencia": "Comparable 1",
        "comuna": "Providencia",
        "superficieM2": 75,
        "valorM2": 1933333,
        "factorAjuste": 0.96,
        "justificacion": "Ajuste por superficie y distancia."
      }
    ],
    "factoresAjuste": [
      { "factor": "Superficie", "valor": 0.96, "justificacion": "..." }
    ],
    "valorReferencia": 165750000,
    "rango": { "minimo": 157000000, "maximo": 174000000 },
    "advertencias": ["..."]
  },
  "meta": {
    "modelo": "deepseek-flash",
    "uso": { "prompt_tokens": 710, "completion_tokens": 3761, "total_tokens": 4471 },
    "finishReason": "stop",
    "maxTokens": 8192,
    "razonamientoTokens": 2952,
    "reconstruido": false,
    "latenciaMs": 48898,
    "generadoEn": "2026-11-07T04:27:47.802Z",
    "historialId": 1,
    "persistido": true
  }
}
```

> `meta.reconstruido: true` indica que el modelo truncó la respuesta y el JSON se **reconstruyó
> parcialmente**; en ese caso se agrega una advertencia visible en la interfaz.

### `GET /api/tasaciones`

Devuelve el historial de tasaciones guardadas, **de la más reciente a la más antigua**.

| Parámetro (query) | Por defecto | Descripción |
|---|---|---|
| `limite` | `100` | Máximo de registros a devolver (1 – 500). |

```bash
curl "http://localhost:3000/api/tasaciones?limite=20"
```

**Respuesta `200 OK`:**

```json
{
  "ok": true,
  "data": [
    {
      "id": 1,
      "fecha": "2026-11-07T04:27:47.802Z",
      "comuna": "Providencia",
      "tipo": "departamento",
      "superficie": 85,
      "valorReferencia": 165750000,
      "datos": { "data": { "...": "respuesta completa de DeepSeek" }, "meta": { "...": "..." } }
    }
  ],
  "meta": { "total": 1 }
}
```

### `POST /api/exportar/excel`

Genera el informe de la tasación en **Excel (.xlsx)** y lo devuelve como descarga. El archivo se arma
**en memoria** con `exceljs` (no se escribe en el disco del servidor, que en Render es efímero).

**Cuerpo de la petición** (`application/json`):

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `resultado` | `object` | ✅ | Objeto `data` devuelto por `POST /api/tasacion`. |
| `datos` | `object` | — | Datos del inmueble enviados a la tasación (comuna, tipo, superficie…). |
| `meta` | `object` | — | Metadatos de la respuesta (modelo, tokens, `reconstruido`…). |

> También se acepta la forma `{ "data": {...}, "meta": {...} }`, para reenviar tal cual la respuesta de
> `POST /api/tasacion`.

**Respuesta `200 OK`** — archivo binario:

| Cabecera | Valor |
|---|---|
| `Content-Type` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `Content-Disposition` | `attachment; filename="tasacion-<comuna>-<AAAA-MM-DD>.xlsx"` |

Contenido de la hoja *Tasación*: datos del inmueble, valor de referencia, rango, valor por m², conclusión
del tasador, tabla de comparables (superficie, valor m², factor y valor m² ajustado), factores de ajuste
y advertencias.

### `POST /api/exportar/pdf`

Mismo cuerpo y validación que el endpoint de Excel, pero devuelve un **PDF A4** maquetado con `pdfkit`
(encabezado, valor de referencia destacado, tablas con encabezado repetido al cambiar de página y pie con
numeración).

| Cabecera | Valor |
|---|---|
| `Content-Type` | `application/pdf` |
| `Content-Disposition` | `attachment; filename="tasacion-<comuna>-<AAAA-MM-DD>.pdf"` |

```bash
# Ejemplo con curl (body guardado en un archivo JSON)
curl -X POST http://localhost:3000/api/exportar/excel \
  -H "Content-Type: application/json" \
  -d @tasacion.json -o tasacion.xlsx
```

```powershell
# Ejemplo en PowerShell: reutiliza la respuesta de POST /api/tasacion
$exportacion = @{
  datos     = $body | ConvertFrom-Json
  resultado = $respuesta.data
  meta      = $respuesta.meta
} | ConvertTo-Json -Depth 10

Invoke-WebRequest -Uri http://localhost:3000/api/exportar/pdf -Method Post `
  -ContentType 'application/json' -Body $exportacion -OutFile tasacion.pdf
```

> El servidor expone `Content-Disposition` vía CORS (`Access-Control-Expose-Headers`), por lo que el
> frontend puede leer el nombre del archivo incluso si se sirve desde otro origen.

### Formato de error

Todos los errores comparten la misma estructura:

```json
{
  "ok": false,
  "error": {
    "codigo": "VALIDACION",
    "mensaje": "Los datos enviados no son validos.",
    "detalles": ["\"comuna\" es obligatorio y debe ser texto."]
  }
}
```

| Código | HTTP | Significado |
|---|---|---|
| `VALIDACION` | 400 | El cuerpo de la petición no cumple las reglas de validación. |
| `JSON_INVALIDO` | 400 | El cuerpo enviado no es un JSON válido. |
| `CONFIG_ERROR` | 500 | Falta `DEEPSEEK_API_KEY` en el servidor. |
| `DB_ERROR` | 500 | No fue posible leer/escribir el historial SQLite. |
| `EXPORT_ERROR` | 500 | No fue posible generar el archivo Excel o PDF de la exportación. |
| `DEEPSEEK_TIMEOUT` | 504 | DeepSeek no respondió dentro de `DEEPSEEK_TIMEOUT_MS`. |
| `DEEPSEEK_NETWORK_ERROR` | 502 | Error de red al contactar la API. |
| `DEEPSEEK_HTTP_ERROR` | 502 | La API respondió con un estado HTTP de error. |
| `DEEPSEEK_RESPUESTA_INVALIDA` | 502 | La API devolvió algo que no es JSON. |
| `DEEPSEEK_SIN_RESPUESTA` | 502 | Se agotaron los intentos sin respuesta. |
| `DEEPSEEK_SIN_CONTENIDO` | 502 | El modelo devolvió contenido vacío. |
| `DEEPSEEK_JSON_INVALIDO` | 502 | El JSON del modelo no se pudo parsear ni reconstruir. |
| `DEEPSEEK_TRUNCADO` | 502 | Respuesta truncada por tokens y no reconstruible. |
| `NOT_FOUND` | 404 | Ruta inexistente. |
| `ERROR_INTERNO` | 500 | Error inesperado del servidor. |

## Estructura del proyecto

```
P2_DS_TASACIONES/
├── public/                          # Frontend (servido como estático)
│   ├── css/style.css                # Estilos complementarios (spinner, animaciones)
│   ├── index.html                   # Formulario de tasación + resultados + historial
│   └── js/app.js                    # Lógica del cliente (fetch, render, historial, descargas)
├── src/
│   ├── controllers/
│   │   ├── export.controller.js     # Exportación del informe a Excel / PDF (buffer en memoria)
│   │   └── tasacion.controller.js   # Validación, orquestación y endpoints
│   ├── routes/
│   │   └── api.routes.js            # Definición de rutas de la API
│   ├── services/
│   │   ├── deepseek.service.js      # Cliente DeepSeek, prompt, parseo y reparación de JSON
│   │   ├── excel.service.js         # Generación del .xlsx con exceljs
│   │   ├── informe.service.js       # Normalización del informe compartida por Excel y PDF
│   │   └── pdf.service.js           # Generación del .pdf con pdfkit
│   └── database.js                  # Conexión SQLite y acceso a la tabla historial
├── .env.example                     # Plantilla de variables de entorno
├── .gitignore                       # Excluye .env, node_modules y *.db
├── package.json
├── README.md
└── server.js                        # Arranque Express, estáticos, errores y apagado ordenado
```

## Base de datos

SQLite en `tasaciones.db` (raíz del proyecto, **no versionado**). Tabla `historial`:

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | Identificador del registro. |
| `fecha` | `TEXT NOT NULL` | Fecha ISO 8601 en UTC (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`). |
| `comuna` | `TEXT NOT NULL` | Comuna de la propiedad. |
| `tipo` | `TEXT NOT NULL` | Tipo de propiedad. |
| `superficie` | `REAL NOT NULL` | Superficie útil en m². |
| `valor_referencia` | `REAL` | Valor de referencia en CLP (puede ser nulo). |
| `datos_json` | `TEXT NOT NULL` | Respuesta completa de DeepSeek serializada (`{ data, meta }`). |

Índice: `idx_historial_fecha (fecha DESC, id DESC)`.

```bash
# Inspeccionar la base (si tienes el CLI de sqlite3)
sqlite3 tasaciones.db "SELECT id, fecha, comuna, valor_referencia FROM historial ORDER BY id DESC LIMIT 10;"
```

## Notas sobre el truncamiento de respuestas

Los modelos con **razonamiento** (como `deepseek-flash`) consumen *tokens de pensamiento* del mismo
presupuesto `max_tokens`, por lo que la respuesta puede llegar cortada. El servicio lo maneja así:

1. Si `finish_reason = length`, se **reintenta con más presupuesto**, calculado a partir de los
   `reasoning_tokens` realmente usados (no solo duplicando).
2. Si aun así se trunca (o el JSON viene malformado), se **reconstruye el JSON parcial**
   cerrando cadenas y estructuras abiertas → se devuelve la tasación con `meta.reconstruido: true`
   y una **advertencia** visible, en lugar de un error 502.
3. Solo si la reconstrucción es imposible se responde `DEEPSEEK_TRUNCADO` / `DEEPSEEK_JSON_INVALIDO`.

Para diagnosticar, activa el log del contenido crudo:

```bash
# Windows (PowerShell)
$env:DEBUG_DEEPSEEK=1; npm start
```

## Seguridad

- `.env`, `.env.bak`, `node_modules/` y `*.db` están en `.gitignore`; **nunca** se versionan.
- No hay credenciales en el código: la key se lee de `process.env.DEEPSEEK_API_KEY`.
- Si una clave se expone, **revócala de inmediato** en <https://platform.deepseek.com> y genera una nueva.
- Para comprobar antes de publicar que no se sube ningún secreto:
  ```bash
  git ls-files | grep -i "\.env"                       # solo debe listar .env.example
  git log --all --pretty=format: --name-only | sort -u | grep -i "^\\.env"
  ```

## Licencia

Distribuido bajo licencia **MIT**. Ver `package.json`.

---

<p align="center">Hecho con Node.js, Tailwind CSS y DeepSeek 🤖🏠</p>
