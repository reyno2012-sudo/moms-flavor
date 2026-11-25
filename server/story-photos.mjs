import { storyLimits } from '../src/story-limits.js';

export function decodeStoryPhoto(value) {
  const maxEncodedSize = Math.ceil(storyLimits.photoBytes / 3) * 4;
  if (typeof value !== 'string' || value.length > maxEncodedSize || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const jpeg = Buffer.from(value, 'base64');
  if (jpeg.length < 12 || jpeg.length > storyLimits.photoBytes || jpeg.readUInt16BE(0) !== 0xffd8 || jpeg.readUInt16BE(jpeg.length - 2) !== 0xffd9) return null;

  // Keep JPEG structure and remove application metadata such as EXIF before the first scan.
  const segments = [jpeg.subarray(0, 2)];
  let offset = 2;
  let validFrame = false;
  while (offset + 4 < jpeg.length) {
    const start = offset;
    if (jpeg[offset++] !== 0xff) return null;
    while (jpeg[offset] === 0xff) offset++;
    const marker = jpeg[offset++];
    if (offset + 2 > jpeg.length) return null;
    const length = jpeg.readUInt16BE(offset);
    const end = offset + length;
    if (length < 2 || end > jpeg.length - 2) return null;
    if (marker === 0xda) return validFrame ? Buffer.concat([...segments, jpeg.subarray(start)]) : null;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) return null;
      const height = jpeg.readUInt16BE(offset + 3);
      const width = jpeg.readUInt16BE(offset + 5);
      validFrame = width > 0 && height > 0 && Math.max(width, height) <= storyLimits.photoEdge;
    }
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) segments.push(jpeg.subarray(start, end));
    offset = end;
  }
  return null;
}
