import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

/**
 * Service-role client. Bypasses RLS — use for all server-side reads/writes.
 */
export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);
