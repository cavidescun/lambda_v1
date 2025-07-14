const { google } = require("googleapis");
const fs = require("fs-extra");
const path = require("path");

const { createTempDirectory } = require("../utils/tempStorage");
const { googleAuth } = require("./googleAuth");

async function downloadDocuments(urls) {
  const tempDir = await createTempDirectory();
  const downloadedFiles = [];

  try {
    const googleCredentials = await googleAuth();
    
    for (const url of urls) {
      try {
        console.log(`[DOWNLOAD] Iniciando descarga de: ${url}`);
        
        const fileId = extractFileIdFromUrl(url);
        
        const oauth2Client = new google.auth.OAuth2(
          googleCredentials.client_id,
          googleCredentials.client_secret
        );
        
        if (googleCredentials.access_token) {
          oauth2Client.setCredentials({
            access_token: googleCredentials.access_token,
            refresh_token: googleCredentials.refresh_token,
          });

          const filePath = await downloadFileFromDrive(fileId, tempDir, oauth2Client);
          const stats = await fs.stat(filePath);
          
          downloadedFiles.push({
            originalUrl: url,
            fileId,
            path: filePath,
            fileName: path.basename(filePath),
            size: stats.size,
            status: 'success',
            error: null
          });
          
          console.log(`[DOWNLOAD] ✓ Descarga exitosa: ${path.basename(filePath)} (${formatBytes(stats.size)})`);
          
        } else {
          console.error(`[DOWNLOAD] ✗ No hay access_token en las credenciales para: ${url}`);
          
          downloadedFiles.push({
            originalUrl: url,
            fileId: extractFileIdFromUrl(url),
            path: null,
            fileName: null,
            size: 0,
            status: 'error',
            error: 'NO_ACCESS_TOKEN: Sin credenciales válidas de Google'
          });
        }
        
      } catch (fileError) {
        console.error(`[DOWNLOAD] ✗ Error descargando ${url}:`, fileError.message);
        
        // Determinar el tipo de error para un mensaje más específico
        let errorMessage = fileError.message;
        let errorCode = 'UNKNOWN_ERROR';
        
        if (fileError.message.includes('PERMISSION_DENIED')) {
          errorCode = 'PERMISSION_DENIED';
          errorMessage = 'Sin permisos para acceder al archivo';
        } else if (fileError.message.includes('FILE_NOT_FOUND')) {
          errorCode = 'FILE_NOT_FOUND';
          errorMessage = 'Archivo no encontrado o no accesible';
        } else if (fileError.message.includes('AUTH_DOWNLOAD_ERROR')) {
          errorCode = 'AUTH_ERROR';
          errorMessage = 'Error de autenticación con Google Drive';
        } else if (fileError.message.includes('No se pudo extraer el File ID')) {
          errorCode = 'INVALID_URL';
          errorMessage = 'URL de Google Drive inválida';
        } else if (fileError.code === 403) {
          errorCode = 'PERMISSION_DENIED';
          errorMessage = 'Sin permisos para acceder al archivo';
        } else if (fileError.code === 404) {
          errorCode = 'FILE_NOT_FOUND';
          errorMessage = 'Archivo no encontrado';
        } else if (fileError.code === 401) {
          errorCode = 'AUTH_ERROR';
          errorMessage = 'Error de autenticación';
        }
        
        try {
          const fileId = extractFileIdFromUrl(url);
          downloadedFiles.push({
            originalUrl: url,
            fileId,
            path: null,
            fileName: null,
            size: 0,
            status: 'error',
            error: `${errorCode}: ${errorMessage}`
          });
        } catch (urlError) {
          downloadedFiles.push({
            originalUrl: url,
            fileId: null,
            path: null,
            fileName: null,
            size: 0,
            status: 'error',
            error: `INVALID_URL: URL inválida - ${urlError.message}`
          });
        }
      }
    }
    
  } catch (authError) {
    console.error(`[DOWNLOAD] ✗ Error de autenticación general:`, authError.message);
    
    // Si falla la autenticación general, marcar todos los archivos como error
    for (const url of urls) {
      try {
        const fileId = extractFileIdFromUrl(url);
        downloadedFiles.push({
          originalUrl: url,
          fileId,
          path: null,
          fileName: null,
          size: 0,
          status: 'error',
          error: `AUTH_GENERAL_ERROR: ${authError.message}`
        });
      } catch (urlError) {
        downloadedFiles.push({
          originalUrl: url,
          fileId: null,
          path: null,
          fileName: null,
          size: 0,
          status: 'error',
          error: `AUTH_GENERAL_ERROR + INVALID_URL: ${authError.message} | ${urlError.message}`
        });
      }
    }
  }

  // Resumen de descargas
  const successful = downloadedFiles.filter(f => f.status === 'success').length;
  const failed = downloadedFiles.filter(f => f.status === 'error').length;
  
  console.log(`[DOWNLOAD] Resumen: ${successful} exitosas, ${failed} fallidas de ${urls.length} totales`);
  
  if (failed > 0) {
    console.log(`[DOWNLOAD] Archivos con errores:`);
    downloadedFiles
      .filter(f => f.status === 'error')
      .forEach(f => {
        console.log(`[DOWNLOAD]   - ${f.originalUrl}: ${f.error}`);
      });
  }

  return downloadedFiles;
}

