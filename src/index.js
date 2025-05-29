const { extractDocumentUrls } = require("./services/extractUrl");
const { downloadDocuments } = require('./services/downloadDocuments')
const {cleanupTempFiles} = require('./utils/tempStorage')
const { processDocuments} = require('./services/processDocument')

exports.handler = async (event, context) => {
  try {
    let requestBody;
    if (typeof event.body === "string") {
      requestBody = JSON.parse(event.body);
    } else {
      requestBody = event.body || {};
    }
    const documentsURl = extractDocumentUrls(requestBody);
    const downloadedFiles = await downloadDocuments(Object.values(documentsURl));
    const result = await processDocuments(requestBody,documentsURl,downloadedFiles);
    return formatResponse(200, result)
  } catch (error) {
    console.error("[MAIN] Stack:", error.stack);
  }finally{
  cleanupTempFiles();
  console.log('[MAIN] Proceso finalizado')
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

  return response;
}
