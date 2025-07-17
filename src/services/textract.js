const AWS = require("aws-sdk");
const fs = require("fs-extra");
const path = require("path");
const { uploadToS3, updateProcessingMetadata } = require("./s3Service");

const textract = new AWS.Textract({
  httpOptions: {
    timeout: 60000,
    retries: 3,
  },
  maxRetries: 3,
  retryDelayOptions: {
    customBackoff: (retryCount) => Math.pow(2, retryCount) * 200
  }
});

const PROCESSING_CONFIG = {
  // Aumentar límite para procesar más archivos síncronamente
  maxSyncFileSize: 10 * 1024 * 1024, // 10MB en lugar de 5MB
  maxFileSize: 500 * 1024 * 1024,
  // DESACTIVAR procesamiento asíncrono hasta que se configure correctamente
  useAsyncForPDF: false,
  syncTimeout: 45000,
  asyncPollInterval: 2000,
  asyncMaxWaitTime: 300000,
  // Configuración para dividir PDFs grandes
  enablePdfSplitting: true,
  maxPagesPerSplit: 3
};

async function extractTextFromDocument(filePath, documentType, processingId = null) {
  console.log(`[TEXTRACT-OPT] Iniciando extracción optimizada: ${path.basename(filePath)}`);

  try {
    await validateInputFile(filePath);

    const fileStats = await getFileStats(filePath);
    console.log(`[TEXTRACT-OPT] Archivo: ${fileStats.name} (${fileStats.sizeFormatted})`);

    // Estrategia corregida: priorizar sync y usar splitting para PDFs grandes
    const strategy = determineProcessingStrategy(filePath, fileStats, documentType);
    console.log(`[TEXTRACT-OPT] Estrategia de procesamiento: ${strategy.type}`);

    let extractionResult;

    switch (strategy.type) {
      case 'sync':
        extractionResult = await processSyncDocument(filePath, documentType);
        break;
        
      case 'sync-split':
        extractionResult = await processSyncWithSplitting(filePath, documentType);
        break;
        
      case 'fallback-sync':
        // Intentar sync forzado incluso para archivos grandes
        extractionResult = await processSyncDocumentForced(filePath, documentType);
        break;
        
      default:
        throw new Error(`Unknown processing strategy: ${strategy.type}`);
    }

    if (!extractionResult.text || extractionResult.text.trim().length === 0) {
      throw new Error('NO_TEXT_EXTRACTED: No se extrajo texto válido del documento');
    }

    console.log(`[TEXTRACT-OPT] ✓ Extracción exitosa: ${extractionResult.text.length} caracteres`);
    console.log(`[TEXTRACT-OPT] Método usado: ${extractionResult.method}, Tiempo: ${extractionResult.processingTime}ms`);

    return extractionResult.text;

  } catch (error) {
    console.error(`[TEXTRACT-OPT] Error en extracción:`, error.message);
    throw categorizeTextractError(error);
  }
}

function determineProcessingStrategy(filePath, fileStats, documentType) {
  const fileExtension = path.extname(filePath).toLowerCase();
  const fileSize = fileStats.size;

  // Siempre intentar sync primero para archivos menores a 10MB
  if (fileSize <= PROCESSING_CONFIG.maxSyncFileSize) {
    return {
      type: 'sync',
      reason: `File size ${fileStats.sizeFormatted} suitable for sync processing`
    };
  }

  // Para PDFs grandes, usar splitting si está habilitado
  if (fileExtension === '.pdf' && PROCESSING_CONFIG.enablePdfSplitting) {
    return {
      type: 'sync-split',
      reason: `Large PDF will be split and processed in parts`
    };
  }

  // Como último recurso, intentar sync forzado
  return {
    type: 'fallback-sync',
    reason: 'Fallback to forced sync processing'
  };
}

