const AWS = require("aws-sdk");
const fs = require("fs-extra");

const textract = new AWS.Textract({
  httpOptions: {
    timeout: 50000,
    retries: 3,
  },
});

async function extractTextFromDocument(filePath) {
  try {
    const documentBuffer = await fs.readFile(filePath);
    const headerCheck = documentBuffer.slice(0, 20).toString();
    if (
      headerCheck.startsWith("<!DOCTYPE") ||
      headerCheck.startsWith("<html") ||
      headerCheck.startsWith("<!do")
    ) {
      throw new Error("HTML_FILE_DETECTED");
    }

    const params = {
      Document: {
        Bytes: documentBuffer,
      },
    };

    const result = await textract.detectDocumentText(params).promise();

    let extractedText = "";
    if (result.Blocks && result.Blocks.length > 0) {
      result.Blocks.forEach((block) => {
        if (block.BlockType === "LINE") {
          extractedText += block.Text + " ";
        }
      });
    }

    const trimmedText = extractedText.trim();
    if (trimmedText.length === 0) {
      throw new Error("NO_TEXT_EXTRACTED");
    }

    return trimmedText;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  extractTextFromDocument,
};
