import { handleConfigRequest, nodeRequestToResponse } from '../server/supabase-proxy.js';

export const config = { api: { bodyParser: false } };

export default async function publicConfig(req, res) {
  return nodeRequestToResponse(req, res, (request) => handleConfigRequest(request));
}
