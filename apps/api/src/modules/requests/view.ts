import type { RequestStatus } from '@venue/shared';
import { venueRequests, venues, type events } from '../../db/schema.js';

export const requestSelection = {
  id: venueRequests.id,
  eventId: venueRequests.eventId,
  submittedById: venueRequests.submittedById,
  requiresFacultyEndorsement: venueRequests.requiresFacultyEndorsement,
  facultyEndorserId: venueRequests.facultyEndorserId,
  facultyEndorsedAt: venueRequests.facultyEndorsedAt,
  workflowId: venueRequests.workflowId,
  venueId: venueRequests.venueId,
  startTime: venueRequests.startTime,
  endTime: venueRequests.endTime,
  setupBufferMins: venueRequests.setupBufferMins,
  teardownBufferMins: venueRequests.teardownBufferMins,
  status: venueRequests.status,
  currentStepOrder: venueRequests.currentStepOrder,
  rejectionReason: venueRequests.rejectionReason,
  createdAt: venueRequests.createdAt,
  updatedAt: venueRequests.updatedAt,
  venueCode: venues.code,
  venueName: venues.name,
  venueBuilding: venues.building,
  venueFloor: venues.floor,
  venueCapacity: venues.capacity,
};

export interface RequestRow {
  id: string;
  eventId: string;
  submittedById: string;
  requiresFacultyEndorsement: boolean;
  facultyEndorserId: string | null;
  facultyEndorsedAt: Date | null;
  workflowId: string;
  venueId: string;
  startTime: Date;
  endTime: Date;
  setupBufferMins: number;
  teardownBufferMins: number;
  status: RequestStatus;
  currentStepOrder: number;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  venueCode: string;
  venueName: string;
  venueBuilding: string;
  venueFloor: number;
  venueCapacity: number;
}

export interface RequestView {
  id: string;
  eventId: string;
  submittedById: string;
  requiresFacultyEndorsement: boolean;
  facultyEndorserId: string | null;
  facultyEndorsedAt: string | null;
  venue: {
    id: string;
    code: string;
    name: string;
    building: string;
    floor: number;
    capacity: number;
  };
  startTime: string;
  endTime: string;
  effectiveStart: string;
  effectiveEnd: string;
  setupBufferMins: number;
  teardownBufferMins: number;
  status: RequestStatus;
  currentStepOrder: number;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapRequestRow(row: RequestRow): RequestView {
  return {
    id: row.id,
    eventId: row.eventId,
    submittedById: row.submittedById,
    requiresFacultyEndorsement: row.requiresFacultyEndorsement,
    facultyEndorserId: row.facultyEndorserId,
    facultyEndorsedAt: row.facultyEndorsedAt ? row.facultyEndorsedAt.toISOString() : null,
    venue: {
      id: row.venueId,
      code: row.venueCode,
      name: row.venueName,
      building: row.venueBuilding,
      floor: row.venueFloor,
      capacity: row.venueCapacity,
    },
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    effectiveStart: new Date(row.startTime.getTime() - row.setupBufferMins * 60_000).toISOString(),
    effectiveEnd: new Date(row.endTime.getTime() + row.teardownBufferMins * 60_000).toISOString(),
    setupBufferMins: row.setupBufferMins,
    teardownBufferMins: row.teardownBufferMins,
    status: row.status,
    currentStepOrder: row.currentStepOrder,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface FacultyCoordinatorSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface EventSummary {
  id: string;
  title: string;
  description: string | null;
  expectedAttendance: number;
  status: (typeof events.$inferSelect)['status'];
  department: { id: string; code: string; name: string };
  facultyCoordinatorId?: string | null;
  facultyCoordinator?: FacultyCoordinatorSummary | null;
  creatorId?: string;
  submittedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventView extends EventSummary {
  requests: RequestView[];
}
