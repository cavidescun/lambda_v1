const { extractDocumentUrls } = require("./services/extractUrl");
const { downloadDocuments } = require("./services/downloadDocuments");
const { cleanupTempFiles } = require("./utils/tempStorage");
const { processDocuments } = require("./services/processDocument");
// const { insertDBData } = require("./services/databaseService");

exports.handler = async (event, context) => {
  const startTime = Date.now();
  let requestBody = null;
  let responseToReturn = null;

  try {
    console.log("[MAIN] ========================================");
    console.log("[MAIN] Iniciando procesamiento de documentos...");
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

    let downloadedFiles = [];
    try {
      if (Object.keys(documentsUrl).length > 0) {
        const downloadStartTime = Date.now();
        const remainingTime = context.getRemainingTimeInMillis();

        console.log(
          `[MAIN] Iniciando descarga de documentos (tiempo restante: ${remainingTime}ms)`,
        );

        downloadedFiles = await downloadDocuments(Object.values(documentsUrl));

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
    try {
      const processStartTime = Date.now();
      const remainingTime = context.getRemainingTimeInMillis();

      console.log(
        `[MAIN] Iniciando procesamiento de documentos (tiempo restante: ${remainingTime}ms)`,
      );

      result = await processDocuments(
        requestBody,
        downloadedFiles,
        documentsUrl,
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

    // 5. Insertar en base de datos (opcional) con manejo de errores
    try {
      // Código de base de datos comentado, pero si se habilita:
      // const insertDBResult = await insertDBData(result);
      // if (!insertDBResult.success) {
      //   console.error("[MAIN] ✗ Error insertando en base de datos, pero continuando");
      //   result.db_insert_status = "Error en inserción DB";
      // } else {
      //   result.db_insert_status = "Exitoso";
      // }
    } catch (dbError) {
      console.error("[MAIN] ✗ Error de base de datos:", dbError.message);
      result.db_error = dbError.message;
      result.db_insert_status = "Error en DB - datos no guardados";
      console.log("[MAIN] Continuando sin guardar en DB");
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
    // Limpieza SIEMPRE se ejecuta, con manejo de errores
    try {
      await cleanupTempFiles();
      console.log("[MAIN] ✓ Limpieza de archivos temporales completada");
    } catch (cleanupError) {
      console.error("[MAIN] ⚠️ Error en limpieza:", cleanupError.message);
      // No afecta la respuesta, solo logging
    }

    const finalTime = Date.now() - startTime;
    console.log(`[MAIN] Proceso finalizado - Tiempo total: ${finalTime}ms`);
    console.log("[MAIN] ========================================");

    // Garantizar que SIEMPRE retornamos una respuesta
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

// Función para crear resultado por defecto
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

// Función para crear resultado de emergencia
function createEmergencyResult(requestBody, error) {
  const baseResult = createDefaultResult(requestBody);

  // Marcar todos los documentos como error crítico
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

// Función para marcar todos los documentos como error
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

  // Marcar campos de extracción como manual
  result.EK = "Extraccion Manual - Error Sistema";
  result.Num_Documento_Extraido = "Extraccion Manual - Error Sistema";
  result.Institucion_Extraida = "Extraccion Manual - Error Sistema";
  result.Programa_Extraido = "Extraccion Manual - Error Sistema";
  result.Fecha_Presentacion_Extraida = "Extraccion Manual - Error Sistema";
  result.Institucion_Valida = "Revision Manual - Error Sistema";
  result.Num_Doc_Valido = "Revision Manual - Error Sistema";
}

function formatResponse(statusCode, body) {
  // Garantizar que el body sea un objeto válido
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
      "X-Lambda-Function": "document-processor",
      "X-Error-Handling": "ROBUST_MODE",
    },
    body: JSON.stringify(safeBody, null, statusCode >= 400 ? 2 : 0),
  };

  console.log(`[MAIN] Respuesta generada - Status: ${statusCode}`);

  // Log adicional para errores
  if (statusCode >= 400) {
    console.error(
      `[MAIN] Respuesta de error: ${JSON.stringify(safeBody, null, 2)}`,
    );
  }

  return response;
}