async function processSyncDocument(filePath, documentType) {
  const startTime = Date.now();
  
  try {
    console.log(`[TEXTRACT-OPT] Procesamiento sincrónico iniciado`);

    const documentBuffer = await fs.readFile(filePath);

    if (documentBuffer.length > PROCESSING_CONFIG.maxSyncFileSize) {
      throw new Error(`File too large for sync processing: ${formatBytes(documentBuffer.length)}`);
    }

    const params = {
      Document: {
        Bytes: documentBuffer,
      },
    };

    const textractPromise = textract.detectDocumentText(params).promise();
    const result = await Promise.race([
      textractPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TEXTRACT_SYNC_TIMEOUT')), PROCESSING_CONFIG.syncTimeout)
      )
    ]);

    const extractedText = extractTextFromTextractResult(result);
    const processingTime = Date.now() - startTime;

    console.log(`[TEXTRACT-OPT] ✓ Sync processing completado: ${extractedText.length} caracteres en ${processingTime}ms`);

    return {
      text: extractedText,
      method: 'sync',
      processingTime,
      metadata: {
        blockCount: result.Blocks?.length || 0,
        documentMetadata: result.DocumentMetadata
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[TEXTRACT-OPT] Error en procesamiento sync después de ${processingTime}ms:`, error.message);
    throw error;
  }
}

async function processSyncWithSplitting(filePath, documentType) {
  const startTime = Date.now();
  
  try {
    console.log(`[TEXTRACT-OPT] Iniciando procesamiento con splitting de PDF`);

    // Importar dinámicamente el servicio de splitting
    const { splitPdfIntoPages } = require('./pdfSplitter');
    
    const pageFiles = await splitPdfIntoPages(filePath);
    console.log(`[TEXTRACT-OPT] PDF dividido en ${pageFiles.length} página(s)`);

    let combinedText = '';
    let totalBlocks = 0;
    let processedPages = 0;

    for (let i = 0; i < pageFiles.length; i++) {
      const pageFile = pageFiles[i];
      
      try {
        console.log(`[TEXTRACT-OPT] Procesando página ${i + 1}/${pageFiles.length}`);
        
        const pageBuffer = await fs.readFile(pageFile);
        
        // Verificar tamaño de la página
        if (pageBuffer.length > PROCESSING_CONFIG.maxSyncFileSize) {
          console.warn(`[TEXTRACT-OPT] Página ${i + 1} muy grande (${formatBytes(pageBuffer.length)}), saltando`);
          continue;
        }

        const params = {
          Document: {
            Bytes: pageBuffer,
          },
        };

        const result = await textract.detectDocumentText(params).promise();
        const pageText = extractTextFromTextractResult(result);
        
        if (pageText.trim().length > 0) {
          combinedText += pageText + ' ';
          totalBlocks += result.Blocks?.length || 0;
          processedPages++;
        }
        
        console.log(`[TEXTRACT-OPT] ✓ Página ${i + 1} procesada: ${pageText.length} caracteres`);
        
        // Pequeña pausa entre páginas
        if (i < pageFiles.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
      } catch (pageError) {
        console.error(`[TEXTRACT-OPT] Error procesando página ${i + 1}:`, pageError.message);
        // Continuar con las siguientes páginas
      }
    }

    const processingTime = Date.now() - startTime;
    
    if (combinedText.trim().length === 0) {
      throw new Error(`No se pudo extraer texto de ninguna página del PDF`);
    }

    console.log(`[TEXTRACT-OPT] ✓ Splitting completado: ${combinedText.length} caracteres de ${processedPages} páginas en ${processingTime}ms`);

    return {
      text: combinedText.trim(),
      method: 'sync-split',
      processingTime,
      metadata: {
        totalPages: pageFiles.length,
        processedPages,
        totalBlocks,
        averageTextPerPage: Math.round(combinedText.length / processedPages)
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[TEXTRACT-OPT] Error en splitting después de ${processingTime}ms:`, error.message);
    throw error;
  }
}

