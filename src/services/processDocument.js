const { getDictionaryForDocumentType } = require('./dictionaryService');
const { validateTextWithDictionary} = require('./validatorDocuments');
const { extractTextFromDocument } = require('./textract');
const { extractDataTyT } = require('./extractDataDocuments');

async function processDocuments(inputData, downloadedFiles, documentUrls) {
  console.log('[PROCESS] Iniciando procesamiento robusto de documentos');

  let output;
  try {
    output = createSafeOutputStructure(inputData);
  } catch (structureError) {
    console.error('[PROCESS] Error creando estructura de salida:', structureError.message);
    output = createEmergencyOutputStructure(inputData);
  }

  let documentMap = {};
  try {
    documentMap = createDocumentMap(downloadedFiles, documentUrls);
    console.log(`[PROCESS] Mapa de documentos creado: ${Object.keys(documentMap).length} documentos`);
  } catch (mapError) {
    console.error('[PROCESS] Error creando mapa de documentos:', mapError.message);
    documentMap = {}; // Continuar con mapa vacío
  }

  const processingPromises = [
    safeProcessDocumentType(documentMap, 'cedula', output, 'FotocopiaDocumento', inputData),
    safeProcessDocumentType(documentMap, 'diploma_bachiller', output, 'DiplomayActaGradoBachiller', inputData),
    safeProcessDocumentType(documentMap, 'diploma_tecnico', output, 'DiplomayActaGradoTecnico', inputData),
    safeProcessDocumentType(documentMap, 'diploma_tecnologo', output, 'DiplomayActaGradoTecnologo', inputData),
    safeProcessDocumentType(documentMap, 'titulo_profesional', output, 'DiplomayActaGradoPregrado', inputData),
    safeProcessDocumentType(documentMap, 'prueba_tt', output, 'ResultadoSaberProDelNivelParaGrado', inputData),
    safeProcessDocumentType(documentMap, 'icfes', output, 'ExamenIcfes_11', inputData),
    safeProcessDocumentType(documentMap, 'recibo_pago', output, 'RecibiDePagoDerechosDeGrado', inputData),
    safeProcessDocumentType(documentMap, 'encuesta_m0', output, 'Encuesta_M0', inputData),
    safeProcessDocumentType(documentMap, 'acta_homologacion', output, 'Acta_Homologacion', inputData),
  ];

  try {
    console.log('[PROCESS] Ejecutando procesamiento en paralelo de 10 tipos de documentos');
    const results = await Promise.allSettled(processingPromises);

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    console.log(`[PROCESS] Resultados del procesamiento: ${successful} exitosos, ${failed} fallidos`);

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const docTypes = ['cedula', 'diploma_bachiller', 'diploma_tecnico', 'diploma_tecnologo', 
                         'titulo_profesional', 'prueba_tt', 'icfes', 'recibo_pago', 'encuesta_m0', 'acta_homologacion'];
        console.error(`[PROCESS] Error en ${docTypes[index]}: ${result.reason?.message || 'Error desconocido'}`);
      }
    });
    
  } catch (parallelError) {
    console.error('[PROCESS] Error crítico en procesamiento paralelo:', parallelError.message);
  }

  try {
    validateOutputIntegrity(output);
    console.log('[PROCESS] ✓ Integridad del resultado verificada');
  } catch (integrityError) {
    console.error('[PROCESS] Error de integridad:', integrityError.message);
    repairOutputStructure(output, inputData);
  }

  console.log('[PROCESS] Procesamiento completado exitosamente');
  return output;
}

