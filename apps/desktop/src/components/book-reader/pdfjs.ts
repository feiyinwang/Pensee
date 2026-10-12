import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// pdf.js with its worker set up, for the reader and for reading a book's
// metadata on import. Import it lazily: it is the reader's weight.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
