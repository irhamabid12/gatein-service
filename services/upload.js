'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Upload the captured image to the server.
 * 
 * @param {string} filePath - Full path to the image file.
 * @returns {Promise<any|null>} - Returns the JSON response from the server, or null if failed.
 */
async function uploadImage(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            logger.log("error", `[UPLOAD] File does not exist: ${filePath}`);
            return null;
        }

        // Read config to get the base API URL
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        // Use endpoint as App.ApiBaseUrl
        const url = `${config.endpoint}/api/parkirMasuk/upload-foto-kendaraan`;

        const fileName = path.basename(filePath);
        const fileBuffer = fs.readFileSync(filePath);
        
        // Convert Buffer to Blob for the native FormData API (Node >= 18)
        const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
        const formData = new FormData();
        
        // Append the file using the key expected by the Laravel controller
        formData.append('foto_kendaraan', blob, fileName);

        // logger.log("info", `[UPLOAD] Starting upload for ${fileName} to ${url}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, 30000); // 30 seconds timeout for upload

        const response = await fetch(url, {
            method: 'POST',
            body: formData,
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (response.ok) {
            const result = await response.json();
            // logger.log("info", `[UPLOAD] Upload successful: ${JSON.stringify(result)}`);
            return result;
        } else {
            const errText = await response.text();
            logger.log("error", `[UPLOAD] Upload failed with status ${response.status}: ${errText}`);
            return null;
        }

    } catch (err) {
        logger.log("error", `[UPLOAD] Error during file upload: ${err.message}`);
        return null;
    }
}

module.exports = { uploadImage };