function createSafeOutputStructure(inputData) {
  try {
    return {
      ID: safeCopy(inputData?.ID, 'unknown'),
      NombreCompleto: safeCopy(inputData?.Nombre_completo, 'No especificado'),
      TipoDocumento: safeCopy(inputData?.Tipo_de_documento, 'No especificado'),
      NumeroDocumento: safeCopy(inputData?.Numero_de_Documento, 'No especificado'),
      Modalidad: safeCopy(inputData?.Modalidad, 'No especificado'),
      NivelDeFormacionSolicitadoParaGrado: safeCopy(inputData?.Nivel_de_formacion_del_cual_esta_solicitando_grado, 'No especificado'),
      ProgramaDelCualSolicita: safeCopy(inputData?.Programa_del_cual_esta_solicitando_grado, 'No especificado'),
      CorreoInsitucional: safeCopy(inputData?.Correo_electronico_institucional, 'No especificado'),
      CorreoPersonal: safeCopy(inputData?.Correo_electronico_personal, 'No especificado'),
      FotocopiaDocumento: 'Documento no adjunto',
      DiplomayActaGradoBachiller: 'Documento no adjunto',
      DiplomayActaGradoTecnico: 'Documento no adjunto',
      DiplomayActaGradoTecnologo: 'Documento no adjunto',
      DiplomayActaGradoPregrado: 'Documento no adjunto',
      ResultadoSaberProDelNivelParaGrado: 'Documento no adjunto',
      ExamenIcfes_11: 'Documento no adjunto',
      RecibiDePagoDerechosDeGrado: "Documento no adjunto",
      Encuesta_M0: "Documento no adjunto",
      Acta_Homologacion: "Documento no adjunto",
      EK: 'N/A',
      Autorizacion_tratamiento_de_datos: safeCopy(inputData?.Autorizacion_tratamiento_de_datos, 'No especificado'),
      Num_Documento_Extraido: 'N/A',
      Institucion_Extraida: 'N/A',
      Programa_Extraido: 'N/A',
      Fecha_Presentacion_Extraida: 'N/A',
      Institucion_Valida: 'N/A',
      Num_Doc_Valido: 'N/A',
    };
  } catch (error) {
    console.error('[PROCESS] Error en createSafeOutputStructure:', error.message);
    return createEmergencyOutputStructure(inputData);
  }
}

function createEmergencyOutputStructure(inputData) {
  const safeId = (inputData && typeof inputData === 'object' && inputData.ID) ? String(inputData.ID) : 'emergency';
  
  return {
    ID: safeId,
    NombreCompleto: 'Error en estructura - Revision Manual',
    TipoDocumento: 'Error en estructura',
    NumeroDocumento: 'Error en estructura',
    Modalidad: 'Error en estructura',
    NivelDeFormacionSolicitadoParaGrado: 'Error en estructura',
    ProgramaDelCualSolicita: 'Error en estructura',
    CorreoInsitucional: 'Error en estructura',
    CorreoPersonal: 'Error en estructura',
    FotocopiaDocumento: 'Error de sistema - Revision Manual',
    DiplomayActaGradoBachiller: 'Error de sistema - Revision Manual',
    DiplomayActaGradoTecnico: 'Error de sistema - Revision Manual',
    DiplomayActaGradoTecnologo: 'Error de sistema - Revision Manual',
    DiplomayActaGradoPregrado: 'Error de sistema - Revision Manual',
    ResultadoSaberProDelNivelParaGrado: 'Error de sistema - Revision Manual',
    ExamenIcfes_11: 'Error de sistema - Revision Manual',
    RecibiDePagoDerechosDeGrado: "Error de sistema - Revision Manual",
    Encuesta_M0: "Error de sistema - Revision Manual",
    Acta_Homologacion: "Error de sistema - Revision Manual",
    EK: 'Error de sistema',
    Autorizacion_tratamiento_de_datos: 'Error de sistema',
    Num_Documento_Extraido: 'Error de sistema',
    Institucion_Extraida: 'Error de sistema',
    Programa_Extraido: 'Error de sistema',
    Fecha_Presentacion_Extraida: 'Error de sistema',
    Institucion_Valida: 'Error de sistema',
    Num_Doc_Valido: 'Error de sistema',
    system_error: 'Emergency structure created due to critical error'
  };
}

function safeCopy(value, defaultValue) {
  try {
    if (value === null || value === undefined) {
      return defaultValue;
    }
    if (typeof value === 'string') {
      return value.trim() || defaultValue;
    }
    return String(value) || defaultValue;
  } catch (error) {
    return defaultValue;
  }
}

function createDocumentMap(downloadedFiles, documentUrls) {
  const documentMap = {};
  
  try {
    if (!Array.isArray(downloadedFiles)) {
      console.warn('[PROCESS] downloadedFiles no es un array, usando array vacío');
      downloadedFiles = [];
    }
    
    if (!documentUrls || typeof documentUrls !== 'object') {
      console.warn('[PROCESS] documentUrls no es un objeto válido, usando objeto vacío');
      documentUrls = {};
    }
    
    for (const file of downloadedFiles) {
      try {
        if (!file || !file.originalUrl) {
          console.warn('[PROCESS] Archivo sin URL original, saltando');
          continue;
        }
        
        for (const [docType, url] of Object.entries(documentUrls)) {
          if (file.originalUrl === url) {
            documentMap[docType] = file;
            break;
          }
        }
      } catch (fileError) {
        console.error('[PROCESS] Error procesando archivo individual:', fileError.message);
      }
    }
  } catch (error) {
    console.error('[PROCESS] Error en createDocumentMap:', error.message);
  }
  
  return documentMap;
}

