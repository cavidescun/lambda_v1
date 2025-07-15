const { google } = require("googleapis");
const fs = require("fs-extra");
const path = require("path");

const { createTempDirectory } = require("../utils/tempStorage");
const { googleAuth } = require("./googleAuth");

async function downloadDocuments(urls) {
  console.log(`[DOWNLOAD] Iniciando descarga robusta de ${urls?.length || 0} documentos`);
  
  let tempDir;
  try {
    tempDir = await createTempDirectory();
    console.log(`[DOWNLOAD] Directorio temporal creado: ${path.basename(tempDir)}`);
  } catch (tempError) {
    console.error(`[DOWNLOAD] Error crítico creando directorio temporal:`, tempError.message);
    return createEmergencyDownloadResults(urls, 'TEMP_DIR_ERROR', tempError.message);
  }

  // Validar URLs de entrada
  let validUrls = [];
  try {
    validUrls = validateAndSanitizeUrls(urls);
    console.log(`[DOWNLOAD] URLs validadas: ${validUrls.length} de ${urls?.length || 0} totales`);
  } catch (urlError) {
    console.error(`[DOWNLOAD] Error validando URLs:`, urlError.message);
    return createEmergencyDownloadResults(urls, 'URL_VALIDATION_ERROR', urlError.message);
  }

  const downloadedFiles = [];

  // Obtener credenciales de Google con manejo robusto
  let googleCredentials;
  try {
    googleCredentials = await googleAuth();
    console.log(`[DOWNLOAD] Credenciales de Google obtenidas exitosamente`);
  } catch (authError) {
    console.error(`[DOWNLOAD] Error crítico de autenticación:`, authError.message);
    return createDownloadErrorResults(validUrls, 'AUTH_GENERAL_ERROR', authError.message);
  }

  // Validar credenciales
  if (!googleCredentials?.access_token) {
    console.error(`[DOWNLOAD] Credenciales inválidas: sin access_token`);
    return createDownloadErrorResults(validUrls, 'NO_ACCESS_TOKEN', 'Credenciales sin access_token válido');
  }

  // Procesar cada URL con manejo individual de errores
  for (let i = 0; i < validUrls.length; i++) {
    const url = validUrls[i];
    const urlNumber = i + 1;
    
    console.log(`[DOWNLOAD] Procesando ${urlNumber}/${validUrls.length}: ${truncateUrl(url)}`);
    
    try {
      const result = await safeDownloadSingleFile(url, tempDir, googleCredentials, urlNumber);
      downloadedFiles.push(result);
      
      if (result.status === 'success') {
        console.log(`[DOWNLOAD] ✓ ${urlNumber}/${validUrls.length} exitoso: ${result.fileName} (${formatBytes(result.size)})`);
      } else {
        console.error(`[DOWNLOAD] ✗ ${urlNumber}/${validUrls.length} falló: ${result.error}`);
      }
      
    } catch (criticalError) {
      console.error(`[DOWNLOAD] Error crítico en archivo ${urlNumber}:`, criticalError.message);
      
      downloadedFiles.push({
        originalUrl: url,
        fileId: 'critical_error',
        path: null,
        fileName: null,
        size: 0,
        status: 'error',
        error: `CRITICAL_DOWNLOAD_ERROR: ${criticalError.message}`
      });
    }

    // Pequeña pausa para evitar throttling
    if (i < validUrls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Generar resumen final
  const successful = downloadedFiles.filter(f => f.status === 'success').length;
  const failed = downloadedFiles.filter(f => f.status === 'error').length;
  
  console.log(`[DOWNLOAD] Resumen final: ${successful} exitosas, ${failed} fallidas de ${validUrls.length} totales`);
  
  if (failed > 0) {
    console.log(`[DOWNLOAD] Archivos con errores:`);
    downloadedFiles
      .filter(f => f.status === 'error')
      .forEach((f, index) => {
        console.log(`[DOWNLOAD]   ${index + 1}. ${truncateUrl(f.originalUrl)}: ${f.error}`);
      });
  }

  return downloadedFiles;
}

// Función para validar y sanitizar URLs
function validateAndSanitizeUrls(urls) {
  if (!urls) {
    console.warn(`[DOWNLOAD] URLs es null/undefined`);
    return [];
  }
  
  if (!Array.isArray(urls)) {
    console.warn(`[DOWNLOAD] URLs no es un array, intentando convertir`);
    try {
      urls = [urls];
    } catch (conversionError) {
      throw new Error(`URLs no es un array válido: ${conversionError.message}`);
    }
  }
  
  if (urls.length === 0) {
    console.warn(`[DOWNLOAD] Array de URLs está vacío`);
    return [];
  }
  
  const validUrls = [];
  const invalidUrls = [];
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    
    try {
      if (!url || typeof url !== 'string') {
        invalidUrls.push({ index: i, url, reason: 'No es string válido' });
        continue;
      }
      
      const trimmedUrl = url.trim();
      if (trimmedUrl.length === 0) {
        invalidUrls.push({ index: i, url, reason: 'URL vacía' });
        continue;
      }
      
      if (!trimmedUrl.includes('drive.google.com') && !trimmedUrl.includes('docs.google.com')) {
        invalidUrls.push({ index: i, url: trimmedUrl, reason: 'No es URL de Google Drive' });
        continue;
      }
      
      // Verificar que se pueda extraer file ID
      try {
        extractFileIdFromUrl(trimmedUrl);
        validUrls.push(trimmedUrl);
      } catch (fileIdError) {
        invalidUrls.push({ index: i, url: trimmedUrl, reason: `No se puede extraer file ID: ${fileIdError.message}` });
      }
      
    } catch (urlError) {
      invalidUrls.push({ index: i, url, reason: `Error procesando: ${urlError.message}` });
    }
  }
  
  if (invalidUrls.length > 0) {
    console.warn(`[DOWNLOAD] ${invalidUrls.length} URLs inválidas encontradas:`);
    invalidUrls.forEach(({ index, url, reason }) => {
      console.warn(`[DOWNLOAD]   ${index + 1}. ${truncateUrl(url)}: ${reason}`);
    });
  }
  
  return validUrls;
}

// Función para descargar un archivo individual de forma segura
async function safeDownloadSingleFile(url, tempDir, googleCredentials, urlNumber) {
  try {
    // Extraer file ID con validación
    let fileId;
    try {
      fileId = extractFileIdFromUrl(url);
      console.log(`[DOWNLOAD] File ID extraído para ${urlNumber}: ${fileId}`);
    } catch (fileIdError) {
      return {
        originalUrl: url,
        fileId: null,
        path: null,
        fileName: null,
        size: 0,
        status: 'error',
        error: `INVALID_URL: ${fileIdError.message}`
      };
    }
    
    // Configurar cliente OAuth2 con validación
    let oauth2Client;
    try {
      oauth2Client = new google.auth.OAuth2(
        googleCredentials.client_id,
        googleCredentials.client_secret
      );
      
      oauth2Client.setCredentials({
        access_token: googleCredentials.access_token,
        refresh_token: googleCredentials.refresh_token,
      });
      
    } catch (authSetupError) {
      return {
        originalUrl: url,
        fileId,
        path: null,
        fileName: null,
        size: 0,
        status: 'error',
        error: `AUTH_SETUP_ERROR: ${authSetupError.message}`
      };
    }

    // Descargar archivo con timeout y reintentos
    try {
      const filePath = await downloadFileFromDriveWithRetry(fileId, tempDir, oauth2Client, 3);
      const stats = await fs.stat(filePath);
      
      return {
        originalUrl: url,
        fileId,
        path: filePath,
        fileName: path.basename(filePath),
        size: stats.size,
        status: 'success',
        error: null
      };
      
    } catch (downloadError) {
      return {
        originalUrl: url,
        fileId,
        path: null,
        fileName: null,
        size: 0,
        status: 'error',
        error: categorizeDownloadError(downloadError)
      };
    }
    
  } catch (unexpectedError) {
    return {
      originalUrl: url,
      fileId: 'unknown',
      path: null,
      fileName: null,
      size: 0,
      status: 'error',
      error: `UNEXPECTED_ERROR: ${unexpectedError.message}`
    };
  }
}

// Función para descargar con reintentos
async function downloadFileFromDriveWithRetry(fileId, tempDir, oauth2Client, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[DOWNLOAD] Intento ${attempt}/${maxRetries} para ${fileId}`);
      return await downloadFileFromDrive(fileId, tempDir, oauth2Client);
    } catch (error) {
      lastError = error;
      console.warn(`[DOWNLOAD] Intento ${attempt} falló para ${fileId}: ${error.message}`);
      
      // No reintentar en ciertos errores
      if (error.code === 404 || error.code === 403 || 
          error.message.includes('PERMISSION_DENIED') ||
          error.message.includes('FILE_NOT_FOUND')) {
        throw error;
      }
      
      // Esperar antes del siguiente intento (excepto en el último)
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
  throw lastError;
}

async function downloadFileFromDrive(fileId, tempDir, oauth2Client) {
  try {
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    
    // Obtener metadata del archivo con timeout
    let fileMetadata;
    try {
      const metadataPromise = drive.files.get({
        fileId: fileId,
        fields: "name,mimeType,size",
      });
      
      fileMetadata = await Promise.race([
        metadataPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('METADATA_TIMEOUT')), 30000)
        )
      ]);
    } catch (metadataError) {
      if (metadataError.message === 'METADATA_TIMEOUT') {
        throw new Error(`METADATA_TIMEOUT: Tiempo agotado obteniendo metadata para ${fileId}`);
      }
      throw metadataError;
    }

    const fileName = fileMetadata.data.name || `${fileId}.pdf`;
    const sanitizedFileName = sanitizeFileName(fileName);
    const filePath = path.join(tempDir, sanitizedFileName);
    
    console.log(`[DOWNLOAD] Descargando: ${sanitizedFileName}`);
    
    // Descargar el archivo con timeout
    const downloadPromise = drive.files.get(
      {
        fileId: fileId,
        alt: "media",
      },
      { responseType: "stream" }
    );
    
    const response = await Promise.race([
      downloadPromise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('DOWNLOAD_REQUEST_TIMEOUT')), 60000)
      )
    ]);

    const writer = fs.createWriteStream(filePath);
    
    return new Promise((resolve, reject) => {
      let downloadTimeout;
      let totalBytes = 0;
      
      // Timeout de 5 minutos para la descarga completa
      downloadTimeout = setTimeout(() => {
        writer.destroy();
        reject(new Error('DOWNLOAD_STREAM_TIMEOUT: Tiempo de descarga completa agotado'));
      }, 300000);
      
      response.data.on("data", (chunk) => {
        totalBytes += chunk.length;
      });
      
      response.data.on("error", (error) => {
        clearTimeout(downloadTimeout);
        writer.destroy();
        reject(new Error(`STREAM_ERROR: ${error.message}`));
      });
      
      writer.on("error", (error) => {
        clearTimeout(downloadTimeout);
        reject(new Error(`WRITE_ERROR: ${error.message}`));
      });
      
      writer.on("finish", () => {
        clearTimeout(downloadTimeout);
        console.log(`[DOWNLOAD] Descarga completada: ${formatBytes(totalBytes)}`);
        resolve(filePath);
      });
      
      response.data.pipe(writer);
    });
    
  } catch (error) {
    console.error(`[DOWNLOAD] Error descargando ${fileId}:`, error.message);
    throw categorizeDownloadError(error);
  }
}

// Función para categorizar errores de descarga
function categorizeDownloadError(error) {
  const errorMsg = error.message || '';
  const errorCode = error.code;
  
  if (errorCode === 403 || errorMsg.includes('insufficient permissions')) {
    return new Error(`PERMISSION_DENIED: Sin permisos para acceder al archivo`);
  }
  
  if (errorCode === 404 || errorMsg.includes('not found')) {
    return new Error(`FILE_NOT_FOUND: El archivo no existe o no es accesible`);
  }
  
  if (errorCode === 401 || errorMsg.includes('unauthorized')) {
    return new Error(`AUTH_ERROR: Error de autenticación`);
  }
  
  if (errorMsg.includes('TIMEOUT')) {
    return new Error(`DOWNLOAD_TIMEOUT: ${errorMsg}`);
  }
  
  if (errorCode === 429 || errorMsg.includes('quota') || errorMsg.includes('rate limit')) {
    return new Error(`RATE_LIMIT_EXCEEDED: Límite de velocidad excedido`);
  }
  
  if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('network')) {
    return new Error(`NETWORK_ERROR: Error de red - ${errorMsg}`);
  }
  
  return new Error(`DOWNLOAD_ERROR: ${errorMsg}`);
}

function extractFileIdFromUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL inválida o vacía');
  }
  
  const regexPatterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
    /drive\.google\.com\/.*[?&]id=([a-zA-Z0-9_-]+)/,
    /docs\.google\.com\/.*[?&]id=([a-zA-Z0-9_-]+)/
  ];

  for (const regex of regexPatterns) {
    const match = url.match(regex);
    if (match && match[1] && match[1].length >= 10) {
      return match[1];
    }
  }

  throw new Error(`No se pudo extraer File ID válido de la URL: ${truncateUrl(url)}`);
}

// Función para sanitizar nombres de archivo
function sanitizeFileName(fileName) {
  try {
    // Remover caracteres problemáticos
    let sanitized = fileName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    
    // Limitar longitud
    if (sanitized.length > 200) {
      const ext = path.extname(sanitized);
      const name = path.basename(sanitized, ext);
      sanitized = name.substring(0, 200 - ext.length) + ext;
    }
    
    // Asegurar que no esté vacío
    if (!sanitized || sanitized.trim().length === 0) {
      sanitized = `file_${Date.now()}.pdf`;
    }
    
    return sanitized;
  } catch (error) {
    return `file_${Date.now()}.pdf`;
  }
}

// Función para crear resultados de emergencia
function createEmergencyDownloadResults(urls, errorType, errorMessage) {
  console.warn(`[DOWNLOAD] Creando resultados de emergencia: ${errorType}`);
  
  const safeUrls = Array.isArray(urls) ? urls : (urls ? [urls] : []);
  
  return safeUrls.map((url, index) => ({
    originalUrl: url || `emergency_url_${index}`,
    fileId: null,
    path: null,
    fileName: null,
    size: 0,
    status: 'error',
    error: `${errorType}: ${errorMessage}`
  }));
}

// Función para crear resultados de error por autenticación
function createDownloadErrorResults(urls, errorType, errorMessage) {
  console.warn(`[DOWNLOAD] Creando resultados de error: ${errorType}`);
  
  return urls.map(url => {
    let fileId = null;
    try {
      fileId = extractFileIdFromUrl(url);
    } catch (fileIdError) {
      // fileId permanece null
    }
    
    return {
      originalUrl: url,
      fileId,
      path: null,
      fileName: null,
      size: 0,
      status: 'error',
      error: `${errorType}: ${errorMessage}`
    };
  });
}

// Función para truncar URLs para logging
function truncateUrl(url) {
  try {
    if (!url) return 'URL_NULL';
    if (typeof url !== 'string') return 'URL_INVALID_TYPE';
    
    if (url.length <= 60) {
      return url;
    }
    
    return url.substring(0, 30) + '...' + url.substring(url.length - 27);
  } catch (error) {
    return 'URL_TRUNCATE_ERROR';
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
  downloadDocuments
};