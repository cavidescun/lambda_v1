const { extractDocumentUrls } = require("./services/extractUrl");
const { downloadDocuments } = require("./services/downloadDocuments");
const { processDocuments } = require("./services/processDocument");
const { uploadToS3, initializeS3Processing, cleanupS3Processing } = require("./services/s3Service");

exports.handler = async (event, context) => {
  const startTime = Date.now();
  let requestBody = null;
  let responseToReturn = null;

  try {
    console.log("[MAIN] ========================================");
    console.log("[MAIN] Iniciando procesamiento optimizado de documentos...");
    console.log(`[MAIN] Tiempo de inicio: ${new Date().toISOString()}`);
    console.log(
      `[MAIN] Lambda timeout configurado: ${context.getRemainingTimeInMillis()}ms`,
    );

    try {
      if (typeof event.body === "string") {
        requestBody = JSON.parse(event.body);
      } else {
        requestBody = event.body || {};
      }
      if (!requestBody || Object.keys(requestBody).length === 0) {
        console.warn("[MAIN] Request body vacío, creando estructura básica");
        requestBody = { ID: "unknown", Nombre_completo: "No especificado" };
      }

      console.log("[MAIN] ✓ Request body procesado correctamente");
      console.log(
        `[MAIN] ID de solicitud: ${requestBody.ID || "No especificado"}`,
      );
      console.log(
        `[MAIN] Nombre: ${requestBody.Nombre_completo || "No especificado"}`,
      );
    } catch (parseError) {
      console.error(
        "[MAIN] ✗ Error procesando request body:",
        parseError.message,
      );
      requestBody = {
        ID: "parse_error",
        Nombre_completo: "Error en parseo",
        error_parsing: parseError.message,
      };
      console.log("[MAIN] Continuando con estructura básica creada");
    }

    let documentsUrl = {};
    try {
      documentsUrl = extractDocumentUrls(requestBody);
      const urlCount = Object.keys(documentsUrl).length;
      console.log(`[MAIN] ✓ ${urlCount} URL(s) de documentos extraídas`);
      if (urlCount === 0) {
        console.warn("[MAIN] ⚠️ No se encontraron URLs de documentos válidas");
      }
    } catch (urlError) {
      console.error("[MAIN] ✗ Error extrayendo URLs:", urlError.message);
      documentsUrl = {};
      console.log("[MAIN] Continuando sin documentos para procesar");
    }

    let s3ProcessingId = null;
    try {
      s3ProcessingId = await initializeS3Processing(
        requestBody.ID || "unknown",
      );
      console.log(`[MAIN] ✓ S3 processing inicializado: ${s3ProcessingId}`);
    } catch (s3InitError) {
      console.error("[MAIN] ✗ Error inicializando S3:", s3InitError.message);
    }

    let downloadedFiles = [];
    let s3UploadPromises = [];

    try {
      if (Object.keys(documentsUrl).length > 0) {
        const downloadStartTime = Date.now();
        const remainingTime = context.getRemainingTimeInMillis();

        console.log(
          `[MAIN] Iniciando descarga optimizada de documentos (tiempo restante: ${remainingTime}ms)`,
        );

        downloadedFiles = await downloadDocuments(Object.values(documentsUrl));

        if (s3ProcessingId) {
          downloadedFiles.forEach((file, index) => {
            if (file.status === "success") {
              const docType = Object.keys(documentsUrl)[index];
              const uploadPromise = uploadToS3(
                file.path,
                s3ProcessingId,
                docType,
                file.fileName,
              )
                .then((s3Result) => {
                  file.s3Info = s3Result;
                  console.log(
                    `[MAIN] ✓ ${file.fileName} subido a S3: ${s3Result.key}`,
                  );
                  return s3Result;
                })
                .catch((uploadError) => {
                  console.error(
                    `[MAIN] ✗ Error subiendo ${file.fileName} a S3:`,
                    uploadError.message,
                  );
                  file.s3Error = uploadError.message;
                  return null;
                });
              s3UploadPromises.push(uploadPromise);
            }
          });
        }

        const downloadTime = Date.now() - downloadStartTime;
        const successfulDownloads = downloadedFiles.filter(
          (f) => f.status === "success",
        ).length;
        const failedDownloads = downloadedFiles.filter(
          (f) => f.status === "error",
        ).length;

        console.log(`[MAIN] ✓ Descarga completada en ${downloadTime}ms`);
        console.log(
          `[MAIN] Resultado: ${successfulDownloads} exitosas, ${failedDownloads} fallidas`,
        );
      } else {
        console.log("[MAIN] No hay documentos para descargar");
      }
    } catch (downloadError) {
      console.error(
        "[MAIN] ✗ Error general en descarga:",
        downloadError.message,
      );
      downloadedFiles = Object.values(documentsUrl).map((url) => ({
        originalUrl: url,
        fileId: null,
        path: null,
        fileName: null,
        size: 0,
        status: "error",
        error: `DOWNLOAD_SYSTEM_ERROR: ${downloadError.message}`,
      }));
      console.log("[MAIN] Continuando con archivos marcados como error");
    }

    let result = createDefaultResult(requestBody);
    const processStartTime = Date.now();

    try {
      const remainingTime = context.getRemainingTimeInMillis();
      console.log(
        `[MAIN] Iniciando procesamiento optimizado de documentos (tiempo restante: ${remainingTime}ms)`,
      );

      result = await processDocuments(
        requestBody,
        downloadedFiles,
        documentsUrl,
        s3ProcessingId,
      );

      const processTime = Date.now() - processStartTime;
      console.log(`[MAIN] ✓ Procesamiento completado en ${processTime}ms`);
    } catch (processError) {
      console.error("[MAIN] ✗ Error en procesamiento:", processError.message);
      console.error("[MAIN] Stack trace:", processError.stack);

      result = createDefaultResult(requestBody);
      result.processing_error = processError.message;
      result.status =
        "Error en procesamiento - todos los documentos requieren revision manual";
      markAllDocumentsAsError(
        result,
        "Error en procesamiento - Revision Manual",
      );
      console.log("[MAIN] Continuando con resultado de error estructurado");
    }

    if (s3UploadPromises.length > 0) {
      try {
        const uploadTimeout = Math.min(
          context.getRemainingTimeInMillis() - 5000,
          30000,
        );
        console.log(
          `[MAIN] Esperando finalización de uploads S3 (timeout: ${uploadTimeout}ms)`,
        );

        const uploadResults = await Promise.allSettled(
          s3UploadPromises.map((promise) =>
            Promise.race([
              promise,
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("S3_UPLOAD_TIMEOUT")),
                  uploadTimeout,
                ),
              ),
            ]),
          ),
        );

        const successfulUploads = uploadResults.filter(
          (r) => r.status === "fulfilled",
        ).length;
        const failedUploads = uploadResults.filter(
          (r) => r.status === "rejected",
        ).length;

        console.log(
          `[MAIN] ✓ S3 uploads completados: ${successfulUploads} exitosos, ${failedUploads} fallidos`,
        );

        result.s3_upload_status = {
          successful: successfulUploads,
          failed: failedUploads,
          processing_id: s3ProcessingId,
        };
      } catch (uploadWaitError) {
        console.error(
          "[MAIN] ✗ Error esperando uploads S3:",
          uploadWaitError.message,
        );
        result.s3_upload_error = uploadWaitError.message;
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`[MAIN] ✓ Proceso completado en ${totalTime}ms`);
    console.log(`[MAIN] Tiempo final: ${new Date().toISOString()}`);

    responseToReturn = formatResponse(200, {
      ...result,
    });
  } catch (criticalError) {
    const totalTime = Date.now() - startTime;
    console.error("[MAIN] ✗ Error crítico no manejado:", criticalError.message);
    console.error("[MAIN] Stack completo:", criticalError.stack);
    console.error(`[MAIN] Tiempo hasta el error: ${totalTime}ms`);
    console.error(
      `[MAIN] Memoria utilizada: ${JSON.stringify(process.memoryUsage())}`,
    );

    const emergencyResult = createEmergencyResult(requestBody, criticalError);

    responseToReturn = formatResponse(500, {
      ...emergencyResult,
      processing_time_ms: totalTime,
      timestamp: new Date().toISOString(),
      error_level: "CRITICAL",
      request_id: requestBody?.ID || "unknown",
    });
  } finally {
    const finalTime = Date.now() - startTime;
    console.log(`[MAIN] Proceso finalizado - Tiempo total: ${finalTime}ms`);
    console.log("[MAIN] ========================================");

    if (s3ProcessingId) {
    try {
      await cleanupS3Processing(s3ProcessingId);
      console.log(`[MAIN] ✓ Archivos S3 limpiados: ${s3ProcessingId}`);
    } catch (cleanupError) {
      console.warn(`[MAIN] ⚠️ Error limpiando S3:`, cleanupError.message);
    }
  }
    if (!responseToReturn) {
      console.error(
        "[MAIN] ⚠️ No se generó respuesta, creando respuesta de emergencia",
      );
      const emergencyResult = createEmergencyResult(
        requestBody,
        new Error("No response generated"),
      );
      responseToReturn = formatResponse(500, emergencyResult);
    }
  }

  return responseToReturn;
};

