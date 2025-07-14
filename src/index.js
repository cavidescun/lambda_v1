const { extractDocumentUrls } = require("./services/extractUrl");
const { downloadDocuments } = require("./services/downloadDocuments");
const { cleanupTempFiles } = require("./utils/tempStorage");
const { processDocuments } = require("./services/processDocument");
// const { insertDBData } = require("./services/databaseService");

exports.handler = async (event, context) => {
  const startTime = Date.now();
  let requestBody = null;
  
  try {
    console.log("[MAIN] ========================================");
    console.log("[MAIN] Iniciando procesamiento de documentos...");
    console.log(`[MAIN] Tiempo de inicio: ${new Date().toISOString()}`);
    console.log(`[MAIN] Lambda timeout configurado: ${context.getRemainingTimeInMillis()}ms`);

    // 1. Procesar el body del request
    try {
      if (typeof event.body === "string") {
        requestBody = JSON.parse(event.body);
      } else {
        requestBody = event.body || {};
      }
      
      // Validación básica del request
      if (!requestBody || Object.keys(requestBody).length === 0) {
        throw new Error("REQUEST_BODY_EMPTY: El cuerpo de la solicitud está vacío");
      }
      
      console.log("[MAIN] ✓ Request body procesado correctamente");
      console.log(`[MAIN] ID de solicitud: ${requestBody.ID || 'No especificado'}`);
      console.log(`[MAIN] Nombre: ${requestBody.Nombre_completo || 'No especificado'}`);
      
    } catch (parseError) {
      console.error("[MAIN] ✗ Error procesando request body:", parseError.message);
      return formatResponse(400, {
        error: "Invalid request body",
        message: "El cuerpo de la solicitud no es válido",
        details: parseError.message,
        timestamp: new Date().toISOString()
      });
    }

    // 2. Extraer URLs de documentos
    let documentsUrl = {};
    try {
      documentsUrl = extractDocumentUrls(requestBody);
      const urlCount = Object.keys(documentsUrl).length;
      
      if (urlCount === 0) {
        console.warn("[MAIN] ⚠️ No se encontraron URLs de documentos válidas");
        return formatResponse(400, {
          error: "No documents found",
          message: "No se encontraron URLs de documentos válidas en la solicitud",
          timestamp: new Date().toISOString()
        });
      }
      
      console.log(`[MAIN] ✓ ${urlCount} URL(s) de documentos extraídas`);
      
    } catch (urlError) {
      console.error("[MAIN] ✗ Error extrayendo URLs:", urlError.message);
      return formatResponse(400, {
        error: "URL extraction failed",
        message: "Error al extraer URLs de documentos",
        details: urlError.message,
        timestamp: new Date().toISOString()
      });
    }

    // 3. Descargar documentos
    let downloadedFiles = [];
    try {
      const downloadStartTime = Date.now();
      const remainingTime = context.getRemainingTimeInMillis();
      
      console.log(`[MAIN] Iniciando descarga de documentos (tiempo restante: ${remainingTime}ms)`);
      
      downloadedFiles = await downloadDocuments(Object.values(documentsUrl));
      
      const downloadTime = Date.now() - downloadStartTime;
      const successfulDownloads = downloadedFiles.filter(f => f.status === 'success').length;
      const failedDownloads = downloadedFiles.filter(f => f.status === 'error').length;
      
      console.log(`[MAIN] ✓ Descarga completada en ${downloadTime}ms`);
      console.log(`[MAIN] Resultado: ${successfulDownloads} exitosas, ${failedDownloads} fallidas`);
      
      if (successfulDownloads === 0) {
        console.error("[MAIN] ✗ Ningún documento se descargó exitosamente");
        return formatResponse(400, {
          error: "Download failed",
          message: "No se pudo descargar ningún documento",
          details: downloadedFiles.map(f => ({ url: f.originalUrl, error: f.error })),
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (downloadError) {
      console.error("[MAIN] ✗ Error general en descarga:", downloadError.message);
      return formatResponse(500, {
        error: "Download error",
        message: "Error durante la descarga de documentos",
        details: downloadError.message,
        timestamp: new Date().toISOString()
      });
    }

    // 4. Procesar documentos
    let result = {};
    try {
      const processStartTime = Date.now();
      const remainingTime = context.getRemainingTimeInMillis();
      
      console.log(`[MAIN] Iniciando procesamiento de documentos (tiempo restante: ${remainingTime}ms)`);
      
      result = await processDocuments(requestBody, downloadedFiles, documentsUrl);
      
      const processTime = Date.now() - processStartTime;
      console.log(`[MAIN] ✓ Procesamiento completado en ${processTime}ms`);
      
    } catch (processError) {
      console.error("[MAIN] ✗ Error en procesamiento:", processError.message);
      console.error("[MAIN] Stack trace:", processError.stack);
      
      return formatResponse(500, {
        error: "Processing error",
        message: "Error durante el procesamiento de documentos",
        details: processError.message,
        timestamp: new Date().toISOString()
      });
    }

    // 5. Insertar en base de datos (opcional, comentado por ahora)
    // try {
    //   const insertDBResult = await insertDBData(result);
    //   if (!insertDBResult.success) {
    //     console.error("[MAIN] ✗ Error insertando en base de datos");
    //     return formatResponse(500, result);
    //   }
    // } catch (dbError) {
    //   console.error("[MAIN] ✗ Error de base de datos:", dbError.message);
    //   return formatResponse(500, {
    //     error: "Database error",
    //     message: "Error al guardar en la base de datos",
    //     details: dbError.message,
    //     result: result,
    //     timestamp: new Date().toISOString()
    //   });
    // }

    // 6. Respuesta exitosa
    const totalTime = Date.now() - startTime;
    console.log(`[MAIN] ✓ Proceso completado exitosamente en ${totalTime}ms`);
    console.log(`[MAIN] Tiempo final: ${new Date().toISOString()}`);
    
    return formatResponse(200, {
      ...result
      }
    );

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error("[MAIN] ✗ Error crítico no manejado:", error.message);
    console.error("[MAIN] Stack completo:", error.stack);
    console.error(`[MAIN] Tiempo hasta el error: ${totalTime}ms`);
    console.error(`[MAIN] Memoria utilizada: ${JSON.stringify(process.memoryUsage())}`);

    return formatResponse(500, {
      error: "Internal server error",
      message: "Error interno del servidor",
      details: error.message,
      processingTimeMs: totalTime,
      timestamp: new Date().toISOString(),
      requestId: requestBody?.ID || 'unknown'
    });

  } finally {
    // Limpieza siempre se ejecuta
    try {
      await cleanupTempFiles();
      console.log("[MAIN] ✓ Limpieza de archivos temporales completada");
    } catch (cleanupError) {
      console.error("[MAIN] ⚠️ Error en limpieza:", cleanupError.message);
    }
    
    const finalTime = Date.now() - startTime;
    console.log(`[MAIN] Proceso finalizado - Tiempo total: ${finalTime}ms`);
    console.log("[MAIN] ========================================");
  }
};

function formatResponse(statusCode, body) {
  const response = {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "X-Request-Time": new Date().toISOString(),
      "X-Lambda-Function": "document-processor",
    },
    body: JSON.stringify(body, null, statusCode >= 400 ? 2 : 0),
  };

  console.log(`[MAIN] Respuesta generada - Status: ${statusCode}`);
  
  // Log adicional para errores
  if (statusCode >= 400) {
    console.error(`[MAIN] Respuesta de error: ${JSON.stringify(body, null, 2)}`);
  }
  
  return response;
}