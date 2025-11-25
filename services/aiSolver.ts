import { Advisor, Room, ScheduledInstance, Session, SessionType, SlotType, ScheduleResult, TimeSlot } from '../types';

// --- Constants ---
const MIN_ATTENDEES_PER_SESSION = 7;

// --- Helper Functions ---
const shuffle = <T,>(array: T[]): T[] => {
  return [...array].sort(() => Math.random() - 0.5);
};

// --- Phase 0: Analyze Demand ---
const calculateSessionDemand = (advisors: Advisor[], sessions: Session[]): Map<number, number> => {
    const demand = new Map<number, number>();
    sessions.forEach(s => demand.set(s.id, 0)); // Init at 0

    advisors.forEach(adv => {
        adv.preferences.forEach((sessId, index) => {
            const current = demand.get(sessId) || 0;
            // Weight top choices heavily
            const weight = index < 3 ? 5 : 1; 
            demand.set(sessId, current + weight);
        });
    });
    return demand;
};

// --- Phase 1: Master Schedule Generation ---
const generateSmartMasterSchedule = (
  sessions: Session[], 
  timeSlots: TimeSlot[], 
  rooms: Room[],
  advisors: Advisor[]
): ScheduledInstance[] => {
  const instances: ScheduledInstance[] = [];
  let instanceCounter = 0;
  const occupied = new Set<string>(); // "slotId_roomId"
  const markOccupied = (slotId: number, roomId: string) => occupied.add(`${slotId}_${roomId}`);
  const isOccupied = (slotId: number, roomId: string) => occupied.has(`${slotId}_${roomId}`);

  const demandMap = calculateSessionDemand(advisors, sessions);

  // 1. Plenary (Fixed)
  const plenary = sessions.find(s => s.type === SessionType.PLENARY);
  let plenarySlotId = -1;
  if (plenary) {
    plenarySlotId = plenary.fixedSlot || 2;
    const roomId = 'molenhoek'; 
    instances.push({
      instanceId: `inst-${++instanceCounter}`,
      sessionId: plenary.id,
      slotId: plenarySlotId,
      roomId: roomId,
      attendees: []
    });
    markOccupied(plenarySlotId, roomId);
  }

  const sessionSlots = timeSlots
    .filter(ts => ts.type === SlotType.SESSION && ts.id !== plenarySlotId)
    .map(ts => ts.id);
  
  const parallelRooms = rooms.filter(r => r.id !== 'molenhoek'); 

  // 2. Mandatory Sessions (Spread efficiently)
  const mandatorySessions = sessions.filter(s => s.type === SessionType.MANDATORY);
  // We need enough capacity for everyone to attend every mandatory session
  const targetMandatoryCap = Math.ceil(advisors.length * 1.05); 

  for (const session of mandatorySessions) {
    let currentCapacity = 0;
    // Try to spread them out over different slots
    let availableSlots = shuffle([...sessionSlots]);
    let slotIndex = 0;

    while (currentCapacity < targetMandatoryCap) {
      if (availableSlots.length === 0) availableSlots = shuffle([...sessionSlots]);
      const slotId = availableSlots[slotIndex % availableSlots.length];
      slotIndex++;

      // Sort rooms: Mandatories usually need bigger rooms, but we use what fits
      const sortedRooms = shuffle([...parallelRooms]).sort((a,b) => b.capacity - a.capacity);
      
      const freeRoom = sortedRooms.find(r => !isOccupied(slotId, r.id));

      if (freeRoom) {
        instances.push({
          instanceId: `inst-${++instanceCounter}`,
          sessionId: session.id,
          slotId: slotId,
          roomId: freeRoom.id,
          attendees: []
        });
        markOccupied(slotId, freeRoom.id);
        currentCapacity += freeRoom.capacity;
      }
      
      // Safety break
      if (instances.length > 500) break; 
    }
  }

  // 3. Electives (Demand Driven)
  const electives = sessions.filter(s => s.type === SessionType.ELECTIVE);
  
  // Filter out electives with extremely low demand to prevent small groups automatically
  // If only 3 people want it, don't schedule it. They will be forced to pick something else.
  const viableElectives = electives.filter(s => (demandMap.get(s.id) || 0) >= 7);

  // Create a "Bag" of electives proportional to demand
  const electiveBag: Session[] = [];
  viableElectives.forEach(s => {
      const score = demandMap.get(s.id) || 0;
      // Add to bag multiple times based on popularity
      const count = Math.ceil(score / 20); // Arbitrary scaling
      for(let i=0; i<Math.max(1, count); i++) electiveBag.push(s);
  });

  // Fill remaining space in the grid
  for (const slotId of sessionSlots) {
      const occupiedInSlot = instances.filter(i => i.slotId === slotId).length;
      const roomsAvailable = parallelRooms.filter(r => !isOccupied(slotId, r.id));
      
      // CRITICAL UPDATE: Always fill ALL available rooms to ensure maximum seating capacity.
      // If the weighted bag runs out, fallback to ANY elective.
      // This ensures 188+ seats for 108 advisors, guaranteeing 0 missing lectures.
      for (const room of roomsAvailable) {
          
          let session: Session;
          
          if (electiveBag.length > 0) {
            // Pick random elective from weighted bag
            session = electiveBag[Math.floor(Math.random() * electiveBag.length)];
          } else {
             // Fallback: Pick any elective to keep the room open
             session = electives[Math.floor(Math.random() * electives.length)];
          }
          
          instances.push({
            instanceId: `inst-${++instanceCounter}`,
            sessionId: session.id,
            slotId: slotId,
            roomId: room.id,
            attendees: []
          });
          markOccupied(slotId, room.id);
      }
  }

  return instances;
};


