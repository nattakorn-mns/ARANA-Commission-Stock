/**
 * ARANA CLINIC — Supabase Client
 * Uses the official client when available and a direct REST fallback when CDN loading fails.
 */
const sb = (typeof supabase !== 'undefined' && supabase.createClient)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : {
      async rpc(functionName, params = {}) {
        try {
          const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
            method: 'POST',
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(params)
          });
          const text = await response.text();
          let data = null;
          if (text) {
            try { data = JSON.parse(text); }
            catch { data = text; }
          }
          if (!response.ok) {
            const message = data?.message || data?.hint || `HTTP ${response.status}`;
            return { data: null, error: new Error(message) };
          }
          return { data, error: null };
        } catch (error) {
          return { data: null, error };
        }
      }
    };