async function downloadFileFromDrive(fileId, tempDir, oauth2Client) {
  try {
    const drive = google.drive({ version: "v3", auth: oauth2Client });
    
    // Obtener metadata del archivo
    const fileMetadata = await drive.files.get({
      fileId: fileId,
      fields: "name,mimeType,size",
    });

    const fileName = fileMetadata.data.name || `${fileId}.pdf`;
    const filePath = path.join(tempDir, fileName);
    
    // Descargar el archivo
    const response = await drive.files.get(
      {
        fileId: fileId,
        alt: "media",
      },
      { responseType: "stream" }
    );

    const writer = fs.createWriteStream(filePath);
    
    return new Promise((resolve, reject) => {
      let downloadTimeout;
      
      // Timeout de 60 segundos para la descarga
      downloadTimeout = setTimeout(() => {
        writer.destroy();
        reject(new Error('DOWNLOAD_TIMEOUT: Tiempo de descarga agotado'));
      }, 60000);
      
      response.data.on("error", (error) => {
        clearTimeout(downloadTimeout);
        writer.destroy();
        reject(error);
      });
      
      writer.on("error", (error) => {
        clearTimeout(downloadTimeout);
        reject(error);
      });
      
      writer.on("finish", () => {
        clearTimeout(downloadTimeout);
        resolve(filePath);
      });
      
      response.data.pipe(writer);
    });
    
  } catch (error) {
    console.error(`[DOWNLOAD] Error descargando ${fileId}:`, error.message);

    if (error.code === 403) {
      throw new Error(`PERMISSION_DENIED: No tienes permisos para acceder al archivo ${fileId}`);
    }

    if (error.code === 404) {
      throw new Error(`FILE_NOT_FOUND: El archivo ${fileId} no existe o no es accesible`);
    }

    if (error.code === 401) {
      throw new Error(`AUTH_ERROR: Error de autenticación para el archivo ${fileId}`);
    }

    throw new Error(`AUTH_DOWNLOAD_ERROR: ${error.message}`);
  }
}

function extractFileIdFromUrl(url) {
  const regexPatterns = [/\/file\/d\/([^/]+)/, /id=([^&]+)/, /\/d\/([^/]+)/];

  for (const regex of regexPatterns) {
    const match = url.match(regex);
    if (match && match[1]) {
      return match[1];
    }
  }

  throw new Error(`No se pudo extraer el File ID de la URL: ${url}`);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  downloadDocuments
};