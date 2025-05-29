
const { extractDocumentUrls } = require("./services/extractUrl");
const { downloadDocuments } = require('./services/downloadDocuments')
const {cleanupTempFiles} = require('./utils/tempStorage')
const { processDocuments} = require('./services/processDocument')

exports.handler = async (event, context) => {
  try {
    console.log('[MAIN] Iniciando procesamiento...');
    
    let requestBody;
    if (typeof event.body === "string") {
      requestBody = JSON.parse(event.body);
    } else {
      requestBody = event.body || {};
    }
    console.log('[MAIN] Request body procesado');

    const documentsUrl = extractDocumentUrls(requestBody);
    const downloadedFiles = await downloadDocuments(Object.values(documentsUrl));
    const result = await processDocuments(requestBody, downloadedFiles, documentsUrl);
    return formatResponse(200, result);
    
  } catch (error) {
    console.error("[MAIN] Error:", error.message);
    console.error("[MAIN] Stack:", error.stack);

    return formatResponse(500, {
      error: "Error interno del servidor",
      message: error.message,
      timestamp: new Date().toISOString()
    });
    
  } finally {
    cleanupTempFiles();
    console.log('[MAIN] Proceso finalizado');
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
    },
    body: JSON.stringify(body, null, statusCode >= 400 ? 2 : 0),
  };

  console.log(`[MAIN] Respuesta generada - Status: ${statusCode}`);
  return response;
}