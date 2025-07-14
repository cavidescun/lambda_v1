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
  try {
    console.log(`[TEXTRACT] Iniciando extracción de texto de: ${path.basename(filePath)}`);
    
    const fileStats = await getFileStats(filePath);
    console.log(`[TEXTRACT] Archivo: ${fileStats.name} (${fileStats.sizeFormatted})`);
    console.log(`[TEXTRACT] Límite de páginas configurado: ${getMaxPagesLimit()}`);

    const documentBuffer = await fs.readFile(filePath);
    const headerCheck = documentBuffer.slice(0, 20).toString();
    if (
      headerCheck.startsWith("<!DOCTYPE") ||
      headerCheck.startsWith("<html") ||
      headerCheck.startsWith("<!do")
    ) {
      throw new Error("HTML_FILE_DETECTED");
    }

    const pageFiles = await splitPdfIntoPages(filePath);
    const totalFilesToProcess = pageFiles.length;
    const maxPagesLimit = getMaxPagesLimit();
    
    console.log(`[TEXTRACT] Procesando ${totalFilesToProcess} archivo(s) (límite: ${maxPagesLimit} páginas)`);

    let combinedText = "";
    const extractionResults = [];
    let totalCharacters = 0;

    for (let i = 0; i < totalFilesToProcess; i++) {
      const pageFile = pageFiles[i];
      const pageNumber = i + 1;
      
      try {
        const startTime = Date.now();
        console.log(`[TEXTRACT] Extrayendo texto de página ${pageNumber}/${totalFilesToProcess}: ${path.basename(pageFile)}`);
        
        const pageText = await extractTextFromSingleFile(pageFile);
        const processingTime = Date.now() - startTime;
        
        if (pageText && pageText.trim().length > 0) {
          combinedText += pageText + " ";
          totalCharacters += pageText.length;
          
          extractionResults.push({
            page: pageNumber,
            file: path.basename(pageFile),
            textLength: pageText.length,
            processingTimeMs: processingTime,
            success: true
          });
          
          console.log(`[TEXTRACT] ✓ Página ${pageNumber}: ${pageText.length} caracteres extraídos en ${processingTime}ms`);
        } else {
          extractionResults.push({
            page: pageNumber,
            file: path.basename(pageFile),
            textLength: 0,
            processingTimeMs: processingTime,
            success: false,
            error: "No se extrajo texto"
          });
          console.warn(`[TEXTRACT] ⚠️ Página ${pageNumber}: No se extrajo texto (${processingTime}ms)`);
        }
      } catch (pageError) {
        extractionResults.push({
          page: pageNumber,
          file: path.basename(pageFile),
          textLength: 0,
          processingTimeMs: 0,
          success: false,
          error: pageError.message
        });
        console.error(`[TEXTRACT] ✗ Error en página ${pageNumber}:`, pageError.message);
      }
    }

    // Limpiar archivos temporales si se dividieron páginas
    if (pageFiles.length > 1) {
      await cleanupSplitFiles(pageFiles, filePath);
    }

    const successfulPages = extractionResults.filter(r => r.success).length;
    const totalTextLength = combinedText.trim().length;
    const totalProcessingTime = extractionResults.reduce((sum, r) => sum + (r.processingTimeMs || 0), 0);

    console.log(`[TEXTRACT] Resumen de extracción:`);
    console.log(`[TEXTRACT]   - Páginas procesadas: ${successfulPages}/${totalFilesToProcess}`);
    console.log(`[TEXTRACT]   - Texto total extraído: ${totalTextLength} caracteres`);
    console.log(`[TEXTRACT]   - Tiempo total de procesamiento: ${totalProcessingTime}ms`);
    console.log(`[TEXTRACT]   - Límite de páginas aplicado: ${getMaxPagesLimit()}`);

    if (totalTextLength === 0) {
      throw new Error("NO_TEXT_EXTRACTED");
    }

    // Verificar si el texto extraído es suficiente
    if (totalTextLength < 50) {
      console.warn(`[TEXTRACT] ⚠️ Texto extraído muy corto (${totalTextLength} caracteres). Posible problema de calidad.`);
    }

    return combinedText.trim();

  } catch (error) {
    console.error(`[TEXTRACT] Error en extracción:`, error.message);
    throw error;
  }
}

async function extractTextFromSingleFile(filePath) {
  try {
    const documentBuffer = await fs.readFile(filePath);
    
    // Verificar tamaño del archivo antes de enviar a Textract
    const fileSizeBytes = documentBuffer.length;
    const maxSizeBytes = 10 * 1024 * 1024; // 10MB límite de Textract
    
    if (fileSizeBytes > maxSizeBytes) {
      throw new Error(`DOCUMENT_TOO_LARGE: Archivo de ${formatBytes(fileSizeBytes)} excede el límite de ${formatBytes(maxSizeBytes)}`);
    }
    
    const params = {
      Document: {
        Bytes: documentBuffer,
      },
    };

    const result = await textract.detectDocumentText(params).promise();

    let extractedText = "";
    let lineCount = 0;
    
    if (result.Blocks && result.Blocks.length > 0) {
      result.Blocks.forEach((block) => {
        if (block.BlockType === "LINE") {
          extractedText += block.Text + " ";
          lineCount++;
        }
      });
    }

    console.log(`[TEXTRACT] Archivo individual procesado: ${lineCount} líneas de texto detectadas`);
    return extractedText.trim();
    
  } catch (error) {
    console.error(`[TEXTRACT] Error en archivo individual ${path.basename(filePath)}:`, error.message);
    
    // Mejorar el manejo de errores específicos de AWS Textract
    if (error.code === 'InvalidParameterException') {
      throw new Error(`INVALID_DOCUMENT: El documento no es válido para Textract - ${error.message}`);
    } else if (error.code === 'DocumentTooLargeException') {
      throw new Error(`DOCUMENT_TOO_LARGE: El documento es muy grande para Textract - ${error.message}`);
    } else if (error.code === 'UnsupportedDocumentException') {
      throw new Error(`UNSUPPORTED_FILE_TYPE: Tipo de archivo no soportado por Textract - ${error.message}`);
    } else if (error.code === 'ThrottlingException') {
      throw new Error(`TEXTRACT_THROTTLED: Límite de velocidad de Textract excedido - ${error.message}`);
    }
    
    throw error;
  }
}

async function cleanupSplitFiles(pageFiles, originalFile) {
  try {
    console.log(`[TEXTRACT] Limpiando archivos temporales de páginas divididas...`);
    
    let filesDeleted = 0;
    
    for (const pageFile of pageFiles) {
      // Solo eliminar archivos que no sean el original
      if (pageFile !== originalFile) {
        try {
          await fs.remove(pageFile);
          filesDeleted++;
          console.log(`[TEXTRACT] ✓ Eliminado: ${path.basename(pageFile)}`);
        } catch (deleteError) {
          console.warn(`[TEXTRACT] ⚠️ No se pudo eliminar ${path.basename(pageFile)}:`, deleteError.message);
        }
      }
    }

    // Limpiar directorio temporal si está vacío
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
          console.warn(`[TEXTRACT] ⚠️ No se pudo limpiar directorio ${splitDir}:`, dirError.message);
        }
      }
    }

    console.log(`[TEXTRACT] ✓ Limpieza completada: ${filesDeleted} archivos temporales eliminados`);
    
  } catch (error) {
    console.error(`[TEXTRACT] Error durante limpieza:`, error.message);
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  extractTextFromDocument,
};