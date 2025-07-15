const AWS = require("aws-sdk");
const fs = require("fs-extra");
const path = require("path");
const { splitPdfIntoPages, getFileStats, getMaxPagesLimit } = require("./pdfSplitter");

const textract = new AWS.Textract({
  httpOptions: {
    timeout: 50000,
    retries: 3,
  },
});

async function extractTextFromDocument(filePath) {
  console.log(`[TEXTRACT] Iniciando extracción robusta de texto de: ${path.basename(filePath)}`);

  try {
    await validateInputFile(filePath);
  } catch (validationError) {
    console.error(`[TEXTRACT] Validación falló:`, validationError.message);
    throw validationError;
  }

  let fileStats;
  try {
    fileStats = await getFileStats(filePath);
    console.log(`[TEXTRACT] Archivo: ${fileStats.name} (${fileStats.sizeFormatted})`);
    console.log(`[TEXTRACT] Límite de páginas configurado: ${getMaxPagesLimit()}`);
  } catch (statsError) {
    console.warn(`[TEXTRACT] No se pudieron obtener estadísticas:`, statsError.message);
    fileStats = { name: path.basename(filePath), size: 0, sizeFormatted: 'Unknown' };
  }

  try {
    await validateFileContent(filePath);
  } catch (contentError) {
    console.error(`[TEXTRACT] Contenido inválido:`, contentError.message);
    throw contentError;
  }

  let pageFiles = [];
  try {
    pageFiles = await splitPdfIntoPages(filePath);
    console.log(`[TEXTRACT] PDF dividido en ${pageFiles.length} archivo(s) para procesar`);
  } catch (splitError) {
    console.error(`[TEXTRACT] Error dividiendo PDF:`, splitError.message);
    console.log(`[TEXTRACT] Continuando con archivo original como fallback`);
    pageFiles = [filePath];
  }

  const totalFilesToProcess = pageFiles.length;
  const maxPagesLimit = getMaxPagesLimit();
  
  console.log(`[TEXTRACT] Procesando ${totalFilesToProcess} archivo(s) (límite: ${maxPagesLimit} páginas)`);

  let combinedText = "";
  const extractionResults = [];
  let totalCharacters = 0;
  let successfulExtractions = 0;

  for (let i = 0; i < totalFilesToProcess; i++) {
    const pageFile = pageFiles[i];
    const pageNumber = i + 1;
    
    try {
      const startTime = Date.now();
      console.log(`[TEXTRACT] Extrayendo texto de página ${pageNumber}/${totalFilesToProcess}: ${path.basename(pageFile)}`);
      
      const pageText = await safeExtractTextFromSingleFile(pageFile, pageNumber);
      const processingTime = Date.now() - startTime;
      
      if (pageText && pageText.trim().length > 0) {
        combinedText += pageText + " ";
        totalCharacters += pageText.length;
        successfulExtractions++;
        
        extractionResults.push({
          page: pageNumber,
          file: path.basename(pageFile),
          textLength: pageText.length,
          processingTimeMs: processingTime,
          success: true,
          error: null
        });
        
        console.log(`[TEXTRACT] ✓ Página ${pageNumber}: ${pageText.length} caracteres extraídos en ${processingTime}ms`);
      } else {
        extractionResults.push({
          page: pageNumber,
          file: path.basename(pageFile),
          textLength: 0,
          processingTimeMs: processingTime,
          success: false,
          error: "No se extrajo texto válido"
        });
        console.warn(`[TEXTRACT] ⚠️ Página ${pageNumber}: No se extrajo texto (${processingTime}ms)`);
      }
    } catch (pageError) {
      const errorMessage = categorizeTextractError(pageError);
      extractionResults.push({
        page: pageNumber,
        file: path.basename(pageFile),
        textLength: 0,
        processingTimeMs: 0,
        success: false,
        error: errorMessage
      });
      console.error(`[TEXTRACT] ✗ Error en página ${pageNumber}: ${errorMessage}`);
    }
  }

  if (pageFiles.length > 1) {
    try {
      await cleanupSplitFiles(pageFiles, filePath);
    } catch (cleanupError) {
      console.warn(`[TEXTRACT] ⚠️ Error en limpieza:`, cleanupError.message);
    }
  }

  const totalTextLength = combinedText.trim().length;
  const totalProcessingTime = extractionResults.reduce((sum, r) => sum + (r.processingTimeMs || 0), 0);

  console.log(`[TEXTRACT] Resumen de extracción:`);
  console.log(`[TEXTRACT]   - Páginas exitosas: ${successfulExtractions}/${totalFilesToProcess}`);
  console.log(`[TEXTRACT]   - Texto total extraído: ${totalTextLength} caracteres`);
  console.log(`[TEXTRACT]   - Tiempo total de procesamiento: ${totalProcessingTime}ms`);
  console.log(`[TEXTRACT]   - Límite de páginas aplicado: ${getMaxPagesLimit()}`);

  if (totalTextLength === 0) {
    const errorSummary = extractionResults
      .filter(r => !r.success)
      .map(r => r.error)
      .join('; ');
    
    throw new Error(`NO_TEXT_EXTRACTED: No se extrajo texto de ninguna página. Errores: ${errorSummary}`);
  }

  if (totalTextLength < 50) {
    console.warn(`[TEXTRACT] ⚠️ Texto extraído muy corto (${totalTextLength} caracteres). Posible problema de calidad.`);
  }

  if (successfulExtractions < totalFilesToProcess) {
    console.warn(`[TEXTRACT] ⚠️ Solo ${successfulExtractions} de ${totalFilesToProcess} páginas procesadas exitosamente`);
  }

  return combinedText.trim();
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
    
    if (stats.size > 10 * 1024 * 1024) { // 10MB
      throw new Error(`FILE_TOO_LARGE: Archivo de ${formatBytes(stats.size)} excede el límite de 10MB`);
    }
  } catch (statsError) {
    if (statsError.message.includes('FILE_TOO_LARGE') || statsError.message.includes('EMPTY_FILE') || statsError.message.includes('NOT_A_FILE')) {
      throw statsError;
    }
    throw new Error(`FILE_STATS_ERROR: Error obteniendo estadísticas - ${statsError.message}`);
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

async function safeExtractTextFromSingleFile(filePath, pageNumber) {
  try {
    return await extractTextFromSingleFile(filePath);
  } catch (error) {
    console.error(`[TEXTRACT] Error en página ${pageNumber}:`, error.message);
    throw error;
  }
}

async function extractTextFromSingleFile(filePath) {
  let documentBuffer;
  
  try {
    documentBuffer = await fs.readFile(filePath);
  } catch (readError) {
    throw new Error(`FILE_READ_FAILED: No se pudo leer el archivo - ${readError.message}`);
  }

  const fileSizeBytes = documentBuffer.length;
  const maxSizeBytes = 10 * 1024 * 1024; 
  
  if (fileSizeBytes > maxSizeBytes) {
    throw new Error(`DOCUMENT_TOO_LARGE: Archivo de ${formatBytes(fileSizeBytes)} excede el límite de ${formatBytes(maxSizeBytes)}`);
  }
  
  if (fileSizeBytes < 100) {
    throw new Error(`DOCUMENT_TOO_SMALL: Archivo de ${formatBytes(fileSizeBytes)} es demasiado pequeño para ser válido`);
  }

  const params = {
    Document: {
      Bytes: documentBuffer,
    },
  };

  let result;
  try {
    const textractPromise = textract.detectDocumentText(params).promise();
    result = await Promise.race([
      textractPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TEXTRACT_TIMEOUT')), 45000)
      )
    ]);
  } catch (textractError) {
    throw categorizeTextractError(textractError);
  }

  let extractedText = "";
  let lineCount = 0;
  let wordCount = 0;
  
  try {
    if (result.Blocks && Array.isArray(result.Blocks) && result.Blocks.length > 0) {
      result.Blocks.forEach((block) => {
        if (block.BlockType === "LINE" && block.Text) {
          extractedText += block.Text + " ";
          lineCount++;
          wordCount += (block.Text.match(/\S+/g) || []).length;
        }
      });
    }
    
    console.log(`[TEXTRACT] Procesamiento exitoso: ${lineCount} líneas, ${wordCount} palabras detectadas`);
    
    if (extractedText.trim().length === 0) {
      throw new Error('NO_TEXT_IN_BLOCKS: Textract no encontró texto legible en el documento');
    }
    
    return extractedText.trim();
    
  } catch (processingError) {
    throw new Error(`TEXT_PROCESSING_ERROR: Error procesando respuesta de Textract - ${processingError.message}`);
  }
}

