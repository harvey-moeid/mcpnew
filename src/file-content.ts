import { MAX_FILE_BYTES, validFileName } from './files'

export class FileContentError extends Error {
  constructor(message: string, public status: 400 | 408 | 409 | 413 | 502 = 400) { super(message) }
}

// A single preallocated buffer: never trust Content-Length to bound a chunked body.
// The existing 25 MiB ceiling is retained; readers and timers are released on every exit.
export async function readFileBytes(body: ReadableStream<Uint8Array> | null, expected?: number,
  signal: AbortSignal = AbortSignal.timeout(60000), maximum = MAX_FILE_BYTES): Promise<Uint8Array> {
  if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0 || expected > maximum)) {
    throw new FileContentError('File exceeds the supported size.', 413)
  }
  if (!body) {
    if (expected && expected > 0) throw new FileContentError('File contents are required.')
    return new Uint8Array(0)
  }
  const reader = body.getReader(), buffer = new Uint8Array(expected ?? maximum)
  let size = 0, onAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new FileContentError('File transfer timed out or was aborted.', 408))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    if (signal.aborted) throw new FileContentError('File transfer timed out or was aborted.', 408)
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted])
      if (chunk.done) break
      if (size + chunk.value.byteLength > buffer.byteLength) throw new FileContentError('Received file exceeds the declared size or upload limit.', 413)
      buffer.set(chunk.value, size); size += chunk.value.byteLength
    }
    if (expected !== undefined && size !== expected) throw new FileContentError('Received file size does not match the declared size.')
    return buffer.subarray(0, size)
  } finally {
    signal.removeEventListener('abort', onAbort)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function decodeFileBase64(value: string, maximum: number): Uint8Array {
  if (value.length > 4 * Math.ceil(maximum / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new FileContentError('Invalid base64 or file exceeds 1 MiB. Use create_file_upload for larger files.')
  }
  const decoded = atob(value)
  if (decoded.length > maximum || btoa(decoded) !== value) throw new FileContentError('Invalid base64 or file exceeds 1 MiB.')
  return Uint8Array.from(decoded, char => char.charCodeAt(0))
}

export function detectFileType(name: string, bytes: Uint8Array): string {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  if (starts(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf'
  if (starts(0x50, 0x4b, 3, 4) || starts(0x50, 0x4b, 5, 6)) return 'application/zip'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  const types: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', zip: 'application/zip', pdf: 'application/pdf', webp: 'image/webp' }
  return types[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

export async function storeFileBytes(bucket: R2Bucket, key: string, name: string, bytes: Uint8Array) {
  if (!validFileName(name)) throw new FileContentError('Invalid filename.')
  if (bytes.byteLength > MAX_FILE_BYTES) throw new FileContentError('File exceeds 25 MiB.', 413)
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  let object: R2Object | null
  try { object = await bucket.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: detectFileType(name, bytes) },
    customMetadata: { filename: name, sha256 },
    sha256,
  }) } catch { throw new FileContentError('File storage is unavailable. Check the file list before retrying.', 502) }
  if (!object) throw new FileContentError('Upload key already exists; check the file list.', 409)
  // R2 is strongly consistent. Do not report success until independently checking the object.
  let stored: R2Object | null
  try { stored = await bucket.head(key) } catch { throw new FileContentError('Object verification is unavailable. Check the file list before retrying.', 502) }
  if (!stored || stored.size !== bytes.byteLength || stored.etag !== object.etag || stored.customMetadata?.sha256 !== sha256) {
    throw new FileContentError('Object verification failed. Check the file list before retrying.', 502)
  }
  return stored
}

export function allowedUploadUrl(value: string, allowedHosts: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new FileContentError('Invalid upload source URL.') }
  const hostname = url.hostname.toLowerCase()
  const hosts = (allowedHosts ?? '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean)
  // Exact administrator-controlled public DNS names; no IP literals, local names, credentials, wildcards or arbitrary ports.
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || value.length > 4096 ||
      !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(hostname) || !hosts.includes(hostname)) {
    throw new FileContentError('Source must be HTTPS on an exact FILE_UPLOAD_ALLOWED_HOSTS hostname; private hosts, redirects and credentials are forbidden.')
  }
  return url
}

export async function fetchUploadBytes(url: URL): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(60000)
  // Never forward user/cloud credentials or follow a redirect to an unchecked host.
  let response: Response
  try { response = await fetch(url.href, { redirect: 'manual', signal, headers: { Accept: 'application/octet-stream' } }) }
  catch { throw new FileContentError('Upload source is unavailable or timed out.', 502) }
  if (!response.ok || response.status >= 300) {
    void response.body?.cancel().catch(() => {})
    throw new FileContentError('Upload source failed or redirected. Use the final allowed HTTPS URL.', 502)
  }
  const length = response.headers.get('content-length')
  if (length !== null && !/^\d+$/.test(length)) {
    void response.body?.cancel().catch(() => {})
    throw new FileContentError('Invalid source Content-Length.')
  }
  try { return await readFileBytes(response.body, length === null ? undefined : Number(length), signal) }
  catch (error) {
    void response.body?.cancel().catch(() => {})
    if (error instanceof FileContentError) throw error
    throw new FileContentError('Upload source transfer failed or timed out.', 502)
  }
}
