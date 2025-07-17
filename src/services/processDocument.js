const { getDictionaryForDocumentType } = require('./dictionaryService');
const { validateTextWithDictionary} = require('./validatorDocuments');
const { extractTextFromDocument } = require('./textract');
const { extractDataTyT } = require('./extractDataDocuments');
const { updateProcessingMetadata } = require('./s3Service');

// En src/services/processDocument.js, función processDocuments

async function processDocuments(inputData, downloadedFiles, documentUrls, s3ProcessingId = null) {
  console.log('[PROCESS-OPT] Iniciando procesamiento optimizado con paralelización mejorada');

  let output;
  try {
    output = createSafeOutputStructure(inputData);
  } catch (structureError) {
    console.error('[PROCESS-OPT] Error creando estructura de salida:', structureError.message);
    output = createEmergencyOutputStructure(inputData);
  }

  let documentMap = {};
  try {
    documentMap = createDocumentMap(downloadedFiles, documentUrls);
    console.log(`[PROCESS-OPT] Mapa de documentos creado: ${Object.keys(documentMap).length} documentos`);
  } catch (mapError) {
    console.error('[PROCESS-OPT] Error creando mapa de documentos:', mapError.message);
    documentMap = {};
  }

  const documentTypes = [
    { type: 'cedula', field: 'FotocopiaDocumento', priority: 1 },
    { type: 'diploma_bachiller', field: 'DiplomayActaGradoBachiller', priority: 2 },
    { type: 'icfes', field: 'ExamenIcfes_11', priority: 2 },
    { type: 'prueba_tt', field: 'ResultadoSaberProDelNivelParaGrado', priority: 3 },
    { type: 'diploma_tecnico', field: 'DiplomayActaGradoTecnico', priority: 4 },
    { type: 'diploma_tecnologo', field: 'DiplomayActaGradoTecnologo', priority: 4 },
    { type: 'titulo_profesional', field: 'DiplomayActaGradoPregrado', priority: 4 },
    { type: 'recibo_pago', field: 'RecibiDePagoDerechosDeGrado', priority: 5 },
    { type: 'encuesta_m0', field: 'Encuesta_M0', priority: 5 },
    { type: 'acta_homologacion', field: 'Acta_Homologacion', priority: 5 }
  ];

  // Agrupar por prioridad para procesamiento en lotes más eficiente
  const priorityGroups = {};
  documentTypes.forEach(docType => {
    if (!priorityGroups[docType.priority]) {
      priorityGroups[docType.priority] = [];
    }
    priorityGroups[docType.priority].push(docType);
  });

  const priorityBatches = Object.values(priorityGroups);
  console.log(`[PROCESS-OPT] Creados ${priorityBatches.length} lotes de procesamiento optimizados`);

  let totalProcessed = 0;
  let totalErrors = 0;
  const processingResults = {};

  for (let batchIndex = 0; batchIndex < priorityBatches.length; batchIndex++) {
    const batch = priorityBatches[batchIndex];
    const batchStartTime = Date.now();
    
    console.log(`[PROCESS-OPT] Procesando lote ${batchIndex + 1}/${priorityBatches.length}: ${batch.map(d => d.type).join(', ')}`);

    // Procesar en paralelo completo para lotes del mismo nivel de prioridad
    const batchPromises = batch.map(docType => 
      safeProcessDocumentTypeOptimized(
        documentMap, 
        docType.type, 
        output, 
        docType.field, 
        inputData, 
        s3ProcessingId
      ).then(result => ({
        ...result,
        documentType: docType.type,
        outputField: docType.field
      }))
    );

    try {
      // Usar Promise.allSettled con timeout por lote
      const batchTimeout = 30000; // 30 segundos por lote
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('BATCH_TIMEOUT')), batchTimeout)
      );

      const batchResults = await Promise.race([
        Promise.allSettled(batchPromises),
        timeoutPromise
      ]);
      
      batchResults.forEach((result, index) => {
        const docType = batch[index];
        if (result.status === 'fulfilled') {
          processingResults[docType.type] = result.value;
          totalProcessed++;
          
          if (result.value.success) {
            console.log(`[PROCESS-OPT] ✓ ${docType.type}: ${result.value.status || 'procesado'}`);
          } else {
            console.warn(`[PROCESS-OPT] ⚠️ ${docType.type}: ${result.value.error || 'error'}`);
            totalErrors++;
          }
        } else {
          processingResults[docType.type] = {
            success: false,
            error: result.reason?.message || 'Error desconocido',
            documentType: docType.type
          };
          totalErrors++;
          console.error(`[PROCESS-OPT] ✗ ${docType.type}: ${result.reason?.message || 'Error crítico'}`);
        }
      });

      const batchTime = Date.now() - batchStartTime;
      console.log(`[PROCESS-OPT] Lote ${batchIndex + 1} completado en ${batchTime}ms`);

    } catch (batchError) {
      if (batchError.message === 'BATCH_TIMEOUT') {
        console.error(`[PROCESS-OPT] Timeout en lote ${batchIndex + 1} después de 30s`);
        // Marcar todos los documentos del lote como error por timeout
        batch.forEach(docType => {
          output[docType.field] = "Error de tiempo - Revision Manual";
          totalErrors++;
        });
      } else {
        console.error(`[PROCESS-OPT] Error crítico en lote ${batchIndex + 1}:`, batchError.message);
        totalErrors += batch.length;
      }
    }

    // Pausa mínima entre lotes para evitar sobrecarga
    if (batchIndex < priorityBatches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  // Actualizar metadata final si está disponible S3
  if (s3ProcessingId) {
    try {
      await updateProcessingMetadata(s3ProcessingId, 'processing_summary', {
        totalDocuments: documentTypes.length,
        processedSuccessfully: totalProcessed - totalErrors,
        errors: totalErrors,
        processingResults,
        completedAt: new Date().toISOString(),
        status: totalErrors === 0 ? 'all_successful' : totalErrors < totalProcessed ? 'partial_success' : 'mostly_failed'
      });
    } catch (metadataError) {
      console.warn(`[PROCESS-OPT] No se pudo actualizar metadata final:`, metadataError.message);
    }
  }

  // Verificación de integridad final
  try {
    validateOutputIntegrity(output);
    console.log('[PROCESS-OPT] ✓ Integridad del resultado verificada');
  } catch (integrityError) {
    console.error('[PROCESS-OPT] Error de integridad:', integrityError.message);
    repairOutputStructure(output, inputData);
  }

  console.log(`[PROCESS-OPT] Procesamiento completado: ${totalProcessed - totalErrors}/${totalProcessed} exitosos`);
  
  return {
    ...output,
  };
}