function createDefaultResult(requestBody) {
  return {
    ID: requestBody?.ID || "unknown",
    NombreCompleto: requestBody?.Nombre_completo || "No especificado",
    TipoDocumento: requestBody?.Tipo_de_documento || "No especificado",
    NumeroDocumento: requestBody?.Numero_de_Documento || "No especificado",
    Modalidad: requestBody?.Modalidad || "No especificado",
    NivelDeFormacionSolicitadoParaGrado:
      requestBody?.Nivel_de_formacion_del_cual_esta_solicitando_grado ||
      "No especificado",
    ProgramaDelCualSolicita:
      requestBody?.Programa_del_cual_esta_solicitando_grado ||
      "No especificado",
    CorreoInsitucional:
      requestBody?.Correo_electronico_institucional || "No especificado",
    CorreoPersonal:
      requestBody?.Correo_electronico_personal || "No especificado",
    FotocopiaDocumento: "Documento no adjunto",
    DiplomayActaGradoBachiller: "Documento no adjunto",
    DiplomayActaGradoTecnico: "Documento no adjunto",
    DiplomayActaGradoTecnologo: "Documento no adjunto",
    DiplomayActaGradoPregrado: "Documento no adjunto",
    ResultadoSaberProDelNivelParaGrado: "Documento no adjunto",
    ExamenIcfes_11: "Documento no adjunto",
    RecibiDePagoDerechosDeGrado: "Documento no adjunto",
    Encuesta_M0: "Documento no adjunto",
    Acta_Homologacion: "Documento no adjunto",
    EK: "N/A",
    Autorizacion_tratamiento_de_datos:
      requestBody?.Autorizacion_tratamiento_de_datos || "No especificado",
    Num_Documento_Extraido: "N/A",
    Institucion_Extraida: "N/A",
    Programa_Extraido: "N/A",
    Fecha_Presentacion_Extraida: "N/A",
    Institucion_Valida: "N/A",
    Num_Doc_Valido: "N/A",
  };
}

