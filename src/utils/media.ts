import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';
import { logger } from './logger';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Download media from WhatsApp Graph API
 */
async function downloadWhatsAppMedia(mediaId: string): Promise<Buffer> {
  // Step 1: Get media URL
  const metaResp = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  const mediaUrl = metaResp.data.url;

  // Step 2: Download binary
  const mediaResp = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer',
  });

  return Buffer.from(mediaResp.data);
}

/**
 * Upload buffer to Cloudinary
 */
async function uploadToCloudinary(
  buffer: Buffer,
  resourceType: 'image' | 'video' | 'raw'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'sonaxshop-livechat',
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result!.secure_url);
      }
    );
    stream.end(buffer);
  });
}

/**
 * Download WhatsApp media and upload to Cloudinary
 * Returns the Cloudinary URL or null on failure
 */
export async function downloadAndUpload(
  mediaId: string | undefined,
  resourceType: 'image' | 'video' | 'raw'
): Promise<string | null> {
  if (!mediaId) return null;

  try {
    const buffer = await downloadWhatsAppMedia(mediaId);
    const url = await uploadToCloudinary(buffer, resourceType);
    logger.info('Media uploaded to Cloudinary', { mediaId, url, resourceType });
    return url;
  } catch (error: any) {
    logger.error('Media upload failed', { mediaId, resourceType, error: error.message });
    return null;
  }
}
