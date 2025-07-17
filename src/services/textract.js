const AWS = require("aws-sdk");
const fs = require("fs-extra");
const path = require("path");
const { uploadToS3, processMultiPagePDF, updateProcessingMetadata } = require("./s3Service");

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
  maxSyncFileSize: 5 * 1024 * 1024,
  maxFileSize: 500 * 1024 * 1024,
  useAsyncForPDF: true,
  syncTimeout: 45000,
  asyncPollInterval: 2000,
  asyncMaxWaitTime: 300000
};

async function extractTextFromDocument(filePath, documentType, processingId = null) {
  console.log(`[TEXTRACT-OPT] Iniciando extracción optimizada: ${path.basename(filePath)}`);

  try {
    await validateInputFile(filePath);

    const fileStats = await getFileStats(filePath);
    console.log(`[TEXTRACT-OPT] Archivo: ${fileStats.name} (${fileStats.sizeFormatted})`);

    const strategy = determineProcessingStrategy(filePath, fileStats, documentType);
    console.log(`[TEXTRACT-OPT] Estrategia de procesamiento: ${strategy.type}`);

    let extractionResult;

    switch (strategy.type) {
      case 'sync':
        extractionResult = await processSyncDocument(filePath, documentType);
        break;
        
      case 'async-s3':
        if (!processingId) {
          throw new Error('Processing ID required for S3 async processing');
        }
        extractionResult = await processAsyncS3Document(filePath, documentType, processingId);
        break;
        
      case 'hybrid':
        try {
          extractionResult = await processSyncDocument(filePath, documentType);
        } catch (syncError) {
          console.warn(`[TEXTRACT-OPT] Sync falló, usando async: ${syncError.message}`);
          if (!processingId) {
            throw new Error('Processing ID required for fallback async processing');
          }
          extractionResult = await processAsyncS3Document(filePath, documentType, processingId);
        }
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

  if (fileSize > PROCESSING_CONFIG.maxSyncFileSize) {
    return {
      type: 'async-s3',
      reason: `File size ${fileStats.sizeFormatted} exceeds sync limit`
    };
  }

  if (fileExtension === '.pdf' && PROCESSING_CONFIG.useAsyncForPDF) {
    return {
      type: 'async-s3',
      reason: 'PDF documents processed async for better multi-page support'
    };
  }

  if (fileSize <= PROCESSING_CONFIG.maxSyncFileSize && 
      ['.jpg', '.jpeg', '.png', '.tiff', '.tif'].includes(fileExtension)) {
    return {
      type: 'sync',
      reason: `Small ${fileExtension} file suitable for sync processing`
    };
  }

  return {
    type: 'hybrid',
    reason: 'Use sync with async fallback'
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

async function processAsyncS3Document(filePath, documentType, processingId) {
  const startTime = Date.now();
  
  try {
    console.log(`[TEXTRACT-OPT] Procesamiento asíncrono S3 iniciado`);

    const originalFileName = path.basename(filePath);
    const s3Result = await uploadToS3(filePath, processingId, documentType, originalFileName);
    
    console.log(`[TEXTRACT-OPT] ✓ Archivo subido a S3: ${s3Result.key}`);

    if (processingId) {
      await updateProcessingMetadata(processingId, documentType, {
        s3Upload: s3Result,
        status: 'uploaded_for_analysis'
      });
    }

    const asyncResult = await processMultiPagePDF(s3Result.key, processingId, documentType);
    
    const processingTime = Date.now() - startTime;

    if (!asyncResult.success) {
      throw new Error(`Async processing failed: ${asyncResult.error}`);
    }

    console.log(`[TEXTRACT-OPT] ✓ Async processing completado: ${asyncResult.text.length} caracteres en ${processingTime}ms`);
    console.log(`[TEXTRACT-OPT] Páginas procesadas: ${asyncResult.metadata.pagesProcessed}, Bloques: ${asyncResult.metadata.totalBlocks}`);

    return {
      text: asyncResult.text,
      method: 'async-s3',
      processingTime,
      metadata: {
        s3Key: s3Result.key,
        jobId: asyncResult.metadata.jobId,
        totalBlocks: asyncResult.metadata.totalBlocks,
        pagesProcessed: asyncResult.metadata.pagesProcessed,
        textLength: asyncResult.metadata.textLength
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`[TEXTRACT-OPT] Error en procesamiento async después de ${processingTime}ms:`, error.message);

    if (processingId) {
      try {
        await updateProcessingMetadata(processingId, documentType, {
          status: 'processing_failed',
          error: error.message,
          processingTime
        });
      } catch (metadataError) {
        console.warn(`[TEXTRACT-OPT] No se pudo actualizar metadata con error:`, metadataError.message);
      }
    }
    
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

  if (errorMessage === 'TEXTRACT_SYNC_TIMEOUT') {
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