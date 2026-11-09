/** Completion is recorded only after Storage confirms the write. Failures leave a durable pending record. */
export async function runPrivateUpload(operations:{upload:()=>Promise<void>;markUploaded:()=>Promise<void>}) {
  await operations.upload();
  await operations.markUploaded();
}

/** Copy native/shared-backed image bytes into a fetch-compatible ordinary buffer. */
export function storageUploadBody(bytes:Uint8Array):ArrayBuffer {
  const body=new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}
