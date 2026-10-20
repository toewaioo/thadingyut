import { nodeRequestToResponse } from '../server/supabase-proxy.js';
import { handleWishCheck } from '../server/wish-suitability.js';
export const config = { api: { bodyParser: false } };
export default async function wishCheck(req, res) {
  return nodeRequestToResponse(req, res, handleWishCheck);
}