function categorizeTextractError(error) {
  const errorMessage = error.message || '';
  const errorCode = error.code || '';
  
  if (errorMessage === 'TEXTRACT_TIMEOUT') {
    return new Error('TEXTRACT_TIMEOUT: Tiempo de procesamiento agotado en Textract');
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

async function cleanupSplitFiles(pageFiles, originalFile) {
  try {
    console.log(`[TEXTRACT] Limpiando archivos temporales de páginas divididas...`);
    
    let filesDeleted = 0;
    const errors = [];
    
    for (const pageFile of pageFiles) {
      if (pageFile !== originalFile) {
        try {
          await fs.remove(pageFile);
          filesDeleted++;
          console.log(`[TEXTRACT] ✓ Eliminado: ${path.basename(pageFile)}`);
        } catch (deleteError) {
          errors.push(`${path.basename(pageFile)}: ${deleteError.message}`);
          console.warn(`[TEXTRACT] ⚠️ No se pudo eliminar ${path.basename(pageFile)}:`, deleteError.message);
        }
      }
    }

    if (pageFiles.length > 1) {
      const splitDir = path.dirname(pageFiles.find(f => f !== originalFile));
      if (splitDir && splitDir !== path.dirname(originalFile)) {
        try {
          const dirContents = await fs.readdir(splitDir);
          if (dirContents.length === 0) {
            await fs.remove(splitDir);
            console.log(`[TEXTRACT] ✓ Directorio temporal eliminado: ${path.basename(splitDir)}`);
          } else {
            console.log(`[TEXTRACT] ⚠️ Directorio temporal no vacío, manteniendo: ${path.basename(splitDir)}`);
          }
        } catch (dirError) {
          errors.push(`Directorio ${path.basename(splitDir)}: ${dirError.message}`);
          console.warn(`[TEXTRACT] ⚠️ No se pudo limpiar directorio ${splitDir}:`, dirError.message);
        }
      }
    }

    console.log(`[TEXTRACT] ✓ Limpieza completada: ${filesDeleted} archivos temporales eliminados`);
    
    if (errors.length > 0) {
      console.warn(`[TEXTRACT] Errores durante limpieza: ${errors.join('; ')}`);
    }
    
  } catch (error) {
    console.error(`[TEXTRACT] Error durante limpieza:`, error.message);
  }
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

module.exports = {
  extractTextFromDocument,
};