function createEmergencyResult(requestBody, error) {
  const baseResult = createDefaultResult(requestBody);
  markAllDocumentsAsError(
    baseResult,
    "Error crítico del sistema - Revision Manual",
  );

  return {
    ...baseResult,
    status: "Error crítico en el procesamiento",
    error_message: error?.message || "Error desconocido",
    error_type: "SYSTEM_CRITICAL_ERROR",
    all_documents_require_manual_review: true,
    system_status: "FAILED_BUT_RECOVERED",
  };
}

function markAllDocumentsAsError(result, errorMessage) {
  const documentFields = [
    "FotocopiaDocumento",
    "DiplomayActaGradoBachiller",
    "DiplomayActaGradoTecnico",
    "DiplomayActaGradoTecnologo",
    "DiplomayActaGradoPregrado",
    "ResultadoSaberProDelNivelParaGrado",
    "ExamenIcfes_11",
    "RecibiDePagoDerechosDeGrado",
    "Encuesta_M0",
    "Acta_Homologacion",
  ];

  documentFields.forEach((field) => {
    result[field] = errorMessage;
  });

  result.EK = "Extraccion Manual - Error Sistema";
  result.Num_Documento_Extraido = "Extraccion Manual - Error Sistema";
  result.Institucion_Extraida = "Extraccion Manual - Error Sistema";
  result.Programa_Extraido = "Extraccion Manual - Error Sistema";
  result.Fecha_Presentacion_Extraida = "Extraccion Manual - Error Sistema";
  result.Institucion_Valida = "Revision Manual - Error Sistema";
  result.Num_Doc_Valido = "Revision Manual - Error Sistema";
}

function formatResponse(statusCode, body) {
  let safeBody;
  try {
    safeBody =
      typeof body === "object" && body !== null
        ? body
        : { error: "Invalid response body", originalBody: body };
  } catch (bodyError) {
    console.error(
      "[MAIN] Error procesando body de respuesta:",
      bodyError.message,
    );
    safeBody = {
      error: "Response body processing failed",
      details: bodyError.message,
    };
  }

  const response = {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "X-Request-Time": new Date().toISOString(),
      "X-Lambda-Function": "document-processor-optimized",
      "X-Error-Handling": "ROBUST_MODE",
    },
    body: JSON.stringify(safeBody, null, statusCode >= 400 ? 2 : 0),
  };

  console.log(`[MAIN] Respuesta generada - Status: ${statusCode}`);

  if (statusCode >= 400) {
    console.error(
      `[MAIN] Respuesta de error: ${JSON.stringify(safeBody, null, 2)}`,
    );
  }

  return response;
}
