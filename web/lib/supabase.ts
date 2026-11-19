import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@saved-index/shared/config';

/**
 * One client for the whole app. The publishable key is public; Row Level Security is what
 * limits every query to the signed-in user's own rows.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
