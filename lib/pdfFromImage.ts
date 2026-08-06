import { PDFDocument } from "pdf-lib";

// Turns a captured photo (as a data URL, the same format every photo in
// this app is already stored/passed around as) into a single-page PDF --
// one page sized exactly to the image, with the photo filling it. Used by
// the As Built Drawings scan flow: a photographed drawing gets saved as a
// PDF instead of a plain JPG, since that's the deliverable format for a
// drawing record, not just a reference photo.
export async function buildPdfFromImageDataUrl(dataUrl: string): Promise<Buffer> {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) throw new Error("Invalid image data URL.");
  const header = dataUrl.slice(0, commaIndex);
  const base64 = dataUrl.slice(commaIndex + 1);
  const bytes = Buffer.from(base64, "base64");

  const pdfDoc = await PDFDocument.create();
  const image = /^data:image\/png/i.test(header)
    ? await pdfDoc.embedPng(bytes)
    : await pdfDoc.embedJpg(bytes);

  const { width, height } = image;
  const page = pdfDoc.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
