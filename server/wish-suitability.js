import { checkWishSuitability, SUITABILITY_MESSAGE } from '../src/wish-suitability.js';

const MAX_BODY_BYTES = 8 * 1024;

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
    },
  });
}

function sameOrigin(requestUrl, originHeader) {
  if (originHeader === null) return true;
  try {
    const origin = new URL(originHeader);
    return originHeader === origin.origin && origin.origin === requestUrl.origin;
  } catch {
    return false;
  }
}

async function readBoundedBody(request) {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) return { error: 400 };
    if (Number(declared) > MAX_BODY_BYTES) return { error: 413 };
  }
  if (!request.body) return { error: 400 };

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return { error: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { error: 400 };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { error: 400 };
  }
}

export async function handleWishCheck(request) {
  let requestUrl;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return jsonResponse(400, { error: 'Invalid request' });
  }
  if (!sameOrigin(requestUrl, request.headers.get('origin'))) {
    return jsonResponse(403, { error: 'Cross-origin request denied' });
  }
  if (request.method.toUpperCase() !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const bodyResult = await readBoundedBody(request);
  if (bodyResult.error === 413) return jsonResponse(413, { error: 'Request body too large' });
  if (bodyResult.error) return jsonResponse(400, { error: 'Invalid JSON request body' });

  let payload;
  try {
    payload = JSON.parse(bodyResult.text);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON request body' });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonResponse(400, { error: 'Invalid JSON request body' });
  }

  const result = checkWishSuitability(payload.text, payload.dedication === undefined ? '' : payload.dedication);
  if (!result.allowed) {
    return jsonResponse(422, {
      allowed: false,
      code: 'WISH_UNSUITABLE',
      message: SUITABILITY_MESSAGE,
    });
  }
  return jsonResponse(200, { allowed: true });
}