async function safeProcessDocumentTypeOptimized(documentMap, docType, output, outputField, inputData, s3ProcessingId) {
  const startTime = Date.now();
  
  try {
    console.log(`[PROCESS-OPT] Procesando documento optimizado: ${docType}`);

    if (!output || typeof output !== 'object') {
      throw new Error(`Output object invalid for ${docType}`);
    }
    
    if (!outputField || typeof outputField !== 'string') {
      throw new Error(`Output field invalid for ${docType}`);
    }
    
    const result = await processDocumentTypeOptimized(documentMap, docType, output, outputField, inputData, s3ProcessingId);
    
    const processingTime = Date.now() - startTime;
    return {
      success: true,
      documentType: docType,
      processingTime,
      ...result
    };
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[PROCESS-OPT] Error crítico procesando ${docType} después de ${processingTime}ms:`, error.message);

    try {
      if (output && outputField) {
        const errorMessage = determineErrorMessage(error.message);
        output[outputField] = errorMessage;

        if (s3ProcessingId) {
          await updateProcessingMetadata(s3ProcessingId, docType, {
            status: 'processing_error',
            error: error.message,
            processingTime,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (assignError) {
      console.error(`[PROCESS-OPT] Error asignando valor de error para ${docType}:`, assignError.message);
    }
    
    return {
      success: false,
      error: error.message,
      documentType: docType,
      processingTime
    };
  }
}


async function processDocumentTypeOptimized(documentMap, docType, output, outputField, inputData, s3ProcessingId) {
  try {
    const file = documentMap[docType];

    if (!file) {
      console.log(`[PROCESS-OPT] No se encontró archivo para tipo: ${docType}`);
      output[outputField] = "Documento no adjunto";
      
      if (s3ProcessingId) {
        await updateProcessingMetadata(s3ProcessingId, docType, {
          status: 'not_provided',
          timestamp: new Date().toISOString()
        });
      }
      
      return { status: 'not_provided' };
    }

    if (file.status === 'error') {
      console.error(`[PROCESS-OPT] Error en descarga para ${docType}: ${file.error}`);
      const errorMessage = determineErrorMessage(file.error);
      output[outputField] = errorMessage;
      
      if (s3ProcessingId) {
        await updateProcessingMetadata(s3ProcessingId, docType, {
          status: 'download_error',
          error: file.error,
          timestamp: new Date().toISOString()
        });
      }
      
      return { status: 'download_error', error: file.error };
    }

    console.log(`[PROCESS-OPT] Archivo encontrado: ${file.fileName} (${formatBytes(file.size)})`);

    if (s3ProcessingId) {
      await updateProcessingMetadata(s3ProcessingId, docType, {
        status: 'processing_started',
        fileName: file.fileName,
        fileSize: file.size,
        startTime: new Date().toISOString()
      });
    }

    let extractedText = '';
    let textExtractionMethod = 'unknown';
    
    try {
      const textStartTime = Date.now();
      extractedText = await extractTextFromDocument(file.path, docType, s3ProcessingId);
      const textExtractionTime = Date.now() - textStartTime;
      
      console.log(`[PROCESS-OPT] Texto extraído para ${docType}: ${extractedText.length} caracteres en ${textExtractionTime}ms`);
      
      if (s3ProcessingId) {
        await updateProcessingMetadata(s3ProcessingId, docType, {
          textExtracted: true,
          textLength: extractedText.length,
          textExtractionTime,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (textError) {
      console.error(`[PROCESS-OPT] Error extrayendo texto de ${docType}:`, textError.message);
      output[outputField] = `Error en extracción de texto - Revision Manual`;
      
      if (s3ProcessingId) {
        await updateProcessingMetadata(s3ProcessingId, docType, {
          status: 'text_extraction_error',
          error: textError.message,
          timestamp: new Date().toISOString()
        });
      }
      
      return { status: 'text_extraction_error', error: textError.message };
    }

    let isValid = false;
    let validationDetails = {};
    
    try {
      const validationStartTime = Date.now();
      const dictionary = await getDictionaryForDocumentType(docType);
      isValid = await validateTextWithDictionary(extractedText, dictionary);
      const validationTime = Date.now() - validationStartTime;
      
      validationDetails = {
        isValid,
        dictionarySize: dictionary.length,
        validationTime
      };
      
      console.log(`[PROCESS-OPT] Validación ${docType}: ${isValid ? 'VÁLIDO' : 'INVÁLIDO'} en ${validationTime}ms`);
      
      if (s3ProcessingId) {
        await updateProcessingMetadata(s3ProcessingId, docType, {
          validationCompleted: true,
          isValid,
          validationTime,
          dictionarySize: dictionary.length,
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (validationError) {
      console.error(`[PROCESS-OPT] Error en validación de ${docType}:`, validationError.message);
      output[outputField] = `Error en validación - Revision Manual`;
      
      if (s3ProcessingId) {
        await updateProcessingMetadata(s3ProcessingId, docType, {
          status: 'validation_error',
          error: validationError.message,
          timestamp: new Date().toISOString()
        });
      }
      
      return { status: 'validation_error', error: validationError.message };
    }

    if (isValid) {
      if (docType === 'prueba_tt') {
        try {
          await safeProcessTyTDocumentOptimized(extractedText, output, inputData, s3ProcessingId);
        } catch (tytError) {
          console.error(`[PROCESS-OPT] Error procesando TyT:`, tytError.message);
        }
      }
      
      output[outputField] = "Documento Valido";
      console.log(`[PROCESS-OPT] ${docType} marcado como VÁLIDO`);
      
      if (s3ProcessingId) {
        await updateProcessingMetadata(s3ProcessingId, docType, {
          status: 'completed_valid',
          finalStatus: 'Documento Valido',
          completedAt: new Date().toISOString()
        });
      }
      
      return { 
        status: 'valid', 
        validation: validationDetails,
        textLength: extractedText.length
      };
      
    } else {
      output[outputField] = "Revision Manual";
      console.log(`[PROCESS-OPT] ${docType} marcado para REVISIÓN MANUAL`);
      
      if (s3ProcessingId) {
        await updateProcessingMetadata(s3ProcessingId, docType, {
          status: 'completed_manual_review',
          finalStatus: 'Revision Manual',
          completedAt: new Date().toISOString()
        });
      }
      
      return { 
        status: 'manual_review', 
        validation: validationDetails,
        textLength: extractedText.length
      };
    }
    
  } catch (error) {
    console.error(`[PROCESS-OPT] Error procesando ${docType}:`, error.message);
    const errorMessage = determineErrorMessage(error.message);
    output[outputField] = errorMessage;
    
    if (s3ProcessingId) {
      await updateProcessingMetadata(s3ProcessingId, docType, {
        status: 'processing_failed',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
    
    return { status: 'processing_error', error: error.message };
  }
}

async function safeProcessTyTDocumentOptimized(extractedText, output, inputData, s3ProcessingId) {
  try {
    console.log(`[PROCESS-OPT] Extrayendo datos específicos de TyT con optimización`);
    
    const tytStartTime = Date.now();
    const dataTyT = await extractDataTyT(extractedText);
    const tytProcessingTime = Date.now() - tytStartTime;

    const hasValidData = dataTyT.registroEK || dataTyT.numDocumento || 
                        dataTyT.fechaPresentacion || dataTyT.programa || dataTyT.institucion;
    
    if (!hasValidData) {
      setTyTManualExtraction(output, 'Sin datos extraíbles');
      
      if (s3ProcessingId) {
        await updateProcessingMetadata(s3ProcessingId, 'prueba_tt_extraction', {
          status: 'no_extractable_data',
          processingTime: tytProcessingTime,
          timestamp: new Date().toISOString()
        });
      }
      return;
    }

    output.EK = safeCopy(dataTyT.registroEK, 'Extraccion Manual');
    output.Num_Documento_Extraido = safeCopy(dataTyT.numDocumento, 'Extraccion Manual');
    output.Fecha_Presentacion_Extraida = safeCopy(dataTyT.fechaPresentacion, 'Extraccion Manual');
    output.Programa_Extraido = safeCopy(dataTyT.programa, 'Extraccion Manual');
    output.Institucion_Extraida = safeCopy(dataTyT.institucion, 'Extraccion Manual');
    
    const extractionSummary = {
      EK: dataTyT.registroEK ? 'extracted' : 'manual',
      numDoc: dataTyT.numDocumento ? 'extracted' : 'manual',
      fecha: dataTyT.fechaPresentacion ? 'extracted' : 'manual',
      programa: dataTyT.programa ? 'extracted' : 'manual',
      institucion: dataTyT.institucion ? 'extracted' : 'manual'
    };

    console.log(`[PROCESS-OPT] Datos TyT extraídos:`, extractionSummary);

    try {
      const inputDocNumber = safeCopy(inputData?.Numero_de_Documento, '');
      const extractedDocNumber = safeCopy(dataTyT.numDocumento, '');
      
      if (extractedDocNumber && inputDocNumber && extractedDocNumber === inputDocNumber) {
        output.Num_Doc_Valido = 'Valido';
        console.log(`[PROCESS-OPT] Número de documento COINCIDE`);
      } else {
        output.Num_Doc_Valido = 'Revision Manual';
        console.log(`[PROCESS-OPT] Número de documento NO COINCIDE: ${extractedDocNumber} vs ${inputDocNumber}`);
      }
    } catch (docValidationError) {
      console.error(`[PROCESS-OPT] Error validando número de documento:`, docValidationError.message);
      output.Num_Doc_Valido = 'Error en validación';
    }

    try {
      if (dataTyT.institucion) {
        const dictionaryCUN = await getDictionaryForDocumentType('cun_institutions');
        const validInstitution = await validateTextWithDictionary(dataTyT.institucion, dictionaryCUN);

        if (validInstitution) {
          output.Institucion_Valida = 'Valido';
          console.log(`[PROCESS-OPT] Institución CUN VÁLIDA`);
        } else {
          output.Institucion_Valida = 'Revision Manual';
          console.log(`[PROCESS-OPT] Institución CUN REQUIERE REVISIÓN`);
        }
      } else {
        output.Institucion_Valida = 'Extraccion Manual';
        console.log(`[PROCESS-OPT] Sin datos de institución para validar`);
      }
    } catch (institutionError) {
      console.error(`[PROCESS-OPT] Error validando institución:`, institutionError.message);
      output.Institucion_Valida = 'Error en validación';
    }

    if (s3ProcessingId) {
      await updateProcessingMetadata(s3ProcessingId, 'prueba_tt_extraction', {
        status: 'completed',
        processingTime: tytProcessingTime,
        extractedData: {
          EK: dataTyT.registroEK || null,
          documentNumber: dataTyT.numDocumento || null,
          presentationDate: dataTyT.fechaPresentacion || null,
          program: dataTyT.programa || null,
          institution: dataTyT.institucion || null
        },
        validationResults: {
          documentNumberValid: output.Num_Doc_Valido,
          institutionValid: output.Institucion_Valida
        },
        extractionSummary,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (tytError) {
    console.error(`[PROCESS-OPT] Error crítico procesando TyT:`, tytError.message);
    setTyTManualExtraction(output, 'Error en procesamiento TyT');
    
    if (s3ProcessingId) {
      await updateProcessingMetadata(s3ProcessingId, 'prueba_tt_extraction', {
        status: 'processing_error',
        error: tytError.message,
        timestamp: new Date().toISOString()
      });
    }
  }
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
    console.error('[PROCESS-OPT] Error en createSafeOutputStructure:', error.message);
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
      console.warn('[PROCESS-OPT] downloadedFiles no es un array, usando array vacío');
      downloadedFiles = [];
    }
    
    if (!documentUrls || typeof documentUrls !== 'object') {
      console.warn('[PROCESS-OPT] documentUrls no es un objeto válido, usando objeto vacío');
      documentUrls = {};
    }
    
    for (const file of downloadedFiles) {
      try {
        if (!file || !file.originalUrl) {
          console.warn('[PROCESS-OPT] Archivo sin URL original, saltando');
          continue;
        }
        
        for (const [docType, url] of Object.entries(documentUrls)) {
          if (file.originalUrl === url) {
            documentMap[docType] = file;
            break;
          }
        }
      } catch (fileError) {
        console.error('[PROCESS-OPT] Error procesando archivo individual:', fileError.message);
      }
    }
  } catch (error) {
    console.error('[PROCESS-OPT] Error en createDocumentMap:', error.message);
  }
  
  return documentMap;
}

function setTyTManualExtraction(output, reason) {
  output.EK = 'Extraccion Manual';
  output.Num_Documento_Extraido = 'Extraccion Manual';
  output.Fecha_Presentacion_Extraida = 'Extraccion Manual';
  output.Programa_Extraido = 'Extraccion Manual';
  output.Institucion_Extraida = 'Extraccion Manual';
  output.Num_Doc_Valido = 'Extraccion Manual';
  output.Institucion_Valida = 'Extraccion Manual';
  
  console.log(`[PROCESS-OPT] TyT marcado para extracción manual: ${reason}`);
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
    } else if (error.includes('s3_upload_failed')) {
      return "Error subiendo a S3 - Revision Manual";
    } else if (error.includes('pdf_processing_failed')) {
      return "Error procesando PDF - Revision Manual";
    } else if (error.includes('textract_timeout')) {
      return "Tiempo de análisis agotado - Revision Manual";
    } else {
      return "Error en procesamiento - Revision Manual";
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
  console.log('[PROCESS-OPT] Reparando estructura de output...');
  
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
      console.log(`[PROCESS-OPT] Campo ${key} reparado con valor: ${defaultValue}`);
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
    console.error('[PROCESS-OPT] Error durante reparación:', repairError.message);
  }
  
  console.log('[PROCESS-OPT] ✓ Estructura de output reparada');
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
};