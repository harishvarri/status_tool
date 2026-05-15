import type { Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for screenshot storage');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function captureAndStore(
  page: Page,
  projectId: string,
  testResultId?: string
): Promise<string | null> {
  try {
    const buffer = await page.screenshot({ fullPage: true, type: 'png' });
    const filename = `${projectId}/${Date.now()}.png`;
    const supabase = getServiceClient();

    const { error: uploadError } = await supabase.storage
      .from('screenshots')
      .upload(filename, buffer, { contentType: 'image/png', upsert: false });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from('screenshots').getPublicUrl(filename);

    await supabase.from('screenshots').insert({
      project_id: projectId,
      test_result_id: testResultId ?? null,
      storage_path: filename,
      public_url: data.publicUrl,
    });

    return data.publicUrl;
  } catch (err) {
    console.error('Screenshot capture failed:', err);
    return null;
  }
}