async function processSyncDocumentForced(filePath, documentType) {
  const startTime = Date.now();
  
  try {
    console.log(`[TEXTRACT-OPT] Intentando procesamiento sync forzado para archivo grande`);

    const fileStats = await fs.stat(filePath);
    
    // Si el archivo es muy grande, rechazar inmediatamente
    if (fileStats.size > 50 * 1024 * 1024) { // 50MB límite absoluto
      throw new Error(`File too large for any sync processing: ${formatBytes(fileStats.size)}`);
    }

    const documentBuffer = await fs.readFile(filePath);

    const params = {
      Document: {
        Bytes: documentBuffer,
      },
    };

    // Timeout más largo para archivos grandes
    const extendedTimeout = 90000; // 90 segundos
    
    console.log(`[TEXTRACT-OPT] Procesando archivo de ${formatBytes(documentBuffer.length)} con timeout extendido`);

    const textractPromise = textract.detectDocumentText(params).promise();
    const result = await Promise.race([
      textractPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TEXTRACT_SYNC_TIMEOUT_EXTENDED')), extendedTimeout)
      )
    ]);

    const extractedText = extractTextFromTextractResult(result);
    const processingTime = Date.now() - startTime;

    console.log(`[TEXTRACT-OPT] ✓ Forced sync completado: ${extractedText.length} caracteres en ${processingTime}ms`);

    return {
      text: extractedText,
      method: 'sync-forced',
      processingTime,
      metadata: {
        blockCount: result.Blocks?.length || 0,
        documentMetadata: result.DocumentMetadata,
        fileSize: documentBuffer.length
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[TEXTRACT-OPT] Error en forced sync después de ${processingTime}ms:`, error.message);
    throw error;
  }
}

function extractTextFromTextractResult(result) {
  if (!result.Blocks || !Array.isArray(result.Blocks)) {
    return '';
  }

  let extractedText = "";
  let lineCount = 0;
  let wordCount = 0;
  
  result.Blocks.forEach((block) => {
    if (block.BlockType === "LINE" && block.Text) {
      extractedText += block.Text + " ";
      lineCount++;
      wordCount += (block.Text.match(/\S+/g) || []).length;
    }
  });
  
  console.log(`[TEXTRACT-OPT] Extracción detallada: ${lineCount} líneas, ${wordCount} palabras`);
  
  return extractedText.trim();
}

async function validateInputFile(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('INVALID_FILE_PATH: Ruta de archivo inválida');
  }

  try {
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      throw new Error('FILE_NOT_FOUND: El archivo no existe');
    }
  } catch (existsError) {
    throw new Error(`FILE_ACCESS_ERROR: No se puede acceder al archivo - ${existsError.message}`);
  }

  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      throw new Error('NOT_A_FILE: La ruta no apunta a un archivo válido');
    }
    
    if (stats.size === 0) {
      throw new Error('EMPTY_FILE: El archivo está vacío');
    }
    
    if (stats.size > PROCESSING_CONFIG.maxFileSize) {
      throw new Error(`FILE_TOO_LARGE: Archivo de ${formatBytes(stats.size)} excede el límite de ${formatBytes(PROCESSING_CONFIG.maxFileSize)}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    const supportedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif'];
    if (!supportedExtensions.includes(ext)) {
      throw new Error(`UNSUPPORTED_FILE_TYPE: Extensión ${ext} no soportada. Tipos válidos: ${supportedExtensions.join(', ')}`);
    }

  } catch (statsError) {
    if (statsError.message.includes('FILE_TOO_LARGE') || 
        statsError.message.includes('EMPTY_FILE') || 
        statsError.message.includes('NOT_A_FILE') ||
        statsError.message.includes('UNSUPPORTED_FILE_TYPE')) {
      throw statsError;
    }
    throw new Error(`FILE_STATS_ERROR: Error obteniendo estadísticas - ${statsError.message}`);
  }

  // Validación de contenido solo para archivos pequeños
  if ((await fs.stat(filePath)).size <= PROCESSING_CONFIG.maxSyncFileSize) {
    try {
      await validateFileContent(filePath);
    } catch (contentError) {
      console.warn(`[TEXTRACT-OPT] Content validation warning: ${contentError.message}`);
    }
  }
}

async function validateFileContent(filePath) {
  try {
    const documentBuffer = await fs.readFile(filePath);
    
    if (documentBuffer.length === 0) {
      throw new Error('EMPTY_BUFFER: Buffer de archivo vacío');
    }

    const headerCheck = documentBuffer.slice(0, 100).toString().toLowerCase();
    if (headerCheck.includes('<!doctype') || 
        headerCheck.includes('<html') || 
        headerCheck.includes('<head') ||
        headerCheck.includes('<body')) {
      throw new Error('HTML_FILE_DETECTED: Archivo HTML detectado, no es un documento válido');
    }

    const contentSnippet = documentBuffer.slice(0, 500).toString().toLowerCase();
    if (contentSnippet.includes('error 404') ||
        contentSnippet.includes('page not found') ||
        contentSnippet.includes('access denied') ||
        contentSnippet.includes('unauthorized')) {
      throw new Error('ERROR_PAGE_DETECTED: Archivo contiene página de error web');
    }
    
  } catch (readError) {
    if (readError.message.includes('HTML_FILE_DETECTED') || 
        readError.message.includes('ERROR_PAGE_DETECTED') ||
        readError.message.includes('EMPTY_BUFFER')) {
      throw readError;
    }
    throw new Error(`FILE_READ_ERROR: Error leyendo archivo - ${readError.message}`);
  }
}

async function getFileStats(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const extension = path.extname(filePath).toLowerCase();
    
    return {
      size: stats.size,
      sizeFormatted: formatBytes(stats.size),
      name: path.basename(filePath),
      extension,
      created: stats.birthtime,
      modified: stats.mtime,
      isLarge: stats.size > PROCESSING_CONFIG.maxSyncFileSize,
      isPDF: extension === '.pdf',
      isImage: ['.jpg', '.jpeg', '.png', '.tiff', '.tif'].includes(extension)
    };
  } catch (error) {
    return {
      size: 0,
      sizeFormatted: '0 B',
      name: path.basename(filePath),
      extension: '',
      error: error.message,
      isLarge: false,
      isPDF: false,
      isImage: false
    };
  }
}

