declare module "pdf-parse/lib/pdf-parse.js" {
  const pdfParse: (data: Buffer, options?: Record<string, unknown>) => Promise<unknown>;
  export default pdfParse;
}