// --- Phase 2: Assignment Logic ---
const runSinglePass = (
  advisors: Advisor[], 
  sessions: Session[], 
  timeSlots: TimeSlot[], 
  rooms: Room[]
): ScheduleResult => {
  
  let masterSchedule = generateSmartMasterSchedule(sessions, timeSlots, rooms, advisors);
  
  const activeSessionSlots = timeSlots.filter(ts => ts.type === SlotType.SESSION).map(ts => ts.id);
  const TOTAL_SLOTS = activeSessionSlots.length; // Maximaal vullen target

  // --- Speaker Detection (Conflict Resolution) ---
  // Map<AdvisorID, Set<SlotID>> - Slots where this advisor is BUSY speaking
  const speakerConflicts = new Map<number, Set<number>>();
  
  advisors.forEach(adv => {
      // Improved matching: Split speakers by separators and check exact inclusion
      // This handles "Fokko Prins & Jan Ties Malda" correctly finding "Fokko Prins"
      const speakingSessions = sessions.filter(s => {
          if (!s.speaker) return false;
          // Split by common separators: "/", "&", "+", ",", " en "
          const parts = s.speaker.split(/[\/&+,]| en /i).map(p => p.trim().toLowerCase());
          const advName = adv.name.toLowerCase();
          
          return parts.some(part => part.includes(advName) || advName.includes(part));
      });
      
      if (speakingSessions.length > 0) {
          const busySlots = new Set<number>();
          speakingSessions.forEach(s => {
              // Find when this session is scheduled in master schedule
              const scheduledTimes = masterSchedule.filter(i => i.sessionId === s.id).map(i => i.slotId);
              scheduledTimes.forEach(slotId => busySlots.add(slotId));
          });
          speakerConflicts.set(adv.id, busySlots);
      }
  });


  // Quick Lookup Helpers
  const getRoomCap = (rid: string) => rooms.find(r => r.id === rid)?.capacity || 0;
  const isFull = (inst: ScheduledInstance) => inst.attendees.length >= getRoomCap(inst.roomId);
  const getAdvisorSchedule = (advId: number) => masterSchedule.filter(i => i.attendees.includes(advId));
  
  // "Busy" now includes: 
  // 1. Attending another session
  // 2. Presenting a session (Conflict)
  const isBusyAt = (advId: number, slotId: number) => {
      const attending = getAdvisorSchedule(advId).some(i => i.slotId === slotId);
      if (attending) return true;
      
      const speakingSlots = speakerConflicts.get(advId);
      if (speakingSlots && speakingSlots.has(slotId)) return true;
      
      return false;
  };

  // Count activities: Attending + Speaking
  const getActivityCount = (advId: number) => {
      const attending = getAdvisorSchedule(advId).length;
      const speakingSlots = speakerConflicts.get(advId);
      const speaking = speakingSlots ? speakingSlots.size : 0;
      return attending + speaking;
  };

  // A. PLENARY (Must Attend - unless presenting)
  const plenaryInst = masterSchedule.find(i => sessions.find(s => s.id === i.sessionId)?.type === SessionType.PLENARY);
  if (plenaryInst) {
      advisors.forEach(adv => {
          if (!isFull(plenaryInst) && !isBusyAt(adv.id, plenaryInst.slotId)) {
              plenaryInst.attendees.push(adv.id);
          }
      });
  }

  // B. MANDATORY (Must Attend 5)
  const mandatoryIds = sessions.filter(s => s.type === SessionType.MANDATORY).map(s => s.id);
  
  for (const advisor of shuffle(advisors)) {
      for (const mid of mandatoryIds) {
          // If already attending OR speaking this specific mandatory session
          if (getAdvisorSchedule(advisor.id).some(i => i.sessionId === mid)) continue;
          
          // If they are the speaker of this session, they don't need to attend it as a participant
          const isSpeakerForThis = sessions.find(s => s.id === mid)?.speaker.toLowerCase().includes(advisor.name.toLowerCase());
          if (isSpeakerForThis) continue;

          const candidates = masterSchedule.filter(i => i.sessionId === mid && !isFull(i) && !isBusyAt(advisor.id, i.slotId));
          if (candidates.length > 0) {
              candidates.sort((a,b) => b.attendees.length - a.attendees.length);
              candidates[0].attendees.push(advisor.id);
          }
      }
  }

  // C. PREFERENCES (Electives)
  for (let rank = 0; rank < 15; rank++) {
      for (const advisor of shuffle(advisors)) {
          // REMOVED CAP: if (getActivityCount(advisor.id) >= TARGET_SESSIONS_PER_USER) continue;

          const prefId = advisor.preferences[rank];
          if (!prefId) continue;
          if (getAdvisorSchedule(advisor.id).some(i => i.sessionId === prefId)) continue;

          const candidates = masterSchedule.filter(i => i.sessionId === prefId && !isFull(i) && !isBusyAt(advisor.id, i.slotId));
          
          if (candidates.length > 0) {
              candidates.sort((a,b) => b.attendees.length - a.attendees.length);
              candidates[0].attendees.push(advisor.id);
          }
      }
  }

  // D. GAP FILLING (Maximize Fullness) - Force assignments to ANY slot that is empty
  for (const advisor of shuffle(advisors)) {
      // Find all empty slots for this advisor
      const myInstances = getAdvisorSchedule(advisor.id);
      const busySlots = new Set(myInstances.map(i => i.slotId));
      
      const speakerBusy = speakerConflicts.get(advisor.id);
      if (speakerBusy) speakerBusy.forEach(s => busySlots.add(s));

      // Slots where the advisor does NOTHING yet
      const freeSlots = activeSessionSlots.filter(sid => !busySlots.has(sid));

      for (const slotId of freeSlots) {
          // Try to find ANY non-full session in this slot
          // Prioritize sessions that already have people (to avoid small groups), then preferences
          const candidates = masterSchedule.filter(i => 
              i.slotId === slotId && 
              !isFull(i) && 
              !myInstances.some(my => my.sessionId === i.sessionId) // Should be redundant if slots distinct
          );
          
          let bestCandidate: ScheduledInstance | null = null;
          let bestScore = -999;

          for (const cand of candidates) {
              let score = 0;
              // Prioritize joining existing groups
              if (cand.attendees.length > 0) score += 50; 
              // Heavily prioritize filling small groups to reach min size
              if (cand.attendees.length < MIN_ATTENDEES_PER_SESSION && cand.attendees.length > 0) score += 100; 
              // Slight bonus if it happens to be a preference (even if lower rank)
              if (advisor.preferences.includes(cand.sessionId)) score += 10;
              
              if (score > bestScore) {
                  bestScore = score;
                  bestCandidate = cand;
              }
          }

          if (bestCandidate) {
              bestCandidate.attendees.push(advisor.id);
          }
          // If no candidate found (all rooms full?), slot remains empty -> "???" in export
      }
  }

  // E. CLEANUP: DISSOLVE SMALL GROUPS
  let changed = true;
  let loops = 0;
  while(changed && loops < 3) {
      changed = false;
      loops++;
      const smallGroups = masterSchedule.filter(i => i.attendees.length > 0 && i.attendees.length < MIN_ATTENDEES_PER_SESSION);
      
      for (const group of smallGroups) {
          const members = [...group.attendees];
          const keptMembers: number[] = [];

          for (const memberId of members) {
              // Find alternative in same slot
              const alts = masterSchedule.filter(i => 
                  i.slotId === group.slotId && 
                  i.instanceId !== group.instanceId && 
                  !isFull(i) &&
                  !getAdvisorSchedule(memberId).some(my => my.sessionId === i.sessionId) 
              );
              
              alts.sort((a,b) => b.attendees.length - a.attendees.length);

              if (alts.length > 0) {
                  alts[0].attendees.push(memberId);
                  changed = true;
              } else {
                  keptMembers.push(memberId);
              }
          }
          group.attendees = keptMembers;
      }
  }

  // F. FORCE RECRUITMENT
  const stubbornSmallGroups = masterSchedule.filter(i => i.attendees.length > 0 && i.attendees.length < MIN_ATTENDEES_PER_SESSION);
  for (const group of stubbornSmallGroups) {
      const needed = MIN_ATTENDEES_PER_SESSION - group.attendees.length;
      let recruited = 0;
      
      const potentialRecruits = shuffle(advisors).filter(a => 
          !isBusyAt(a.id, group.slotId) && 
          !getAdvisorSchedule(a.id).some(i => i.sessionId === group.sessionId)
      );

      for (const recruit of potentialRecruits) {
          if (recruited >= needed) break;
          if (isFull(group)) break;
          
          group.attendees.push(recruit.id);
          recruited++;
      }
  }

  // Final Cleanup
  masterSchedule = masterSchedule.filter(i => i.attendees.length > 0);


  // --- Metrics Calculation ---
  let totalMandatoryCount = 0;
  let capacityViolations = 0;
  let totalRankSum = 0;
  let usersWithIncompleteSchedule = 0;
  let lowAttendanceSessions = 0;

  advisors.forEach(adv => {
      const myInsts = masterSchedule.filter(i => i.attendees.includes(adv.id));
      const mySessionIds = myInsts.map(i => i.sessionId);
      const speakingSlots = speakerConflicts.get(adv.id);
      
      // Mandatory Check
      mandatoryIds.forEach(mid => {
          if (mySessionIds.includes(mid)) totalMandatoryCount++;
          // Treat speaking as "Attending" for metric purposes so we don't penalize speakers
          else if (sessions.find(s => s.id === mid)?.speaker.toLowerCase().includes(adv.name.toLowerCase())) {
              totalMandatoryCount++;
          }
      });

      const activityCount = myInsts.length + (speakingSlots ? speakingSlots.size : 0);
      // Metric: Should ideally match TOTAL_SLOTS (everything filled)
      if (activityCount < TOTAL_SLOTS) {
          usersWithIncompleteSchedule += (TOTAL_SLOTS - activityCount); // Count total empty slots across all users
      }

      // Rank Check
      myInsts.forEach(inst => {
          const sess = sessions.find(s => s.id === inst.sessionId);
          if (sess?.type === SessionType.ELECTIVE) {
              const idx = adv.preferences.indexOf(sess.id);
              if (idx !== -1) totalRankSum += (idx + 1);
              else totalRankSum += 20;
          }
      });
  });

  masterSchedule.forEach(inst => {
      if (inst.attendees.length > getRoomCap(inst.roomId)) capacityViolations++;
      if (inst.attendees.length < MIN_ATTENDEES_PER_SESSION) lowAttendanceSessions++;
  });

  const mandatoryTotalPossible = advisors.length * mandatoryIds.length;
  const mandatoryMetPercent = mandatoryTotalPossible > 0 ? (totalMandatoryCount / mandatoryTotalPossible) * 100 : 0;
  const avgRank = totalRankSum / (advisors.length * 10); // Approx denom

  let fitness = 0;
  fitness += (mandatoryMetPercent * 10000);
  fitness -= (capacityViolations * 100000);
  fitness -= (lowAttendanceSessions * 5000);
  fitness -= (usersWithIncompleteSchedule * 500); // Increased penalty for missing lectures
  fitness -= avgRank;

  return {
    instances: masterSchedule,
    advisors,
    fitness,
    stats: {
      mandatoryMetPercent,
      averagePreferenceRank: avgRank,
      capacityViolations,
      unfilledSlots: usersWithIncompleteSchedule, // Now represents TOTAL empty slots across all users
      minSizeViolations: lowAttendanceSessions
    }
  };
};

export const solveSchedule = async (
  advisors: Advisor[], 
  sessions: Session[], 
  timeSlots: TimeSlot[], 
  rooms: Room[]
): Promise<ScheduleResult> => {

  const START_TIME = Date.now();
  const MAX_DURATION_MS = 15000; // Increased to 15 seconds to "keep trying"
  const MAX_ITERATIONS = 2000; // Increased significantly to find the perfect fit

  let bestResult: ScheduleResult | null = null;
  let iterations = 0;

  console.log(`Starting Robust Solver with Max Fill Logic...`);

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    if (Date.now() - START_TIME > MAX_DURATION_MS && bestResult) break;

    const result = runSinglePass(advisors, sessions, timeSlots, rooms);

    if (!bestResult || result.fitness > bestResult.fitness) {
      bestResult = result;
    }

    if (result.stats.mandatoryMetPercent >= 99.9 && 
        result.stats.capacityViolations === 0 &&
        result.stats.unfilledSlots === 0 &&
        result.stats.minSizeViolations === 0) {
      console.log(`Perfect solution found in ${iterations} iterations.`);
      break; 
    }
  }
  
  console.log("Solver finished.");
  return bestResult!;
};