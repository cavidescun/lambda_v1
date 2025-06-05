# 📋 API Documentation - Document Processor

Esta documentación describe la API del procesador de documentos académicos.

## 🌐 Base URL

```
https://64npbyhrg3eodw5zh7ofxtu5yq0udymm.lambda-url.us-east-1.on.aws/
```

## 🔐 Autenticación

La función Lambda no requiere autenticación directa, pero debe configurarse correctamente en AWS API Gateway si se requiere autenticación.

## 📊 Endpoints

### POST

Procesa documentos académicos desde Google Drive y extrae información relevante.

#### Headers

```http
Content-Type: application/json
Accept: application/json
```

#### Request Body

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `ID` | string | Sí | Identificador único del registro |
| `Nombre_completo` | string | Sí | Nombre completo del estudiante |
| `Numero_de_Documento` | string | Sí | Número de documento de identidad |
| `Tipo_de_documento` | string | Sí | Tipo de documento (CC, TI, etc.) |
| `Modalidad` | string | No | Modalidad de estudio |
| `Nivel_de_formacion_del_cual_esta_solicitando_grado` | string | No | Nivel académico |
| `Programa_del_cual_esta_solicitando_grado` | string | No | Programa académico |
| `Correo_electronico_institucional` | string | No | Email institucional |
| `Correo_electronico_personal` | string | No | Email personal |
| `Autorizacion_tratamiento_de_datos` | string | No | Autorización de datos |
| `Copia_de_cedula` | string | No | URL de Google Drive |
| `Diploma_y_acta_de_bachiller` | string | No | URL de Google Drive |
| `Icfes` | string | No | URL de Google Drive |
| `diploma_tecnico` | string | No | URL de Google Drive |
| `diploma_tecnologo` | string | No | URL de Google Drive |
| `Titulo_profesional` | string | No | URL de Google Drive |
| `Prueba_T_T` | string | No | URL de Google Drive |
| `Soporte_de_encuesta_momento_0` | string | No | URL de Google Drive |
| `Acta_de_homologacion` | string | No | URL de Google Drive |
| `Recibo_de_pago_derechos_de_grado` | string | No | URL de Google Drive |

#### Ejemplo de Request

```json
{
  "ID": "EST-2024-001",
  "Nombre_completo": "María González Rodríguez",
  "Numero_de_Documento": "1098765432",
  "Tipo_de_documento": "CC",
  "Modalidad": "Virtual",
  "Nivel_de_formacion_del_cual_esta_solicitando_grado": "Técnico Profesional",
  "Programa_del_cual_esta_solicitando_grado": "Técnico Profesional en Sistemas de Información",
  "Correo_electronico_institucional": "maria.gonzalez@cun.edu.co",
  "Correo_electronico_personal": "maria.gonzalez@gmail.com",
  "Autorizacion_tratamiento_de_datos": "Si",
  "Copia_de_cedula": "https://drive.google.com/file/d/1Abc2Def3Ghi4Jkl5Mno6Pqr7Stu8Vwx9/view",
  "Diploma_y_acta_de_bachiller": "https://drive.google.com/file/d/2Bcd3Efg4Hij5Klm6Nop7Qrs8Tuv9Wxy0/view",
  "Prueba_T_T": "https://drive.google.com/file/d/3Cde4Fgh5Ijk6Lmn7Opq8Rst9Uvw0Xyz1/view",
  "Recibo_de_pago_derechos_de_grado": "https://drive.google.com/file/d/4Def5Ghi6Jkl7Mno8Pqr9Stu0Vwx1Yza2/view"
}
```

#### Response Body

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `ID` | string | Identificador único del registro |
| `NombreCompleto` | string | Nombre completo del estudiante |
| `TipoDocumento` | string | Tipo de documento |
| `NumeroDocumento` | string | Número de documento |
| `Modalidad` | string | Modalidad de estudio |
| `NivelDeFormacionSolicitadoParaGrado` | string | Nivel académico |
| `ProgramaDelCualSolicita` | string | Programa académico |
| `CorreoInsitucional` | string | Email institucional |
| `CorreoPersonal` | string | Email personal |
| `FotocopiaDocumento` | string | Estado de validación |
| `DiplomayActaGradoBachiller` | string | Estado de validación |
| `DiplomayActaGradoTecnico` | string | Estado de validación |
| `DiplomayActaGradoTecnologo` | string | Estado de validación |
| `DiplomayActaGradoPregrado` | string | Estado de validación |
| `ResultadoSaberProDelNivelParaGrado` | string | Estado de validación |
| `ExamenIcfes_11` | string | Estado de validación |
| `RecibiDePagoDerechosDeGrado` | string | Estado de validación |
| `Encuesta_M0` | string | Estado de validación |
| `Acta_Homologacion` | string | Estado de validación |
| `EK` | string | Código EK extraído de prueba TyT |
| `Autorizacion_tratamiento_de_datos` | string | Autorización de datos |
| `Num_Documento_Extraido` | string | Número extraído del documento |
| `Institucion_Extraida` | string | Institución extraída |
| `Programa_Extraido` | string | Programa extraído |
| `Fecha_Presentacion_Extraida` | string | Fecha de presentación |
| `Institucion_Valida` | string | Validación de institución |
| `Num_Doc_Valido` | string | Validación de número de documento |

