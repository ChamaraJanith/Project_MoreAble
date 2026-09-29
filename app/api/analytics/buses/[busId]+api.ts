import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';
import { loadBusAccessibilityDetail } from '../../../../src/shared/server/accessibilityAnalytics';
import {
  authenticateAdmin,
  reviewErrorResponse,
} from '../../../../src/shared/server/reportAdminReview';

// One bus's accessibility, for the Analytics bus detail view.
//
// The list (GET /api/analytics/accessibility) carries every bus's score and
// evidence counts; this adds the evidence itself for ONE bus — its verified
// issue reports and positive feedback, and how its passengers rated it.
//
// A separate route because nothing existing answers it: GET /api/reports has no
// busId filter (its verified scope is the whole fleet's reports, plus a scan of
// every comment), and re-reading the fleet analytics to show one bus would be
// six full collection reads. This is three reads, whatever the fleet's size.
//
// ADMIN ONLY, the same gate as the analytics list. Read-only: no score history
// entry is recorded and no report is touched.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/** The bus id out of /api/analytics/buses/:busId, as the sibling bus routes read theirs. */
function extractBusId(request: Request, context: any): string {
  const fromContext = context?.params?.busId;

  if (typeof fromContext === 'string' && fromContext.trim()) {
    return fromContext.trim();
  }

  const parts = new URL(request.url).pathname.split('/').filter(Boolean);
  const candidate = parts[parts.length - 1] ?? '';

  return candidate && candidate !== 'buses' ? decodeURIComponent(candidate) : '';
}

// GET /api/analytics/buses/:busId
export async function GET(request: Request, context?: any) {
  try {
    const auth = await authenticateAdmin(request, corsHeaders);

    if (!auth.ok) return auth.response;

    const result = await loadBusAccessibilityDetail(getAdminDb(), extractBusId(request, context));

    if (result.kind === 'INVALID_BUS_ID') {
      return reviewErrorResponse(400, 'A valid bus ID is required.', corsHeaders);
    }

    if (result.kind === 'NOT_FOUND') {
      return reviewErrorResponse(404, 'Bus not found.', corsHeaders);
    }

    return Response.json(
      {
        success: true,
        message: 'Bus accessibility retrieved successfully.',
        bus: result.detail,
        generatedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Bus Accessibility Analytics API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to retrieve bus accessibility.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}
