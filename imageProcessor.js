// src/imageProcessor.js
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import Jimp from "jimp";
import { Readable } from "stream";

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const streamToBuffer = async (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

export const handler = async (event) => {
  const records = event.Records || [];
  await Promise.all(
    records.map(async (r) => {
      const bucket = r.s3.bucket.name;
      const key = decodeURIComponent(r.s3.object.key.replace(/\+/g, " "));
      const contentTypeGuess = key.endsWith(".png") ? "image/png" : "image/jpeg";

      // 1) Download original
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const originalBuf = await streamToBuffer(obj.Body);

      // 2) Load with Jimp
      const image = await Jimp.read(originalBuf);
      const widths = (process.env.VARIANT_WIDTHS || "200,800")
        .split(",")
        .map((w) => parseInt(w.trim(), 10))
        .filter(Boolean);

      // 3) Produce & upload variants
      const processedBucket = process.env.PROCESSED_BUCKET;
      const uploaded = [];

      for (const w of widths) {
        const clone = image.clone();
        clone.resize({ w }); // auto height keep aspect ratio
        const mime =
          contentTypeGuess === "image/png" ? Jimp.MIME_PNG : Jimp.MIME_JPEG;
        const out = await clone.getBufferAsync(mime);
        const variantKey = `${w}/${key}`;
        await s3.send(
          new PutObjectCommand({
            Bucket: processedBucket,
            Key: variantKey,
            Body: out,
            ContentType: mime,
            CacheControl: "public, max-age=31536000, immutable"
          })
        );
        uploaded.push({ width: w, key: variantKey });
      }

      // 4) Save metadata
      const id = key; // you can choose a different ID schema
      await ddb.send(
        new PutCommand({
          TableName: process.env.META_TABLE,
          Item: {
            id,
            originalBucket: bucket,
            originalKey: key,
            processedBucket,
            variants: uploaded,
            width: image.bitmap.width,
            height: image.bitmap.height,
            createdAt: new Date().toISOString()
          }
        })
      );
    })
  );

  return { statusCode: 200 };
};
