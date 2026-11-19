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
 * Where the web app lives. Local until it is deployed; change this one line when it has a
 * real address and the extension's "Open your library" button follows.
 */
export const WEB_APP_URL = 'http://localhost:3000/';
