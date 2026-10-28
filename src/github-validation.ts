import { z } from 'zod'

export const repositoryPath = z.string().min(1).max(1024).refine(path =>
  !path.startsWith('/') && !/[\\\u0000-\u001f\u007f]/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..'), 'Use a relative repository path without traversal')
export const commitFiles = z.array(z.object({ path: repositoryPath, content: z.string().max(1024 * 1024) })).min(1).max(100)
  .refine(files => new Set(files.map(file => file.path)).size === files.length, 'Duplicate file paths are not allowed')
  .refine(files => files.reduce((size, file) => size + new TextEncoder().encode(file.content).byteLength, 0) <= 1024 * 1024, 'Total commit content exceeds 1 MiB')


export async function boundedMap<T, R>(values: T[], mapper: (value: T) => Promise<R>, concurrency = 5): Promise<R[]> {
  const results: R[] = []
  for (let offset = 0; offset < values.length; offset += concurrency) results.push(...await Promise.all(values.slice(offset, offset + concurrency).map(mapper)))
  return results
}
