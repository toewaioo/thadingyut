import { handleSupabaseRequest, nodeRequestToResponse } from '../../server/supabase-proxy.js';

export const config = { api: { bodyParser: false } };

export default async function supabaseProxy(req, res) {
  return nodeRequestToResponse(req, res, (request) => handleSupabaseRequest(request), { pathPrefix: '/api/supabase' });
}
