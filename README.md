# 📄 Document Processor Lambda

Servicio de procesamiento y validación de documentos académicos para AWS Lambda que utiliza Google Drive API y AWS Textract para extraer, validar y procesar información de documentos educativos.

## 🎯 Características Principales

- **Descarga automática** de documentos desde Google Drive
- **Extracción de texto** usando AWS Textract
- **Validación de contenido** mediante diccionarios especializados
- **Procesamiento específico** para documentos académicos colombianos
- **Extracción de datos** de pruebas TyT (Técnico y Tecnólogo)
- **Validación institucional** para CUN (Corporación Unificada Nacional)

## 🏗️ Arquitectura

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   API Gateway   │───▶│  Lambda Function │───▶│  Google Drive   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   AWS Textract  │
                       └─────────────────┘
```

## 📋 Tipos de Documentos Soportados

| Tipo | Descripción | Diccionario |
|------|-------------|-------------|
| `cedula` | Cédula de ciudadanía | Documentos de identidad |
| `diploma_bachiller` | Diploma y acta de bachiller | Documentos de bachillerato |
| `diploma_tecnico` | Diploma técnico | Programas técnicos |
| `diploma_tecnologo` | Diploma tecnólogo | Programas tecnológicos |
| `titulo_profesional` | Título profesional | Programas de pregrado |
| `prueba_tt` | Prueba Saber TyT | Exámenes TyT |
| `icfes` | Resultados ICFES | Pruebas Saber 11 |
| `recibo_pago` | Recibo de pago | Derechos de grado |
| `encuesta_m0` | Encuesta momento 0 | Seguimiento de graduados |
| `acta_homologacion` | Acta de homologación | Transferencia de créditos |

## 🚀 Instalación y Configuración

### Prerrequisitos

- Node.js 18.x o superior
- AWS CLI configurado
- Cuenta de Google Cloud con API habilitada
- Permisos de AWS Lambda y Textract

### 1. Configuración de Google Drive API

1. Crear proyecto en [Google Cloud Console](https://console.cloud.google.com)
2. Habilitar Google Drive API
3. Crear credenciales OAuth 2.0
4. Obtener refresh token

### 2. Variables de Entorno

Configurar en AWS Lambda:

```bash
GOOGLE_CLIENT_ID=tu_client_id
GOOGLE_CLIENT_SECRET=tu_client_secret
GOOGLE_REFRESH_TOKEN=tu_refresh_token
```

### 3. Despliegue

```bash
# Instalar dependencias
npm install

# Crear archivo ZIP para Lambda
zip -r function.zip src/ dictionaries/ node_modules/ package.json

# Desplegar usando AWS CLI
aws lambda update-function-code \
  --function-name document-processor \
  --zip-file fileb://function.zip
