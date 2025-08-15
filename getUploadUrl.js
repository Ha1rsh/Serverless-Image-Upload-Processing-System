// src/getUploadUrl.js
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

const s3 = new S3Client({});

export const handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const contentType = body.contentType || "image/jpeg";
    const ext = (contentType.split("/")[1] || "jpg").toLowerCase();

    const key = `${new Date().toISOString().slice(0,10)}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: process.env.ORIGINALS_BUCKET,
      Key: key,
      ContentType: contentType,
      // (optional) enforce size limits with ContentLength on client side
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 * 5 }); // 5 min

    return {
      statusCode: 200,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      body: JSON.stringify({ uploadUrl, objectKey: key })
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to create URL" }) };
  }
};