async function safeProcessDocumentType(documentMap, docType, output, outputField, inputData) {
  try {
    console.log(`[PROCESS] Procesando documento tipo: ${docType}`);

    if (!output || typeof output !== 'object') {
      throw new Error(`Output object invalid for ${docType}`);
    }
    
    if (!outputField || typeof outputField !== 'string') {
      throw new Error(`Output field invalid for ${docType}`);
    }
    
    await processDocumentType(documentMap, docType, output, outputField, inputData);
    
  } catch (error) {
    console.error(`[PROCESS] Error crítico procesando ${docType}:`, error.message);

    try {
      if (output && outputField) {
        output[outputField] = `Error crítico en procesamiento - Revision Manual (${error.message.substring(0, 50)})`;
      }
    } catch (assignError) {
      console.error(`[PROCESS] Error asignando valor de error para ${docType}:`, assignError.message);
    }
  }
}

async function processDocumentType(documentMap, docType, output, outputField, inputData){
  try {
    const file = documentMap[docType];

    if (!file) {
      console.log(`[PROCESS] No se encontró archivo para tipo: ${docType}`);
      output[outputField] = "Documento no adjunto";
      return;
    }

    if (file.status === 'error') {
      console.error(`[PROCESS] Error en descarga para ${docType}: ${file.error}`);
      output[outputField] = determineErrorMessage(file.error);
      return;
    }

    console.log(`[PROCESS] Archivo encontrado: ${file.fileName} (${formatBytes(file.size)})`);

    let extractedText = '';
    try {
      extractedText = await extractTextFromDocument(file.path, docType);
      console.log(`[PROCESS] Texto extraído para ${docType}: ${extractedText.length} caracteres`);
    } catch (textError) {
      console.error(`[PROCESS] Error extrayendo texto de ${docType}:`, textError.message);
      output[outputField] = `Error en extracción de texto - Revision Manual`;
      return;
    }

    let isValid = false;
    try {
      const dictionary = await getDictionaryForDocumentType(docType);
      isValid = await validateTextWithDictionary(extractedText, dictionary);
      console.log(`[PROCESS] Validación ${docType}: ${isValid ? 'VÁLIDO' : 'INVÁLIDO'}`);
    } catch (validationError) {
      console.error(`[PROCESS] Error en validación de ${docType}:`, validationError.message);
      output[outputField] = `Error en validación - Revision Manual`;
      return;
    }

    if (isValid) {
      if (docType === 'prueba_tt') {
        await safeProcessTyTDocument(extractedText, output, inputData);
      }
      
      output[outputField] = "Documento Valido";
      console.log(`[PROCESS] ${docType} marcado como VÁLIDO`);
      
    } else {
      output[outputField] = "Revision Manual";
      console.log(`[PROCESS] ${docType} marcado para REVISIÓN MANUAL`);
    }
    
  } catch (error) {
    console.error(`[PROCESS] Error procesando ${docType}:`, error.message);
    output[outputField] = determineErrorMessage(error.message);
  }
}