#### Estados de Validación

| Estado | Descripción |
|--------|-------------|
| `"Documento Valido"` | El documento fue validado exitosamente |
| `"Revision Manual"` | El documento requiere revisión manual |
| `"N/A"` | No aplica o no se proporcionó documento |
| `"Error en procesamiento"` | Error durante el procesamiento |

#### Ejemplo de Response (Exitoso)

```json
{
  "ID": "EST-2024-001",
  "NombreCompleto": "María González Rodríguez",
  "TipoDocumento": "CC",
  "NumeroDocumento": "1098765432",
  "Modalidad": "Virtual",
  "NivelDeFormacionSolicitadoParaGrado": "Técnico Profesional",
  "ProgramaDelCualSolicita": "Técnico Profesional en Sistemas de Información",
  "CorreoInsitucional": "maria.gonzalez@cun.edu.co",
  "CorreoPersonal": "maria.gonzalez@gmail.com",
  "FotocopiaDocumento": "Documento Valido",
  "DiplomayActaGradoBachiller": "Documento Valido",
  "DiplomayActaGradoTecnico": "N/A",
  "DiplomayActaGradoTecnologo": "N/A",
  "DiplomayActaGradoPregrado": "N/A",
  "ResultadoSaberProDelNivelParaGrado": "Documento Valido",
  "ExamenIcfes_11": "N/A",
  "RecibiDePagoDerechosDeGrado": "Documento Valido",
  "Encuesta_M0": "N/A",
  "Acta_Homologacion": "N/A",
  "EK": "EK202403151234567890",
  "Autorizacion_tratamiento_de_datos": "Si",
  "Num_Documento_Extraido": "1098765432",
  "Institucion_Extraida": "Corporación Unificada Nacional de Educación Superior",
  "Programa_Extraido": "Técnico Profesional en Sistemas de Información",
  "Fecha_Presentacion_Extraida": "15/03/2024",
  "Institucion_Valida": "Valido",
  "Num_Doc_Valido": "Valido"
}
```

#### Códigos de Estado HTTP

| Código | Descripción |
|--------|-------------|
| `200` | Procesamiento exitoso |
| `400` | Solicitud inválida |
| `500` | Error interno del servidor |

#### Ejemplo de Response (Error)

```json
{
  "error": "Error interno del servidor",
  "message": "PERMISSION_DENIED: No tienes permisos para acceder al archivo",
  "timestamp": "2024-03-15T10:30:00.000Z"
}
```

## 🔄 Flujo de Procesamiento

1. **Validación de entrada**: Se valida el formato del request
2. **Extracción de URLs**: Se extraen las URLs de Google Drive
3. **Descarga de documentos**: Se descargan los archivos desde Google Drive
4. **Extracción de texto**: Se utiliza AWS Textract para extraer texto
5. **Validación de contenido**: Se valida usando diccionarios especializados
6. **Extracción de datos**: Se extraen datos específicos (para pruebas TyT)
7. **Validación cruzada**: Se validan datos extraídos vs datos de entrada
8. **Respuesta estructurada**: Se retorna el resultado procesado

## 📊 Extracción de Datos Específicos

### Prueba TyT (Saber T y T)

Para documentos de tipo `prueba_tt`, se extraen automáticamente:

- **Número EK**: Código de registro de la prueba
- **Número de documento**: Identificación del estudiante
- **Institución**: Nombre de la institución educativa
- **Programa**: Programa académico
- **Fecha de presentación**: Fecha de realización de la prueba

### Patrones de Extracción

#### Número de Documento
```regex
/Identificación:\s*C\.C\.\s*(\d{6,12})/gi
/C\.C\.\s*(\d{6,12})/gi
```

#### Código EK
```regex
/Número\s+de\s+registro:\s*(EK\d{10,15})/gi
/\b(EK\d{10,15})\b/gi
```

#### Institución
```regex
/Institución\s+de\s+educación\s+superior:\s*([\s\S]+?)\n\s*Programa/gi
/(Corporacion\s+Unificada\s+Nacional[^\n\r]*?)(?=\s*Programa|$)/gi
```

