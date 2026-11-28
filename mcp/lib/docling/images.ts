/**
 * Pull embedded pictures out of Docling's Markdown. Docling returns each picture as a base64
 * data URI when image_export_mode is "embedded". Each URI is replaced by a file name, and the
 * bytes are returned for upload.
 */

export type ExtractedImage = {
  /** File name used in the Markdown and when uploading, e.g. "report-image-1.png". */
  name: string;
  mime: string;
  bytes: Buffer;
};

export type ImageExtraction = {
  markdown: string;
  images: ExtractedImage[];
  /** Pictures left out because of the count or size limit. */
  skipped: number;
};

const DATA_URI = /data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)/g;
const DATA_URI_TEST = /data:image\/[a-zA-Z0-9.+-]+;base64,/;

export const MAX_IMAGES = 50;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  webp: "webp",
  bmp: "bmp",
  tiff: "tiff",
  "svg+xml": "svg",
};

/** True when the Markdown still holds embedded pictures. */
export function hasEmbeddedImages(markdown: string): boolean {
  return DATA_URI_TEST.test(markdown);
}

/** A file-name-safe stem from the document name, e.g. "Quarterly Report.pdf" -> "Quarterly-Report". */
export function imageBaseName(documentName: string | null): string {
  const stem = (documentName ?? "").replace(/\.[^.]+$/, "");
  const safe = stem.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return safe || "document";
}

export function extractImages(markdown: string, baseName: string): ImageExtraction {
  const images: ExtractedImage[] = [];
  let skipped = 0;

  const out = markdown.replace(DATA_URI, (_match, subtype: string, data: string) => {
    if (images.length >= MAX_IMAGES) {
      skipped += 1;
      return "[image not extracted: limit reached]";
    }
    const bytes = Buffer.from(data.replace(/\s+/g, ""), "base64");
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      skipped += 1;
      return "[image not extracted: empty or too large]";
    }
    const lower = subtype.toLowerCase();
    const ext = EXTENSIONS[lower] ?? (lower.replace(/[^a-z0-9]/g, "") || "bin");
    const name = `${baseName}-image-${images.length + 1}.${ext}`;
    images.push({ name, mime: `image/${lower}`, bytes });
    return name;
  });

  return { markdown: out, images, skipped };
}