async function safeProcessTyTDocument(extractedText, output, inputData) {
  try {
    console.log(`[PROCESS] Extrayendo datos específicos de TyT`);
    
    const dataTyT = await extractDataTyT(extractedText);

    const hasValidData = dataTyT.registroEK || dataTyT.numDocumento || 
                        dataTyT.fechaPresentacion || dataTyT.programa || dataTyT.institucion;
    
    if (!hasValidData) {
      setTyTManualExtraction(output, 'Sin datos extraíbles');
      return;
    }

    output.EK = safeCopy(dataTyT.registroEK, 'Extraccion Manual');
    output.Num_Documento_Extraido = safeCopy(dataTyT.numDocumento, 'Extraccion Manual');
    output.Fecha_Presentacion_Extraida = safeCopy(dataTyT.fechaPresentacion, 'Extraccion Manual');
    output.Programa_Extraido = safeCopy(dataTyT.programa, 'Extraccion Manual');
    output.Institucion_Extraida = safeCopy(dataTyT.institucion, 'Extraccion Manual');
    
    console.log(`[PROCESS] Datos TyT extraídos:`, {
      EK: dataTyT.registroEK || 'N/A',
      numDoc: dataTyT.numDocumento || 'N/A',
      fecha: dataTyT.fechaPresentacion || 'N/A',
      programa: dataTyT.programa ? dataTyT.programa.substring(0, 50) + '...' : 'N/A',
      institucion: dataTyT.institucion ? dataTyT.institucion.substring(0, 50) + '...' : 'N/A'
    });

    try {
      const inputDocNumber = safeCopy(inputData?.Numero_de_Documento, '');
      const extractedDocNumber = safeCopy(dataTyT.numDocumento, '');
      
      if (extractedDocNumber && inputDocNumber && extractedDocNumber === inputDocNumber) {
        output.Num_Doc_Valido = 'Valido';
        console.log(`[PROCESS] Número de documento COINCIDE`);
      } else {
        output.Num_Doc_Valido = 'Revision Manual';
        console.log(`[PROCESS] Número de documento NO COINCIDE: ${extractedDocNumber} vs ${inputDocNumber}`);
      }
    } catch (docValidationError) {
      console.error(`[PROCESS] Error validando número de documento:`, docValidationError.message);
      output.Num_Doc_Valido = 'Error en validación';
    }

    try {
      if (dataTyT.institucion) {
        const dictionaryCUN = await getDictionaryForDocumentType('cun_institutions');
        const validInstitution = await validateTextWithDictionary(dataTyT.institucion, dictionaryCUN);

        if (validInstitution) {
          output.Institucion_Valida = 'Valido';
          console.log(`[PROCESS] Institución CUN VÁLIDA`);
        } else {
          output.Institucion_Valida = 'Revision Manual';
          console.log(`[PROCESS] Institución CUN REQUIERE REVISIÓN`);
        }
      } else {
        output.Institucion_Valida = 'Extraccion Manual';
        console.log(`[PROCESS] Sin datos de institución para validar`);
      }
    } catch (institutionError) {
      console.error(`[PROCESS] Error validando institución:`, institutionError.message);
      output.Institucion_Valida = 'Error en validación';
    }
    
  } catch (tytError) {
    console.error(`[PROCESS] Error crítico procesando TyT:`, tytError.message);
    setTyTManualExtraction(output, 'Error en procesamiento TyT');
  }
}

function setTyTManualExtraction(output, reason) {
  output.EK = 'Extraccion Manual';
  output.Num_Documento_Extraido = 'Extraccion Manual';
  output.Fecha_Presentacion_Extraida = 'Extraccion Manual';
  output.Programa_Extraido = 'Extraccion Manual';
  output.Institucion_Extraida = 'Extraccion Manual';
  output.Num_Doc_Valido = 'Extraccion Manual';
  output.Institucion_Valida = 'Extraccion Manual';
  
  console.log(`[PROCESS] TyT marcado para extracción manual: ${reason}`);
}

function determineErrorMessage(errorString) {
  try {
    const error = String(errorString).toLowerCase();
    
    if (error.includes('permission_denied')) {
      return "Sin permisos de acceso - Revision Manual";
    } else if (error.includes('file_not_found')) {
      return "Archivo no encontrado - Revision Manual";
    } else if (error.includes('auth_error') || error.includes('auth_general_error')) {
      return "Error de autenticación - Revision Manual";
    } else if (error.includes('invalid_url')) {
      return "URL inválida - Revision Manual";
    } else if (error.includes('download_timeout')) {
      return "Tiempo de descarga agotado - Revision Manual";
    } else if (error.includes('no_access_token')) {
      return "Sin credenciales válidas - Revision Manual";
    } else if (error.includes('html_file_detected')) {
      return "Archivo HTML detectado - Revision Manual";
    } else if (error.includes('no_text_extracted')) {
      return "Sin texto extraíble - Revision Manual";
    } else if (error.includes('document_too_large')) {
      return "Documento muy grande - Revision Manual";
    } else if (error.includes('unsupported_file_type')) {
      return "Tipo de archivo no soportado - Revision Manual";
    } else {
      return "Revision Manual";
    }
  } catch (msgError) {
    return "Error desconocido - Revision Manual";
  }
}