#### Programa Académico
```regex
/Programa\s+Académico:\s*([^\n\r]+?)(?=\s*2\.|Reporte|$)/gi
/(Tecnico\s+Profesional\s+[^\n\r]+?)(?=\s*2\.|$)/gi
```

#### Fecha de Presentación
```regex
/Aplicación\s+del\s+examen:\s*(\d{1,2}\/\d{1,2}\/\d{4})/gi
/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g
```

## 🎯 Validación con Diccionarios

### Proceso de Validación

1. Se carga el diccionario correspondiente al tipo de documento
2. Se normaliza el texto extraído (minúsculas, trim)
3. Se buscan coincidencias con palabras clave del diccionario
4. Se requieren mínimo 2 coincidencias para considerar válido el documento

### Diccionarios Disponibles

| Documento | Archivo | Palabras Clave |
|-----------|---------|----------------|
| Cédula | `Diccionario_Documentos_Identidad.txt` | Cédula, República, Colombia, etc. |
| Bachiller | `DiccionarioActayDiplomaBachiller.txt` | Bachiller, Diploma, Institución, etc. |
| Técnico | `DiccionarioActayDiplomaTecnico.txt` | Técnico, Técnica, etc. |
| Tecnólogo | `DiccionarioActayDiplomaTecnologo.txt` | Tecnólogo, Tecnología, etc. |
| Pregrado | `DiccionarioActayDiplomaPregrado.txt` | Ingeniería, Licenciado, Profesional, etc. |
| TyT | `DiccionarioTYT.txt` | Saber TyT, Icfes, Puntaje, etc. |
| ICFES | `DiccionarioIcfes.txt` | Saber 11, Icfes, Puntaje, etc. |
| Pago | `DiccionarioPagoDerechosDeGrado.txt` | Aprobado, transacción, banco, etc. |
| Encuesta | `DiccionarioEncuestaSeguimiento.txt` | Seguimiento, Graduados, SNIES, etc. |
| Homologación | `DiccionarioActaHomologacion.txt` | Homologación, créditos, equivalencia, etc. |
| CUN | `DiccionarioCUN.txt` | Corporación Unificada Nacional, CUN, etc. |

## 🚨 Manejo de Errores

### Errores Comunes

#### PERMISSION_DENIED
```json
{
  "error": "Error interno del servidor",
  "message": "PERMISSION_DENIED: No tienes permisos para acceder al archivo ABC123",
  "timestamp": "2024-03-15T10:30:00.000Z"
}
```

#### FILE_NOT_FOUND
```json
{
  "error": "Error interno del servidor",
  "message": "FILE_NOT_FOUND: El archivo ABC123 no existe o no es accesible",
  "timestamp": "2024-03-15T10:30:00.000Z"
}
```

#### NO_TEXT_EXTRACTED
```json
{
  "error": "Error interno del servidor",
  "message": "NO_TEXT_EXTRACTED: No se pudo extraer texto del documento",
  "timestamp": "2024-03-15T10:30:00.000Z"
}
```

#### AUTH_DOWNLOAD_ERROR
```json
{
  "error": "Error interno del servidor",
  "message": "AUTH_DOWNLOAD_ERROR: Error de autenticación con Google Drive",
  "timestamp": "2024-03-15T10:30:00.000Z"
}
```

## 📝 Ejemplos de Uso

### cURL

```bash
curl -X POST https://64npbyhrg3eodw5zh7ofxtu5yq0udymm.lambda-url.us-east-1.on.aws/ \
  -H "Content-Type: application/json" \
  -d '{
    "ID": "EST-2024-001",
    "Nombre_completo": "María González",
    "Numero_de_Documento": "1098765432",
    "Tipo_de_documento": "CC",
    "Copia_de_cedula": "https://drive.google.com/file/d/1Abc2Def3Ghi4/view",
    "Prueba_T_T": "https://drive.google.com/file/d/3Cde4Fgh5Ijk6/view"
    ...
  }'
```

### JavaScript (Fetch)

```javascript
const processDocuments = async (data) => {
  try {
    const response = await fetch('https://64npbyhrg3eodw5zh7ofxtu5yq0udymm.lambda-url.us-east-1.on.aws/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Resultado:', result);
    return result;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};

// Uso
const data = {
  ID: "EST-2024-001",
  Nombre_completo: "María González",
  Numero_de_Documento: "1098765432",
  Tipo_de_documento: "CC",
  Copia_de_cedula: "https://drive.google.com/file/d/1Abc2Def3Ghi4/view"
};

processDocuments(data);
```

### Python (Requests)

```python
import requests
import json

def process_documents(data):
    url = "https://api-gateway-url.amazonaws.com/prod/process-documents"
    headers = {
        "Content-Type": "application/json"