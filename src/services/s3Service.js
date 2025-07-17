const AWS = require("aws-sdk");
const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");


const s3 = new AWS.S3({
  apiVersion: 'latest',
  region: process.env.AWS_REGION || 'us-east-1',
  httpOptions: {
    timeout: 30000,
    connectTimeout: 5000
  },
  maxRetries: 3,
  retryDelayOptions: {
    customBackoff: (retryCount) => Math.pow(2, retryCount) * 100
  }
});

const S3_CONFIG = {
  bucket: process.env.S3_BUCKET_NAME || 'document-processor-bucket',
  prefix: process.env.S3_PREFIX || 'documents/',
  region: process.env.AWS_REGION || 'us-east-1',
  storageClass: 'STANDARD_IA', 
  serverSideEncryption: 'AES256'
};

async function initializeS3Processing(requestId) {
  try {
    const timestamp = Date.now();
    const randomId = crypto.randomBytes(8).toString('hex');
    const processingId = `${requestId}-${timestamp}-${randomId}`;
    
    console.log(`[S3] Inicializando procesamiento S3: ${processingId}`);

    const metadata = {
      requestId,
      processingId,
      timestamp: new Date().toISOString(),
      status: 'initialized',
      documents: {}
    };
    
    const metadataKey = `${S3_CONFIG.prefix}${processingId}/metadata.json`;
    
    await s3.putObject({
      Bucket: S3_CONFIG.bucket,
      Key: metadataKey,
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json',
      StorageClass: S3_CONFIG.storageClass,
      ServerSideEncryption: S3_CONFIG.serverSideEncryption,
      Metadata: {
        'processing-id': processingId,
        'request-id': requestId,
        'created-at': timestamp.toString()
      }
    }).promise();
    
    console.log(`[S3] ✓ Sesión S3 inicializada: ${processingId}`);
    return processingId;
    
  } catch (error) {
    console.error(`[S3] Error inicializando procesamiento:`, error.message);
    throw new Error(`S3_INIT_ERROR: ${error.message}`);
  }
}

