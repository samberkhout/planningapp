export enum SessionType {
  PLENARY = 'PLENARY',
  MANDATORY = 'MANDATORY',
  ELECTIVE = 'ELECTIVE',
  BREAK = 'BREAK'
}

export enum SlotType {
  SESSION = 'SESSION',
  BREAK = 'BREAK',
  MEAL = 'MEAL',
  OTHER = 'OTHER'
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
}

export interface TimeSlot {
  id: number;
  day: 1 | 2;
  label: string;
  type: SlotType;
  title?: string; // For fixed events like "Lunch"
}

export interface Session {
  id: number;
  title: string;
  speaker: string;
  type: SessionType;
  repeats: number; // How many times it is given (1 or 4)
  fixedSlot?: number; // If pre-assigned to a slot
  durationMinutes: number;
}

export interface Advisor {
  id: number;
  name: string;
  preferences: number[]; // Array of Session IDs in order of preference (1st choice, 2nd choice...)
}

// A specific instance of a session occurring in a room at a time
export interface ScheduledInstance {
  instanceId: string;
  sessionId: number;
  slotId: number;
  roomId: string;
  attendees: number[]; // Advisor IDs
}

export interface ScheduleResult {
  instances: ScheduledInstance[];
  advisors: Advisor[];
  fitness: number;
  stats: {
    averagePreferenceRank: number; // Lower is better
    mandatoryMetPercent: number;
    capacityViolations: number;
    unfilledSlots: number;
    minSizeViolations: number; // Groups < 7
  };
}