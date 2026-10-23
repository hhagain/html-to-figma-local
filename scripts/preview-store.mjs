import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Keep screenshots out of large JSON responses and release them with their job.
export function createPreviewStore() {
  let rootPromise, closed = false;
  const validate = (jobId, index) => {
    if (!/^[a-f0-9]{24}$/.test(jobId) || !Number.isInteger(index) || index < 0 || index >= 200) throw new Error('预览索引无效');
  };
  return {
    async save(jobId, index, preview) {
      validate(jobId, index);
      if (closed) throw new Error('预览存储已关闭');
      if (!/^data:image\/jpeg;base64,[\w+/=]+$/.test(preview)) throw new Error('预览图片格式无效');
      rootPromise ||= mkdtemp(path.join(tmpdir(), 'h2f-previews-'));
      const root = await rootPromise, directory = path.join(root, jobId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(path.join(directory, `${index}.jpg`), Buffer.from(preview.split(',')[1], 'base64'), { mode: 0o600 });
    },
    async read(jobId, index) {
      validate(jobId, index);
      if (!rootPromise || closed) return null;
      try { return await readFile(path.join(await rootPromise, jobId, `${index}.jpg`)); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async forget(jobId) {
      validate(jobId, 0);
      if (rootPromise && !closed) await rm(path.join(await rootPromise, jobId), { recursive: true, force: true });
    },
    async close() {
      closed = true;
      if (rootPromise) await rm(await rootPromise, { recursive: true, force: true });
    },
  };
}
