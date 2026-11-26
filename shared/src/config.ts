/**
 * The Supabase project the extension and the web app talk to.
 *
 * Both values are public by design: the publishable key only identifies the project, and
 * Row Level Security (supabase/migrations) is what keeps one user out of another's posts.
 * Secrets — the service-role key, the OpenAI key — never belong in a browser bundle.
 */

export const SUPABASE_URL = 'https://siwmxcsrzdvvtouolvph.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-5zL55keE4N3Qea9sVXD8Q_imtI1lys';

/**
 * Where the web app lives. Local until it is deployed. When it has a real address, change
 * this line and the same origin in the extension manifest's host_permissions, which is
 * what lets Open library find a tab it is already open in (`npm run verify` checks both).
 */
export const WEB_APP_URL = 'http://localhost:3000/';
