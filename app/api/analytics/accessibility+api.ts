import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
  TREND_WEEKS,
} from '../../../src/features/admin/utils/accessibilityAnalytics';
import { generateAccessibilityAnalytics } from '../../../src/shared/server/accessibilityAnalytics';
import {
  authenticateAdmin,
  reviewErrorResponse,
} from '../../../src/shared/server/reportAdminReview';

// Accessibility analytics for the Admin Dashboard (MOV-169, for MOV-133).
//
// One read-only endpoint answering the four figures MOV-133 states: the fleet's
// average accessibility score, the most accessible routes, the most reported
// vehicles, and how the average has moved week by week.
//
// ADMIN ONLY, enforced here rather than by which screen calls it. The listing
// endpoints this derives from are a mixture — GET /api/buses and /api/trips are
// open, GET /api/reports is not — but a fleet-wide view of how accessible every
// vehicle is, and which ones passengers complain about most, is the reviewer's
// view of the platform rather than a passenger's, and is gated like one.
//
// Nothing is written, nothing is stored and no collection is created: every
// figure is derived per request from the records other features already own,
// which is the same rule the accessibility score itself follows (MOV-111) —
// there is no stored current score, so there is no stored aggregate either.

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

/** The widest window worth asking for. A year of weekly buckets. */
const MAX_TREND_WEEKS = 52;

type WeeksRequest =
  | { ok: true; weeks: number }
  | { ok: false; message: string };

/**
 * How many weekly buckets the trend should cover.
 *
 * Absent means the default twelve, which is what MOV-133 asks for — so the
 * endpoint answers the story with no parameter at all. A value that is present
 * but not a whole number of weeks in range is a 400 rather than a silent
 * fallback to the default: a caller that asked for something specific and got
 * the default back has no way to tell.
 *
 * Expressed in weeks rather than days because the bucket IS a week. A `?days=`
 * that did not divide by seven would have to be rounded into one, and the
 * answer would not be the window that was asked for.
 */
function readTrendWeeks(url: URL): WeeksRequest {
  const raw = url.searchParams.get('weeks');

  if (raw === null || raw === '') return { ok: true, weeks: TREND_WEEKS };

  const weeks = Number(raw);

  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_TREND_WEEKS) {
    return {
      ok: false,
      message: `weeks must be a whole number between 1 and ${MAX_TREND_WEEKS}.`,
    };
  }

  return { ok: true, weeks };
}

// GET /api/analytics/accessibility
export async function GET(request: Request) {
  try {
    // 401 for a request carrying no usable session, 403 for a real session that
    // may not do this. The same helper the report review routes authorise
    // through, so an admin is one thing across the admin surface.
    const auth = await authenticateAdmin(request, corsHeaders);

    if (!auth.ok) return auth.response;

    const requested = readTrendWeeks(new URL(request.url));

    if (!requested.ok) {
      return reviewErrorResponse(400, requested.message, corsHeaders);
    }

    const analytics = await generateAccessibilityAnalytics(getAdminDb(), {
      weeks: requested.weeks,
    });

    return Response.json(
      {
        success: true,
        message: 'Accessibility analytics generated successfully.',
        ...analytics,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Accessibility Analytics API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to generate accessibility analytics.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}