```

## 📊 Estructura del Proyecto

```
document-processor-lambda/
├── src/
│   ├── index.js                     # Handler principal
│   ├── services/
│   │   ├── dictionaryService.js     # Gestión de diccionarios
│   │   ├── downloadDocuments.js    # Descarga desde Google Drive
│   │   ├── extractDataDocuments.js # Extracción de datos específicos
│   │   ├── extractUrl.js           # Extracción de URLs
│   │   ├── googleAuth.js           # Autenticación Google
│   │   ├── processDocument.js      # Procesamiento principal
│   │   ├── textract.js             # Integración AWS Textract
│   │   └── validatorDocuments.js   # Validación con diccionarios
│   └── utils/
│       └── tempStorage.js          # Gestión de archivos temporales
├── dictionaries/                   # Diccionarios de validación
│   ├── DiccionarioActaHomologacion.txt
│   ├── DiccionarioActayDiplomaBachiller.txt
│   ├── DiccionarioActayDiplomaPregrado.txt
│   ├── DiccionarioActayDiplomaTecnico.txt
│   ├── DiccionarioActayDiplomaTecnologo.txt
│   ├── DiccionarioCUN.txt
│   ├── DiccionarioEncuestaSeguimiento.txt
│   ├── DiccionarioIcfes.txt
│   ├── DiccionarioPagoDerechosDeGrado.txt
│   ├── DiccionarioTYT.txt
│   └── Diccionario_Documentos_Identidad.txt
├── package.json
└── README.md
```

## 🔌 API Reference

### Endpoint

```
POST /process-documents
```

### Request Body

```json
{
  "ID": "12345",
  "Nombre_completo": "Juan Pérez",
  "Numero_de_Documento": "1234567890",
  "Tipo_de_documento": "CC",
  "Modalidad": "Presencial",
  "Nivel_de_formacion_del_cual_esta_solicitando_grado": "Técnico",
  "Programa_del_cual_esta_solicitando_grado": "Sistemas",
  "Correo_electronico_institucional": "juan@cun.edu.co",
  "Correo_electronico_personal": "juan@gmail.com",
  "Autorizacion_tratamiento_de_datos": "Si",
  "Copia_de_cedula": "https://drive.google.com/file/d/...",
  "Diploma_y_acta_de_bachiller": "https://drive.google.com/file/d/...",
  "Icfes": "https://drive.google.com/file/d/...",
  "diploma_tecnico": "https://drive.google.com/file/d/...",
  "diploma_tecnologo": "https://drive.google.com/file/d/...",
  "Titulo_profesional": "https://drive.google.com/file/d/...",
  "Prueba_T_T": "https://drive.google.com/file/d/...",
  "Soporte_de_encuesta_momento_0": "https://drive.google.com/file/d/...",
  "Acta_de_homologacion": "https://drive.google.com/file/d/...",
  "Recibo_de_pago_derechos_de_grado": "https://drive.google.com/file/d/..."
}
```

### Response

```json
{
  "ID": "12345",
  "NombreCompleto": "Juan Pérez",
  "TipoDocumento": "CC",
  "NumeroDocumento": "1234567890",
  "Modalidad": "Presencial",
  "NivelDeFormacionSolicitadoParaGrado": "Técnico",
  "ProgramaDelCualSolicita": "Sistemas",
  "CorreoInsitucional": "juan@cun.edu.co",
  "CorreoPersonal": "juan@gmail.com",
  "FotocopiaDocumento": "Documento Valido",
  "DiplomayActaGradoBachiller": "Documento Valido",
  "DiplomayActaGradoTecnico": "N/A",
  "DiplomayActaGradoTecnologo": "N/A",
  "DiplomayActaGradoPregrado": "N/A",
  "ResultadoSaberProDelNivelParaGrado": "Documento Valido",
  "ExamenIcfes_11": "Documento Valido",
  "RecibiDePagoDerechosDeGrado": "Documento Valido",
  "Encuesta_M0": "N/A",
  "Acta_Homologacion": "N/A",
  "EK": "EK123456789012",
  "Autorizacion_tratamiento_de_datos": "Si",
  "Num_Documento_Extraido": "1234567890",
  "Institucion_Extraida": "Corporación Unificada Nacional",
  "Programa_Extraido": "Técnico Profesional en Sistemas",
  "Fecha_Presentacion_Extraida": "15/03/2024",
  "Institucion_Valida": "Valido",
  "Num_Doc_Valido": "Valido"
}
```

## 🔧 Configuración de AWS Lambda

### Configuración Recomendada

- **Runtime**: Node.js 18.x
- **Memory**: 512 MB mínimo
- **Timeout**: 5 minutos (300 segundos)
- **Environment Variables**: Configurar credenciales de Google

### Permisos IAM Requeridos

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "textract:DetectDocumentText",
        "textract:AnalyzeDocument"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

## 🧪 Testing

### Prueba Local

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno localmente
export GOOGLE_CLIENT_ID="tu_client_id"
export GOOGLE_CLIENT_SECRET="tu_client_secret"
export GOOGLE_REFRESH_TOKEN="tu_refresh_token"

# Ejecutar prueba
node test/local-test.js
```

### Prueba en Lambda

```bash
# Crear evento de test
aws lambda invoke \
  --function-name document-processor \
  --payload file://test/sample-event.json \
  response.json

# Ver resultado
cat response.json
```

## 📝 Logs y Monitoreo

### CloudWatch Logs

Los logs están organizados por prefijos:

- `[MAIN]` - Flujo principal
- `[DOWNLOAD]` - Descarga de archivos
- `[TEXTRACT]` - Extracción de texto
- `[PROCESS]` - Procesamiento de documentos
- `[DICT]` - Validación con diccionarios
- `[GOOGLE-AUTH]` - Autenticación Google

### Métricas Importantes

- Tiempo de ejecución promedio
- Errores de autenticación
- Archivos procesados exitosamente
- Fallos de validación

## ⚠️ Limitaciones Conocidas

1. **Tamaño de archivo**: Máximo 10MB por documento
2. **Formatos soportados**: PDF, PNG, JPEG
3. **Timeout**: 5 minutos máximo de ejecución
4. **Rate limits**: Google Drive API tiene límites de solicitudes

## 🐛 Solución de Problemas

### Error: "Cannot find module 'dotenv'"
- **Causa**: Dependencia no incluida en el paquete
- **Solución**: Remover `require('dotenv')` del código

### Error: "PERMISSION_DENIED"
- **Causa**: Falta permisos para acceder al archivo de Google Drive
- **Solución**: Verificar que el archivo sea público o compartido

### Error: "NO_TEXT_EXTRACTED"
- **Causa**: Textract no pudo extraer texto del documento
- **Solución**: Verificar calidad y formato del documento

### Error: "AUTH_DOWNLOAD_ERROR"
- **Causa**: Problema con credenciales de Google
- **Solución**: Regenerar refresh token

## 📞 Soporte

Para soporte técnico o preguntas:

- **Issues**: Crear issue en GitHub
- **Email**: soporte@ejemplo.com
- **Documentación**: Wiki del proyecto

## 📄 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para detalles.
---

**Versión**: 1.0.0  
**Última actualización**: Mayo 2025