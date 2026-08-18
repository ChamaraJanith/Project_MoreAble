import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { withoutBusCredentials } from '../../../src/shared/server/busCredentials';
import { validatePassword } from '../../../src/shared/utils/password';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// --------------------------------------------------
// OPTIONS
// --------------------------------------------------
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}


// --------------------------------------------------
// Resolve a bus using either Bus ID or Number Plate
// Example:
// BUS-00003 -> finds by document ID
// NB-8899   -> finds by numberPlate
// --------------------------------------------------
async function resolveBus(adminDb: any, identifier: string) {
  const value = identifier.trim();

  // 1. Try Bus ID first
  const busRef = adminDb.collection('buses').doc(value);
  const busDoc = await busRef.get();

  if (busDoc.exists) {
    return {
      busRef,
      busDoc,
    };
  }

  // 2. If not found, try Number Plate
  const numberPlate = value.toUpperCase();

  const snapshot = await adminDb
    .collection('buses')
    .where('numberPlate', '==', numberPlate)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    const doc = snapshot.docs[0];

    return {
      busRef: adminDb.collection('buses').doc(doc.id),
      busDoc: doc,
    };
  }

  return null;
}

// --------------------------------------------------
// GET /api/buses/:busId
// --------------------------------------------------
export async function GET(
  request: Request,
  context: any
) {
  try {
    const adminDb = getAdminDb();

    // Get identifier safely from Expo Router context
    // Identifier can be either BUS-00001 or a number plate such as NB-8899.
    let identifier = context?.params?.busId;

    // Fallback: extract identifier from URL
    if (!identifier) {
      const url = new URL(request.url);
      const parts = url.pathname.split('/').filter(Boolean);
      identifier = parts[parts.length - 1];
    }

    if (!identifier) {
      return Response.json(
        {
          success: false,
          message: 'Bus ID or number plate is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const resolvedBus = await resolveBus(adminDb, identifier);

    if (!resolvedBus) {
      return Response.json(
        {
          success: false,
          message: 'Bus not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    return Response.json(
      {
        success: true,
        message: 'Bus retrieved successfully.',
        bus: withoutBusCredentials(resolvedBus.busDoc.data() ?? {}),
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Get Bus API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to retrieve bus.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// --------------------------------------------------
// PUT /api/buses/:busId
// --------------------------------------------------
export async function PUT(
  request: Request,
  context: any
) {
  try {
    const adminDb = getAdminDb();

    // --------------------------------------------------
    // Get identifier safely
    // Identifier can be either Bus ID or Number Plate.
    // --------------------------------------------------
    let identifier = context?.params?.busId;

    // Fallback if Expo Router context params are unavailable
    if (!identifier) {
      const url = new URL(request.url);
      const parts = url.pathname.split('/').filter(Boolean);
      identifier = parts[parts.length - 1];
    }

    if (!identifier) {
      return Response.json(
        {
          success: false,
          message: 'Bus ID or number plate is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------
    // Find bus by Bus ID OR Number Plate
    // --------------------------------------------------
    const resolvedBus = await resolveBus(adminDb, identifier);

    if (!resolvedBus) {
      return Response.json(
        {
          success: false,
          message: 'Bus not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------
    // Read request body
    // --------------------------------------------------
    const body = await request.json();

    // --------------------------------------------------
    // IMPORTANT:
    // numberPlate is intentionally NOT accepted.
    // It cannot be updated through this API.
    // --------------------------------------------------
    const {
      chassisNumber,
      busModel,
      manufacturer,
      manufactureYear,
      seatCapacity,
      accessibilityFacilities,
      status,
      password,
    } = body;

    // --------------------------------------------------
    // Build update object
    // Only fields provided by frontend will be updated.
    // --------------------------------------------------
    const updates: Record<string, any> = {};

    // Chassis Number
    if (chassisNumber !== undefined) {
      if (
        typeof chassisNumber !== 'string' ||
        !chassisNumber.trim()
      ) {
        return Response.json(
          {
            success: false,
            message: 'Invalid chassis number.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      updates.chassisNumber = chassisNumber.trim();
    }

    // Bus Model
    if (busModel !== undefined) {
      if (
        typeof busModel !== 'string' ||
        !busModel.trim()
      ) {
        return Response.json(
          {
            success: false,
            message: 'Invalid bus model.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      updates.busModel = busModel.trim();
    }

    // Manufacturer
    if (manufacturer !== undefined) {
      if (
        typeof manufacturer !== 'string' ||
        !manufacturer.trim()
      ) {
        return Response.json(
          {
            success: false,
            message: 'Invalid manufacturer.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      updates.manufacturer = manufacturer.trim();
    }

    // Manufacture Year
    if (manufactureYear !== undefined) {
      const year = Number(manufactureYear);

      if (
        !Number.isInteger(year) ||
        year < 1900 ||
        year > new Date().getFullYear()
      ) {
        return Response.json(
          {
            success: false,
            message: 'Invalid manufacture year.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      updates.manufactureYear = year;
    }

    // Seat Capacity
    if (seatCapacity !== undefined) {
      const capacity = Number(seatCapacity);

      if (
        !Number.isInteger(capacity) ||
        capacity <= 0
      ) {
        return Response.json(
          {
            success: false,
            message: 'Seat capacity must be a positive number.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      updates.seatCapacity = capacity;
    }

    // --------------------------------------------------
    // Accessibility Facilities
    //
    // New format:
    //
    // wheelchairRamp: boolean
    // audioAnnouncement: boolean
    // lowFloorVehicle: boolean
    // walkingAssistance: boolean
    //
    // wheelchairSpace:
    // {
    //   available: boolean,
    //   count: number
    // }
    //
    // guardianSeats:
    // {
    //   available: boolean,
    //   count: number
    // }
    //
    // prioritySeats:
    // {
    //   available: boolean,
    //   count: number
    // }
    //
    // elderlySeats:
    // {
    //   available: boolean,
    //   count: number
    // }
    // --------------------------------------------------
    if (accessibilityFacilities !== undefined) {
      if (
        typeof accessibilityFacilities !== 'object' ||
        accessibilityFacilities === null
      ) {
        return Response.json(
          {
            success: false,
            message: 'Invalid accessibility facilities.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      const accessibility: Record<string, any> = {};

      // Simple boolean facilities
      const booleanFacilities = [
        'wheelchairRamp',
        'audioAnnouncement',
        'lowFloorVehicle',
        'walkingAssistance',
      ];

      for (const field of booleanFacilities) {
        if (accessibilityFacilities[field] !== undefined) {
          if (
            typeof accessibilityFacilities[field] !== 'boolean'
          ) {
            return Response.json(
              {
                success: false,
                message: `${field} must be true or false.`,
              },
              {
                status: 400,
                headers: corsHeaders,
              }
            );
          }

          accessibility[field] =
            accessibilityFacilities[field];
        }
      }

      // Facilities with availability + count
      const countFacilities = [
        'wheelchairSpace',
        'guardianSeats',
        'prioritySeats',
        'elderlySeats',
      ];

      for (const field of countFacilities) {
        const facility = accessibilityFacilities[field];

        if (facility !== undefined) {
          if (
            typeof facility !== 'object' ||
            facility === null
          ) {
            return Response.json(
              {
                success: false,
                message: `Invalid ${field} format.`,
              },
              {
                status: 400,
                headers: corsHeaders,
              }
            );
          }

          const available = facility.available;
          const count =
            facility.count === undefined
              ? 0
              : Number(facility.count);

          if (typeof available !== 'boolean') {
            return Response.json(
              {
                success: false,
                message: `${field}.available must be true or false.`,
              },
              {
                status: 400,
                headers: corsHeaders,
              }
            );
          }

          if (
            !Number.isInteger(count) ||
            count < 0
          ) {
            return Response.json(
              {
                success: false,
                message: `${field}.count must be a non-negative number.`,
              },
              {
                status: 400,
                headers: corsHeaders,
              }
            );
          }

          // If facility is unavailable, count should be 0
          accessibility[field] = {
            available,
            count: available ? count : 0,
          };
        }
      }

      updates.accessibilityFacilities = accessibility;
    }

    // Status
    if (status !== undefined) {
      const allowedStatuses = [
        'ACTIVE',
        'INACTIVE',
        'MAINTENANCE',
      ];

      if (!allowedStatuses.includes(status)) {
        return Response.json(
          {
            success: false,
            message:
              'Invalid status. Allowed values: ACTIVE, INACTIVE, MAINTENANCE.',
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      updates.status = status;
    }

    // Bus login password
    //
    // Follows the same partial-update rule as every field above: absent means
    // "leave it alone", so an edit that changes only the seat capacity cannot
    // wipe the credential. Only an explicitly supplied value replaces it, and
    // it is validated against the project policy before it does.
    if (password !== undefined) {
      const passwordCheck = validatePassword(password, 'Bus password');

      if (!passwordCheck.valid) {
        return Response.json(
          {
            success: false,
            message: passwordCheck.message,
          },
          {
            status: 400,
            headers: corsHeaders,
          }
        );
      }

      updates.password = password as string;
    }

    // --------------------------------------------------
    // Prevent empty update
    // --------------------------------------------------
    if (Object.keys(updates).length === 0) {
      return Response.json(
        {
          success: false,
          message: 'No valid fields were provided for update.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // --------------------------------------------------
    // Updated timestamp
    // --------------------------------------------------
    updates.updatedAt = new Date();

    // --------------------------------------------------
    // Update Firestore
    // --------------------------------------------------
    await resolvedBus.busRef.update(updates);

    // --------------------------------------------------
    // Get updated bus
    // --------------------------------------------------
    const updatedBusDoc = await resolvedBus.busRef.get();

    return Response.json(
      {
        success: true,
        message: 'Bus updated successfully.',
        bus: withoutBusCredentials(updatedBusDoc.data() ?? {}),
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Update Bus API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to update bus.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}

// --------------------------------------------------
// DELETE /api/buses/:busId
// --------------------------------------------------
export async function DELETE(
  request: Request,
  context: any
) {
  try {
    const adminDb = getAdminDb();

    let identifier = context?.params?.busId;

    // Fallback for Expo Router
    if (!identifier) {
      const url = new URL(request.url);
      const parts = url.pathname.split('/').filter(Boolean);
      identifier = parts[parts.length - 1];
    }

    if (!identifier) {
      return Response.json(
        {
          success: false,
          message: 'Bus ID or number plate is required.',
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // Find bus by Bus ID OR Number Plate
    const resolvedBus = await resolveBus(adminDb, identifier);

    if (!resolvedBus) {
      return Response.json(
        {
          success: false,
          message: 'Bus not found.',
        },
        {
          status: 404,
          headers: corsHeaders,
        }
      );
    }

    await resolvedBus.busRef.delete();

    return Response.json(
      {
        success: true,
        message: 'Bus deleted successfully.',
        busId: resolvedBus.busDoc.data()?.busId,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error('Delete Bus API Error:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to delete bus.',
        error: error?.message || 'Unknown error',
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
}