function categorizeTextractError(error) {
  const errorMessage = error.message || '';
  const errorCode = error.code || '';

  if (errorMessage.includes('S3_UPLOAD_ERROR')) {
    return new Error('S3_UPLOAD_FAILED: Error subiendo archivo a S3 para procesamiento');
  }
  
  if (errorMessage.includes('MULTIPAGE_PDF_ERROR')) {
    return new Error('PDF_PROCESSING_FAILED: Error procesando PDF multipágina');
  }

  if (errorMessage === 'TEXTRACT_SYNC_TIMEOUT' || errorMessage === 'TEXTRACT_SYNC_TIMEOUT_EXTENDED') {
    return new Error('TEXTRACT_TIMEOUT: Tiempo de procesamiento sincrónico agotado');
  }

  if (errorCode === 'InvalidParameterException' || errorMessage.includes('InvalidParameter')) {
    return new Error('INVALID_DOCUMENT: El documento no es válido para Textract');
  }
  
  if (errorCode === 'DocumentTooLargeException' || errorMessage.includes('DocumentTooLarge')) {
    return new Error('DOCUMENT_TOO_LARGE: El documento es muy grande para Textract');
  }
  
  if (errorCode === 'UnsupportedDocumentException' || errorMessage.includes('UnsupportedDocument')) {
    return new Error('UNSUPPORTED_FILE_TYPE: Tipo de archivo no soportado por Textract');
  }
  
  if (errorCode === 'ThrottlingException' || errorMessage.includes('Throttling')) {
    return new Error('TEXTRACT_THROTTLED: Límite de velocidad de Textract excedido');
  }
  
  if (errorCode === 'AccessDeniedException' || errorMessage.includes('AccessDenied')) {
    return new Error('TEXTRACT_ACCESS_DENIED: Sin permisos para usar Textract');
  }
  
  if (errorCode === 'ProvisionedThroughputExceededException') {
    return new Error('TEXTRACT_QUOTA_EXCEEDED: Cuota de Textract excedida');
  }
  
  if (errorMessage.includes('network') || errorMessage.includes('ENOTFOUND') || errorMessage.includes('timeout')) {
    return new Error(`TEXTRACT_NETWORK_ERROR: Error de red con Textract - ${errorMessage}`);
  }
  
  return new Error(`TEXTRACT_UNKNOWN_ERROR: ${errorMessage}`);
}

function formatBytes(bytes) {
  try {
    if (bytes === 0) return '0 B';
    if (typeof bytes !== 'number' || isNaN(bytes)) return 'Unknown size';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  } catch (error) {
    return 'Format error';
  }
}

function getProcessingConfig() {
  return {
    ...PROCESSING_CONFIG,
    maxSyncFileSizeFormatted: formatBytes(PROCESSING_CONFIG.maxSyncFileSize),
    maxFileSizeFormatted: formatBytes(PROCESSING_CONFIG.maxFileSize)
  };
}

module.exports = {
  extractTextFromDocument,
  getProcessingConfig,
  determineProcessingStrategy,
  validateInputFile,
  getFileStats
};