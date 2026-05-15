import type { Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import type { Logger } from './logger';

function getServiceClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for screenshot storage');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export interface ScreenshotMetadata {
  testName: string;
  failedStep?: string;
  expectedUrl?: string;
  actualUrl?: string;
  redirectedToLogin?: boolean;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export interface CaptureResult {
  publicUrl: string;
  storagePath: string;
}

/**
 * Capture FULL PAGE screenshot with descriptive filename.
 * Returns null on capture failure (never throws — must not crash the test).
 *
 * Filename pattern:
 *   {projectId}/{testSlug}-{stepSlug}-{urlSlug}-{timestamp}-{random}.png
 *
 * The filename literally describes what failed and where, so you can identify
 * each screenshot at a glance in the Supabase Storage bucket.
 */
export async function captureFullPage(
  page: Page,
  projectId: string,
  meta: ScreenshotMetadata,
  log?: Logger,
  testResultId?: string
): Promise<CaptureResult | null> {
  try {
    const buffer = await page.screenshot({ fullPage: true, type: 'png', timeout: 10000 });

    const ts = Date.now();
    const rand = randomBytes(3).toString('hex');
    const testSlug = slugify(meta.testName);
    const stepSlug = meta.failedStep ? slugify(meta.failedStep) : 'fail';
    const urlSlug = meta.actualUrl ? slugify(new URL(meta.actualUrl).pathname) : 'unknown';
    const filename = `${projectId}/${testSlug}-${stepSlug}-${urlSlug}-${ts}-${rand}.png`;

    log?.info(`Capturing full-page screenshot`, { filename, size: buffer.length });

    const supabase = getServiceClient();
    const { error: uploadError } = await supabase.storage
      .from('screenshots')
      .upload(filename, buffer, { contentType: 'image/png', upsert: false });

    if (uploadError) {
      log?.error(`Screenshot upload failed`, { error: uploadError.message });
      return null;
    }

    const { data } = supabase.storage.from('screenshots').getPublicUrl(filename);

    await supabase.from('screenshots').insert({
      project_id: projectId,
      test_result_id: testResultId ?? null,
      storage_path: filename,
      public_url: data.publicUrl,
    });

    return { publicUrl: data.publicUrl, storagePath: filename };
  } catch (err) {
    log?.error(`Screenshot capture failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
