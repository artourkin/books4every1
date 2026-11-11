import { cp, mkdir } from "node:fs/promises";
// Keep all PDF font maps and decoders local, including CJK and JPEG 2000 support.
await mkdir("public/pdfjs", { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"])
  await cp(`node_modules/pdfjs-dist/${dir}`, `public/pdfjs/${dir}`, {
    recursive: true,
  });