function validateOutputIntegrity(output) {
  const requiredFields = [
    'ID', 'NombreCompleto', 'TipoDocumento', 'NumeroDocumento', 'Modalidad',
    'NivelDeFormacionSolicitadoParaGrado', 'ProgramaDelCualSolicita',
    'CorreoInsitucional', 'CorreoPersonal', 'FotocopiaDocumento',
    'DiplomayActaGradoBachiller', 'DiplomayActaGradoTecnico', 'DiplomayActaGradoTecnologo',
    'DiplomayActaGradoPregrado', 'ResultadoSaberProDelNivelParaGrado',
    'ExamenIcfes_11', 'RecibiDePagoDerechosDeGrado', 'Encuesta_M0',
    'Acta_Homologacion', 'EK', 'Autorizacion_tratamiento_de_datos',
    'Num_Documento_Extraido', 'Institucion_Extraida', 'Programa_Extraido',
    'Fecha_Presentacion_Extraida', 'Institucion_Valida', 'Num_Doc_Valido'
  ];
  
  const missingFields = requiredFields.filter(field => !(field in output));
  
  if (missingFields.length > 0) {
    throw new Error(`Campos faltantes en output: ${missingFields.join(', ')}`);
  }

  for (const [key, value] of Object.entries(output)) {
    if (value === null || value === undefined) {
      throw new Error(`Campo ${key} tiene valor null/undefined`);
    }
  }
}

function repairOutputStructure(output, inputData) {
  console.log('[PROCESS] Reparando estructura de output...');
  
  const defaultValues = {
    ID: 'repair_needed',
    NombreCompleto: 'Campo reparado',
    TipoDocumento: 'Campo reparado',
    NumeroDocumento: 'Campo reparado',
    Modalidad: 'Campo reparado',
    NivelDeFormacionSolicitadoParaGrado: 'Campo reparado',
    ProgramaDelCualSolicita: 'Campo reparado',
    CorreoInsitucional: 'Campo reparado',
    CorreoPersonal: 'Campo reparado',
    FotocopiaDocumento: 'Error de estructura - Revision Manual',
    DiplomayActaGradoBachiller: 'Error de estructura - Revision Manual',
    DiplomayActaGradoTecnico: 'Error de estructura - Revision Manual',
    DiplomayActaGradoTecnologo: 'Error de estructura - Revision Manual',
    DiplomayActaGradoPregrado: 'Error de estructura - Revision Manual',
    ResultadoSaberProDelNivelParaGrado: 'Error de estructura - Revision Manual',
    ExamenIcfes_11: 'Error de estructura - Revision Manual',
    RecibiDePagoDerechosDeGrado: 'Error de estructura - Revision Manual',
    Encuesta_M0: 'Error de estructura - Revision Manual',
    Acta_Homologacion: 'Error de estructura - Revision Manual',
    EK: 'Error de estructura',
    Autorizacion_tratamiento_de_datos: 'Campo reparado',
    Num_Documento_Extraido: 'Error de estructura',
    Institucion_Extraida: 'Error de estructura',
    Programa_Extraido: 'Error de estructura',
    Fecha_Presentacion_Extraida: 'Error de estructura',
    Institucion_Valida: 'Error de estructura',
    Num_Doc_Valido: 'Error de estructura'
  };
  
  for (const [key, defaultValue] of Object.entries(defaultValues)) {
    if (!(key in output) || output[key] === null || output[key] === undefined) {
      output[key] = defaultValue;
      console.log(`[PROCESS] Campo ${key} reparado con valor: ${defaultValue}`);
    }
  }

  try {
    if (inputData && typeof inputData === 'object') {
      if (inputData.ID && (!output.ID || output.ID === 'repair_needed')) {
        output.ID = safeCopy(inputData.ID, 'repaired');
      }
      if (inputData.Nombre_completo && output.NombreCompleto === 'Campo reparado') {
        output.NombreCompleto = safeCopy(inputData.Nombre_completo, 'Campo reparado');
      }
    }
  } catch (repairError) {
    console.error('[PROCESS] Error durante reparación:', repairError.message);
  }
  
  console.log('[PROCESS] ✓ Estructura de output reparada');
}

function formatBytes(bytes) {
  try {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  } catch (error) {
    return 'Unknown size';
  }
}

module.exports = {
  processDocuments
}