async function uploadToS3(filePath, processingId, documentType, originalFileName) {
  try {
    console.log(`[S3] Subiendo archivo: ${originalFileName} (${documentType})`);

    if (!filePath || !processingId || !documentType) {
      throw new Error('Missing required parameters for S3 upload');
    }

    const exists = await fs.pathExists(filePath);
    if (!exists) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = await fs.stat(filePath);
    const fileSize = stats.size;
    
    console.log(`[S3] Archivo a subir: ${formatBytes(fileSize)}`);

    const fileBuffer = await fs.readFile(filePath);

    const fileExtension = path.extname(originalFileName).toLowerCase();
    const sanitizedFileName = sanitizeFileName(originalFileName);
    const s3Key = `${S3_CONFIG.prefix}${processingId}/${documentType}/${sanitizedFileName}`;

    const contentType = getContentType(fileExtension);

    const uploadParams = {
      Bucket: S3_CONFIG.bucket,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: contentType,
      StorageClass: S3_CONFIG.storageClass,
      ServerSideEncryption: S3_CONFIG.serverSideEncryption,
      Metadata: {
        'processing-id': processingId,
        'document-type': documentType,
        'original-filename': originalFileName,
        'upload-timestamp': Date.now().toString(),
        'file-size': fileSize.toString()
      },
      Tagging: `ProcessingId=${processingId}&DocumentType=${documentType}&UploadDate=${new Date().toISOString().split('T')[0]}`
    };

    let uploadResult;
    if (fileSize > 100 * 1024 * 1024) {
      console.log(`[S3] Usando multipart upload para archivo grande: ${formatBytes(fileSize)}`);
      uploadResult = await uploadLargeFile(uploadParams);
    } else {
      uploadResult = await s3.upload(uploadParams).promise();
    }
    
    console.log(`[S3] ✓ Archivo subido exitosamente: ${s3Key}`);

    await updateProcessingMetadata(processingId, documentType, {
      s3Key,
      originalFileName,
      fileSize,
      uploadTimestamp: new Date().toISOString(),
      status: 'uploaded'
    });
    
    return {
      key: s3Key,
      bucket: S3_CONFIG.bucket,
      url: uploadResult.Location,
      etag: uploadResult.ETag,
      size: fileSize,
      contentType,
      uploadTimestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error(`[S3] Error subiendo archivo ${originalFileName}:`, error.message);

    try {
      await updateProcessingMetadata(processingId, documentType, {
        status: 'upload_failed',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    } catch (metadataError) {
      console.warn(`[S3] No se pudo actualizar metadata con error:`, metadataError.message);
    }
    
    throw new Error(`S3_UPLOAD_ERROR: ${error.message}`);
  }
}

async function uploadLargeFile(uploadParams) {
  const managedUpload = s3.upload(uploadParams, {
    partSize: 10 * 1024 * 1024, // 10MB parts
    queueSize: 4, // Upload up to 4 parts in parallel
  });

  managedUpload.on('httpUploadProgress', (progress) => {
    const percentage = ((progress.loaded / progress.total) * 100).toFixed(2);
    console.log(`[S3] Progreso upload: ${percentage}% (${formatBytes(progress.loaded)}/${formatBytes(progress.total)})`);
  });
  
  return managedUpload.promise();
}

async function startAsyncDocumentAnalysis(s3Key, processingId, documentType, jobType = 'ANALYZE_DOCUMENT') {
  try {
    console.log(`[S3] Iniciando análisis asíncrono: ${s3Key}`);
    
    const textract = new AWS.Textract({
      region: S3_CONFIG.region,
      httpOptions: {
        timeout: 60000,
        retries: 3
      }
    });
    
    const jobParams = {
      DocumentLocation: {
        S3Object: {
          Bucket: S3_CONFIG.bucket,
          Name: s3Key
        }
      },
      JobTag: `${processingId}-${documentType}`,
      ClientRequestToken: `${processingId}-${documentType}-${Date.now()}`,
      NotificationChannel: {
        SNSTopicArn: process.env.SNS_TOPIC_ARN,
        RoleArn: process.env.TEXTRACT_ROLE_ARN
      }
    };
    
    let startJobPromise;
    
    if (jobType === 'ANALYZE_DOCUMENT') {
      jobParams.FeatureTypes = ['TABLES', 'FORMS'];
      startJobPromise = textract.startDocumentAnalysis(jobParams).promise();
    } else {
      startJobPromise = textract.startDocumentTextDetection(jobParams).promise();
    }
    
    const jobResult = await startJobPromise;
    
    console.log(`[S3] ✓ Job de análisis iniciado: ${jobResult.JobId}`);

    await updateProcessingMetadata(processingId, documentType, {
      textractJobId: jobResult.JobId,
      textractJobType: jobType,
      analysisStarted: new Date().toISOString(),
      status: 'analyzing'
    });
    
    return {
      jobId: jobResult.JobId,
      jobType,
      status: 'started',
      processingId,
      documentType
    };
    
  } catch (error) {
    console.error(`[S3] Error iniciando análisis asíncrono:`, error.message);
    
    await updateProcessingMetadata(processingId, documentType, {
      status: 'analysis_failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    throw new Error(`ASYNC_ANALYSIS_ERROR: ${error.message}`);
  }
}

async function checkAsyncJobStatus(jobId, jobType = 'ANALYZE_DOCUMENT') {
  try {
    const textract = new AWS.Textract({
      region: S3_CONFIG.region
    });
    
    let getJobPromise;
    
    if (jobType === 'ANALYZE_DOCUMENT') {
      getJobPromise = textract.getDocumentAnalysis({ JobId: jobId }).promise();
    } else {
      getJobPromise = textract.getDocumentTextDetection({ JobId: jobId }).promise();
    }
    
    const jobResult = await getJobPromise;
    
    return {
      jobId,
      status: jobResult.JobStatus,
      statusMessage: jobResult.StatusMessage,
      blocks: jobResult.Blocks,
      nextToken: jobResult.NextToken,
      warnings: jobResult.Warnings,
      documentMetadata: jobResult.DocumentMetadata
    };
    
  } catch (error) {
    console.error(`[S3] Error verificando status del job ${jobId}:`, error.message);
    throw new Error(`JOB_STATUS_ERROR: ${error.message}`);
  }
}

async function getAllAsyncJobResults(jobId, jobType = 'ANALYZE_DOCUMENT') {
  try {
    console.log(`[S3] Obteniendo resultados completos del job: ${jobId}`);
    
    const textract = new AWS.Textract({
      region: S3_CONFIG.region
    });
    
    let allBlocks = [];
    let nextToken = null;
    let pageCount = 0;
    
    do {
      const params = { JobId: jobId };
      if (nextToken) {
        params.NextToken = nextToken;
      }
      
      let result;
      if (jobType === 'ANALYZE_DOCUMENT') {
        result = await textract.getDocumentAnalysis(params).promise();
      } else {
        result = await textract.getDocumentTextDetection(params).promise();
      }
      
      if (result.Blocks) {
        allBlocks = allBlocks.concat(result.Blocks);
      }
      
      nextToken = result.NextToken;
      pageCount++;
      
      console.log(`[S3] Página ${pageCount} procesada: ${result.Blocks?.length || 0} bloques`);
      
    } while (nextToken);
    
    console.log(`[S3] ✓ Resultados completos obtenidos: ${allBlocks.length} bloques totales`);
    
    return {
      jobId,
      status: 'SUCCEEDED',
      blocks: allBlocks,
      totalBlocks: allBlocks.length,
      pagesProcessed: pageCount
    };
    
  } catch (error) {
    console.error(`[S3] Error obteniendo resultados del job ${jobId}:`, error.message);
    throw new Error(`JOB_RESULTS_ERROR: ${error.message}`);
  }
}

async function updateProcessingMetadata(processingId, documentType, updateData) {
  try {
    const metadataKey = `${S3_CONFIG.prefix}${processingId}/metadata.json`;

    let existingMetadata = {};
    try {
      const result = await s3.getObject({
        Bucket: S3_CONFIG.bucket,
        Key: metadataKey
      }).promise();
      existingMetadata = JSON.parse(result.Body.toString());
    } catch (getError) {
      console.warn(`[S3] No se pudo obtener metadata existente:`, getError.message);
    }

    if (!existingMetadata.documents) {
      existingMetadata.documents = {};
    }
    
    existingMetadata.documents[documentType] = {
      ...existingMetadata.documents[documentType],
      ...updateData,
      lastUpdated: new Date().toISOString()
    };
    
    existingMetadata.lastUpdated = new Date().toISOString();

    await s3.putObject({
      Bucket: S3_CONFIG.bucket,
      Key: metadataKey,
      Body: JSON.stringify(existingMetadata, null, 2),
      ContentType: 'application/json',
      StorageClass: S3_CONFIG.storageClass,
      ServerSideEncryption: S3_CONFIG.serverSideEncryption
    }).promise();
    
  } catch (error) {
    console.error(`[S3] Error actualizando metadata:`, error.message);
  }
}

async function getProcessingMetadata(processingId) {
  try {
    const metadataKey = `${S3_CONFIG.prefix}${processingId}/metadata.json`;
    
    const result = await s3.getObject({
      Bucket: S3_CONFIG.bucket,
      Key: metadataKey
    }).promise();
    
    return JSON.parse(result.Body.toString());
    
  } catch (error) {
    console.error(`[S3] Error obteniendo metadata:`, error.message);
    throw new Error(`METADATA_GET_ERROR: ${error.message}`);
  }
}

async function processMultiPagePDF(s3Key, processingId, documentType) {
  try {
    console.log(`[S3] Iniciando procesamiento de PDF multipágina: ${s3Key}`);

    const analysisJob = await startAsyncDocumentAnalysis(s3Key, processingId, documentType, 'DETECT_DOCUMENT_TEXT');

    let attempts = 0;
    const maxAttempts = 30;
    let backoffDelay = 2000;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
      
      const jobStatus = await checkAsyncJobStatus(analysisJob.jobId, analysisJob.jobType);
      
      console.log(`[S3] Job status check ${attempts}/${maxAttempts}: ${jobStatus.status}`);
      
      if (jobStatus.status === 'SUCCEEDED') {
        console.log(`[S3] ✓ Análisis completado en intento ${attempts}`);

        const results = await getAllAsyncJobResults(analysisJob.jobId, analysisJob.jobType);

        const extractedText = extractTextFromBlocks(results.blocks);

        await updateProcessingMetadata(processingId, documentType, {
          status: 'completed',
          textExtracted: true,
          textLength: extractedText.length,
          totalBlocks: results.totalBlocks,
          pagesProcessed: results.pagesProcessed,
          completedAt: new Date().toISOString()
        });
        
        return {
          success: true,
          text: extractedText,
          metadata: {
            jobId: analysisJob.jobId,
            totalBlocks: results.totalBlocks,
            pagesProcessed: results.pagesProcessed,
            textLength: extractedText.length
          }
        };
        
      } else if (jobStatus.status === 'FAILED') {
        throw new Error(`Textract job failed: ${jobStatus.statusMessage}`);
        
      } else if (jobStatus.status === 'IN_PROGRESS') {
        backoffDelay = Math.min(backoffDelay * 1.5 + Math.random() * 1000, 10000);
        continue;
        
      } else {
        console.warn(`[S3] Estado inesperado del job: ${jobStatus.status}`);
        continue;
      }
    }
    
    throw new Error(`Timeout waiting for Textract job completion after ${maxAttempts} attempts`);
    
  } catch (error) {
    console.error(`[S3] Error procesando PDF multipágina:`, error.message);
    
    await updateProcessingMetadata(processingId, documentType, {
      status: 'processing_failed',
      error: error.message,
      failedAt: new Date().toISOString()
    });
    
    throw new Error(`MULTIPAGE_PDF_ERROR: ${error.message}`);
  }
}

function extractTextFromBlocks(blocks) {
  if (!blocks || !Array.isArray(blocks)) {
    return '';
  }
  
  let extractedText = '';
  let lineCount = 0;
  
  blocks.forEach(block => {
    if (block.BlockType === 'LINE' && block.Text) {
      extractedText += block.Text + ' ';
      lineCount++;
    }
  });
  
  console.log(`[S3] Texto extraído: ${lineCount} líneas, ${extractedText.length} caracteres`);
  
  return extractedText.trim();
}

async function cleanupS3Processing(processingId) {
  try {
    console.log(`[S3] Iniciando limpieza de recursos: ${processingId}`);
    
    const prefix = `${S3_CONFIG.prefix}${processingId}/`;

    const listParams = {
      Bucket: S3_CONFIG.bucket,
      Prefix: prefix
    };
    
    const listedObjects = await s3.listObjectsV2(listParams).promise();
    
    if (listedObjects.Contents.length === 0) {
      console.log(`[S3] No hay objetos para limpiar en: ${prefix}`);
      return;
    }

    const deleteParams = {
      Bucket: S3_CONFIG.bucket,
      Delete: {
        Objects: listedObjects.Contents.map(obj => ({ Key: obj.Key }))
      }
    };
    
    const deleteResult = await s3.deleteObjects(deleteParams).promise();
    
    console.log(`[S3] ✓ ${deleteResult.Deleted.length} objetos eliminados`);
    
    if (deleteResult.Errors && deleteResult.Errors.length > 0) {
      console.warn(`[S3] Errores durante limpieza:`, deleteResult.Errors);
    }
    
  } catch (error) {
    console.error(`[S3] Error durante limpieza:`, error.message);
  }
}

function sanitizeFileName(fileName) {
  try {
    return fileName
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 200);
  } catch (error) {
    return `file_${Date.now()}`;
  }
}

function getContentType(fileExtension) {
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff'
  };
  
  return mimeTypes[fileExtension.toLowerCase()] || 'application/octet-stream';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function verifyS3Configuration() {
  try {
    console.log(`[S3] Verificando configuración del bucket: ${S3_CONFIG.bucket}`);

    await s3.headBucket({ Bucket: S3_CONFIG.bucket }).promise();

    const testKey = `${S3_CONFIG.prefix}test/access-test-${Date.now()}.txt`;
    await s3.putObject({
      Bucket: S3_CONFIG.bucket,
      Key: testKey,
      Body: 'Test access',
      StorageClass: S3_CONFIG.storageClass
    }).promise();

    await s3.deleteObject({
      Bucket: S3_CONFIG.bucket,
      Key: testKey
    }).promise();
    
    console.log(`[S3] ✓ Configuración S3 verificada exitosamente`);
    return true;
    
  } catch (error) {
    console.error(`[S3] Error en configuración S3:`, error.message);
    throw new Error(`S3_CONFIG_ERROR: ${error.message}`);
  }
}

module.exports = {
  initializeS3Processing,
  uploadToS3,
  startAsyncDocumentAnalysis,
  checkAsyncJobStatus,
  getAllAsyncJobResults,
  processMultiPagePDF,
  updateProcessingMetadata,
  getProcessingMetadata,
  cleanupS3Processing,
  verifyS3Configuration,
  S3_CONFIG
};