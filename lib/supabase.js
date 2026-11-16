import "server-only";
import { createClient } from "@supabase/supabase-js";

let supabase;

export function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secretKey) {
      throw new Error("Supabase server configuration is missing.");
    }
    // Initialize on first use so building the app needs no database credentials.
    supabase = createClient(url, secretKey, {
      db: { schema: "public" },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
    });
  }
  return supabase;
}
