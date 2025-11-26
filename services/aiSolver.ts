
import {
  Advisor,
  Room,
  ScheduledInstance,
  Session,
  SlotType,
  ScheduleResult,
  TimeSlot,
  SessionType
} from '../types';

// ===================
// GENETIC ALGORITHM CONFIG
// ===================

const GA_CONFIG = {
  POPULATION_SIZE: 200,
  ELITISM_COUNT: 10,
  MUTATION_RATE: 0.15,
  MAX_GENERATIONS: 3000,
  TIME_LIMIT_MS: 300000, // Hard cap 5 minutes

  // Fitness Weights
  WEIGHTS: {
    CAPACITY_VIOLATION: -50000, // Critical
    MANDATORY_MISSING: -100000, // Critical - Highest Priority
    SPEAKER_CONFLICT: -50000,   // (Nog niet expliciet gebruikt, maar gereserveerd)
    DUPLICATE_SLOT: -50000,
    UNFILLED_SLOT: -5000,
    PREFERENCE_MET: 100,
    MIN_SIZE_VIOLATION: -10,
    DUPLICATE_SESSION: -100000 // New strict penalty for doing same session twice
  }
};

export type ProgressCallback = (
  data: { iteration: number; maxIterations: number; stats: any }
) => void;

// ===================
// TYPE DEFINITIONS
// ===================

interface Gene {
  sessionId: number;
  slotId: number;
  roomId: string;
}

// Map<AdvisorId, Map<SlotId, Gene>>
type Genome = Map<number, Map<number, Gene>>;

interface Individual {
  genome: Genome;
  fitness: number;
  stats: any;
  instances: ScheduledInstance[];
}

interface PresenterObligation {
  advId: number;
  sessionId: number;
  slotId: number;
  roomId: string;
}

type MutationMode = 'MANDATORY_FIX' | 'CAPACITY_FIX' | 'FILL_SLOT' | 'RANDOM_SWAP';

// ===================
// HELPER FUNCTIONS
// ===================

const getStrictCapacity = (
  roomId: string,
  sessionId: number,
  slotId: number,
  roomsById: Map<string, Room>,
  slotsById: Map<number, TimeSlot>,
  sessions: Session[]
): number => {
  const room = roomsById.get(roomId);
  const slot = slotsById.get(slotId);

  if (!room || !slot) return 0;

  // 1. Molenhoek Rule (Plenary only)
  if (roomId === 'molenhoek') {
    return sessionId === 46 ? 300 : 0;
  }

  // 2. Thursday Restrictions
  if (slot.day === 2 && roomId === 'kinderdijk') {
    return 0;
  }

  // 3. Mandatory Session Exception
  // STRICT RULE: Only MANDATORY sessions get 32. Electives stay at 27.
  const session = sessions.find(s => s.id === sessionId);
  if (session && session.type === SessionType.MANDATORY && room.capacity <= 27) {
    return 32;
  }

  // Default to room capacity
  return room.capacity;
};

const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

const matchSpeakerToAdvisor = (speaker: string, advisor: Advisor): boolean => {
  if (!speaker) return false;

  const speakerParts = speaker
    .split(/[/&+,]|\ben\b/i)
    .map(p => normalizeName(p))
    .filter(Boolean);

  const advisorName = normalizeName(advisor.name);
  return speakerParts.some(part => advisorName.includes(part));
};

const buildPresenterObligations = (
  sessions: Session[],
  advisors: Advisor[],
  masterOptions: ScheduledInstance[]
): Map<number, PresenterObligation[]> => {
  const sessionsById = new Map(sessions.map(s => [s.id, s]));
  const obligations = new Map<number, PresenterObligation[]>();

  masterOptions.forEach(inst => {
    const session = sessionsById.get(inst.sessionId);
    if (!session || !session.speaker) return;

    advisors.forEach(adv => {
      if (matchSpeakerToAdvisor(session.speaker, adv)) {
        const list = obligations.get(inst.slotId) ?? [];
        const exists = list.some(o => o.advId === adv.id && o.sessionId === inst.sessionId);
        if (!exists) {
          list.push({ advId: adv.id, sessionId: inst.sessionId, slotId: inst.slotId, roomId: inst.roomId });
        }
        obligations.set(inst.slotId, list);
      }
    });
  });

  return obligations;
};

const enforcePresenterObligations = (
  ind: Individual,
  presenterObligations: Map<number, PresenterObligation[]>,
  masterOptions: ScheduledInstance[]
) => {
  presenterObligations.forEach((list, slotId) => {
    list.forEach(ob => {
      let advGenes = ind.genome.get(ob.advId);
      if (!advGenes) {
        advGenes = new Map();
        ind.genome.set(ob.advId, advGenes);
      }

      const targetInstance = masterOptions.find(
        i => i.sessionId === ob.sessionId && i.slotId === ob.slotId && i.roomId === ob.roomId
      );
      if (!targetInstance) return;

      advGenes.set(slotId, {
        sessionId: targetInstance.sessionId,
        slotId: targetInstance.slotId,
        roomId: targetInstance.roomId
      });

      const existing = ind.instances.find(
        i => i.sessionId === targetInstance.sessionId && i.slotId === targetInstance.slotId && i.roomId === targetInstance.roomId
      );
      if (existing && !existing.attendees.includes(ob.advId)) {
        existing.attendees.push(ob.advId);
      }
    });
  });
};

// ===================
// MASTER SCHEDULE GENERATOR
// ===================

const generateSmartMasterOptions = (
  sessions: Session[],
  rooms: Room[],
  timeSlots: TimeSlot[],
  fixedInstances: Partial<ScheduledInstance>[],
  roomsById: Map<string, Room>,
  slotsById: Map<number, TimeSlot>,
  advisors: Advisor[]
): ScheduledInstance[] => {
  const masterOptions: ScheduledInstance[] = [];
  let instanceCounter = 0;
  const sessionSlots = timeSlots
    .filter(ts => ts.type === SlotType.SESSION)
    .map(ts => ts.id);

  // Preference-aware weighting to place popular electives in larger rooms first
  const preferenceDemand = new Map<number, number>();
  advisors.forEach(adv => {
    adv.preferences.forEach((pref, idx) => {
      const weight = Math.max(1, adv.preferences.length - idx);
      preferenceDemand.set(pref, (preferenceDemand.get(pref) ?? 0) + weight);
    });
  });

  // Track usage: Map<SlotId, Set<RoomId>>
  const usedSlots = new Map<number, Set<string>>();
  sessionSlots.forEach(sid => usedSlots.set(sid, new Set()));

  const markUsed = (slotId: number, roomId: string) => {
    const s = usedSlots.get(slotId);
    if (s) s.add(roomId);
  };

  const isUsed = (slotId: number, roomId: string) => {
    return usedSlots.get(slotId)?.has(roomId);
  };

  // 1. Load Fixed Instances (from Excel)
  fixedInstances.forEach(fi => {
    if (fi.sessionId && fi.roomId && fi.slotId) {
      masterOptions.push({
        instanceId: `inst-${++instanceCounter}`,
        sessionId: fi.sessionId,
        roomId: fi.roomId,
        slotId: fi.slotId,
        attendees: []
      });
      markUsed(fi.slotId, fi.roomId);
    }
  });

  // 1.5 FORCE PLENARY (Session 46 -> Slot 2 (Lezing 1) -> Molenhoek)
  const plenarySessions = sessions.filter(s => s.type === SessionType.PLENARY);
  plenarySessions.forEach(sess => {
      // Slot 2 is defined as Lezing 1 (08.15 - 09.15)
      // Check if it's already there from fixedInstances
      const existing = masterOptions.find(m => m.sessionId === sess.id && m.slotId === 2);
      if (!existing) {
          masterOptions.push({
            instanceId: `inst-${++instanceCounter}`,
            sessionId: sess.id,
            roomId: 'molenhoek',
            slotId: 2,
            attendees: []
          });
          markUsed(2, 'molenhoek');
      }
  });


  // 2. Place Mandatory Sessions
  const mandatorySessions = sessions.filter(s => s.type === SessionType.MANDATORY);

  mandatorySessions.forEach(sess => {
    const existing = masterOptions.filter(m => m.sessionId === sess.id).length;
    let needed = sess.repeats - existing;

    if (needed > 0) {
      const possibleSlots = sessionSlots.filter(sid => {
        const s = slotsById.get(sid);
        return s?.day === 1; // Force Day 1
      });

      const largeRooms = [...rooms]
        .sort((a, b) => b.capacity - a.capacity)
        .filter(r => r.id !== 'molenhoek');

      for (const slotId of possibleSlots) {
        if (needed <= 0) break;

        for (const room of largeRooms) {
          if (needed <= 0) break;
          if (!isUsed(slotId, room.id)) {
            if (getStrictCapacity(room.id, sess.id, slotId, roomsById, slotsById, sessions) > 0) {
              masterOptions.push({
                instanceId: `inst-${++instanceCounter}`,
                sessionId: sess.id,
                roomId: room.id,
                slotId: slotId,
                attendees: []
              });
              markUsed(slotId, room.id);
              needed--;
            }
          }
        }
      }
    }
  });

  // 3. Place Electives
  const electiveSessions = sessions.filter(s => s.type === SessionType.ELECTIVE);
  const electivePlacements = new Map<number, number>();

  const sortedSlots = [...sessionSlots].sort((a, b) => a - b);

  sortedSlots.forEach(slotId => {
    const roomsInSlot = rooms.filter(r => r.id !== 'molenhoek').sort((a, b) => b.capacity - a.capacity);
    const availableRooms = roomsInSlot.filter(r => !isUsed(slotId, r.id));

    availableRooms.forEach(room => {
      const candidates = electiveSessions
        .filter(sess => {
          const placedCount = electivePlacements.get(sess.id) ?? 0;
          const demandTarget = Math.max(sess.repeats, Math.ceil((preferenceDemand.get(sess.id) ?? 0) / 25));
          if (placedCount >= Math.ceil(demandTarget * 1.1)) return false;

          const sData = slotsById.get(slotId);
          if (sess.constraints && sData) {
            if (
              sess.constraints.allowedDays.length > 0 &&
              !sess.constraints.allowedDays.includes(sData.day)
            )
              return false;
            if (
              sess.constraints.timeOfDay === 'morning' &&
              !(
                sData.label.startsWith('08') ||
                sData.label.startsWith('09') ||
                sData.label.startsWith('10') ||
                sData.label.startsWith('11')
              )
            )
              return false;
            if (
              sess.constraints.timeOfDay === 'afternoon' &&
              (sData.label.startsWith('08') || sData.label.startsWith('09') || sData.label.startsWith('10'))
            )
              return false;
          }

          return true;
        })
        .sort((a, b) => {
          const demandA = preferenceDemand.get(a.id) ?? 0;
          const demandB = preferenceDemand.get(b.id) ?? 0;
          const placedA = electivePlacements.get(a.id) ?? 0;
          const placedB = electivePlacements.get(b.id) ?? 0;

          const scoreA = demandA / Math.max(1, placedA + 1);
          const scoreB = demandB / Math.max(1, placedB + 1);
          return scoreB - scoreA;
        });

      const best = candidates[0];
      if (best) {
        masterOptions.push({
          instanceId: `inst-${++instanceCounter}`,
          sessionId: best.id,
          roomId: room.id,
          slotId: slotId,
          attendees: []
        });
        markUsed(slotId, room.id);
        electivePlacements.set(best.id, (electivePlacements.get(best.id) ?? 0) + 1);
      }
    });
  });

  return masterOptions;
};

// ===================
// BULLDOZER / POST-PROCESSOR
// ===================

const refineScheduleWithBulldozer = (
  ind: Individual,
  advisors: Advisor[],
  sessions: Session[],
  masterOptions: ScheduledInstance[],
  roomsById: Map<string, Room>,
  slotsById: Map<number, TimeSlot>,
  presenterObligations: Map<number, PresenterObligation[]>
) => {
  enforcePresenterObligations(ind, presenterObligations, masterOptions);

  const isBusy = (advId: number, slotId: number) => {
    const genes = ind.genome.get(advId);
    return genes ? genes.has(slotId) : false;
  };

  const isAttendingSession = (advId: number, sessionId: number) => {
      const genes = ind.genome.get(advId);
      if (!genes) return false;
      for (const g of genes.values()) {
          if (g.sessionId === sessionId) return true;
      }
      return false;
  };

  const removeGene = (advId: number, slotId: number) => {
    const g = ind.genome.get(advId);
    if (g && g.has(slotId)) {
      const gene = g.get(slotId)!;
      g.delete(slotId);
      const inst = ind.instances.find(
        i => i.slotId === slotId && i.roomId === gene.roomId
      );
      if (inst) inst.attendees = inst.attendees.filter(a => a !== advId);
    }
  };

  const addGene = (advId: number, inst: ScheduledInstance) => {
    removeGene(advId, inst.slotId);
    const g = ind.genome.get(advId)!;
    g.set(inst.slotId, {
      sessionId: inst.sessionId,
      roomId: inst.roomId,
      slotId: inst.slotId
    });
    inst.attendees.push(advId);
  };

  // PHASE 1: FORCE MANDATORY (AND PLENARY)
  // Include Plenary in the mandatory enforcement loop
  const mandatorySessions = sessions.filter(s => s.type === SessionType.MANDATORY || s.type === SessionType.PLENARY);
  
  advisors.forEach(adv => {
    mandatorySessions.forEach(ms => {
      const genes = ind.genome.get(adv.id);
      let attending = false;
      if (genes) {
        for (const gene of genes.values()) {
          if (gene.sessionId === ms.id) attending = true;
        }
      }

      if (!attending) {
        const instances = ind.instances.filter(i => i.sessionId === ms.id);

        // Sort by available capacity
        instances.sort((a, b) => {
          const capA = getStrictCapacity(
            a.roomId,
            a.sessionId,
            a.slotId,
            roomsById,
            slotsById,
            sessions
          );
          const capB = getStrictCapacity(
            b.roomId,
            b.sessionId,
            b.slotId,
            roomsById,
            slotsById,
            sessions
          );
          return (capB - b.attendees.length) - (capA - a.attendees.length);
        });

        let assigned = false;

        // 1. Try free slot
        for (const inst of instances) {
          if (!isBusy(adv.id, inst.slotId)) {
            const cap = getStrictCapacity(
              inst.roomId,
              inst.sessionId,
              inst.slotId,
              roomsById,
              slotsById,
              sessions
            );
            if (inst.attendees.length < cap) {
              addGene(adv.id, inst);
              assigned = true;
              break;
            }
          }
        }

        // 2. Kick out elective
        if (!assigned) {
          for (const inst of instances) {
          const currentGene = ind.genome.get(adv.id)?.get(inst.slotId);
          const hasPresenterConflict = presenterObligations.get(inst.slotId)?.some(o => o.advId === adv.id);
          // We can overwrite if current is elective OR nothing and not conflicting with presenting
          if (
            !hasPresenterConflict &&
            (!currentGene ||
              sessions.find(s => s.id === currentGene.sessionId)?.type === SessionType.ELECTIVE)
          ) {
            addGene(adv.id, inst);
            assigned = true;
            break;
          }
        }
        }

        // 3. Last resort - overwrite anything that isn't another mandatory
        if (!assigned && instances.length > 0) {
           const inst = instances[0];
           const currentGene = ind.genome.get(adv.id)?.get(inst.slotId);
           const currentSession = currentGene ? sessions.find(s => s.id === currentGene.sessionId) : null;

           const hasPresenterConflict = presenterObligations.get(inst.slotId)?.some(o => o.advId === adv.id);

           if (!hasPresenterConflict && (!currentSession || (currentSession.type !== SessionType.MANDATORY && currentSession.type !== SessionType.PLENARY))) {
               addGene(adv.id, inst);
           }
        }
      }
    });
  });

  // PHASE 2: FILL HOLES
  const sessionSlots = Array.from(slotsById.values())
    .filter(s => s.type === SlotType.SESSION)
    .map(s => s.id);

  advisors.forEach(adv => {
    const genes = ind.genome.get(adv.id)!;

    sessionSlots.forEach(slotId => {
      // Check if advisor is speaking in this slot
      const presenterConflict = presenterObligations.get(slotId)?.some(o => o.advId === adv.id);
      if (presenterConflict) return;

      if (!genes.has(slotId)) {
        const possible = ind.instances.filter(i => i.slotId === slotId);
        
        // Only consider sessions the advisor is NOT already attending elsewhere
        const validOptions = possible.filter(i => !isAttendingSession(adv.id, i.sessionId));

        const withSpace = validOptions.filter(
          i =>
            i.attendees.length <
            getStrictCapacity(i.roomId, i.sessionId, i.slotId, roomsById, slotsById, sessions)
        );

        if (withSpace.length > 0) {
          // Optimization: Pick preferred if available
          const pref = withSpace.find(i => adv.preferences.includes(i.sessionId));
          const choice = pref || withSpace[0];
          genes.set(slotId, {
            sessionId: choice.sessionId,
            roomId: choice.roomId,
            slotId: choice.slotId
          });
          choice.attendees.push(adv.id);
        } else if (validOptions.length > 0) {
          // Force fill if needed (ignoring capacity for a moment to ensure 0 missing, AI will fix later or error remains)
          // Actually, let's respect capacity but try harder next loop. 
          // Bulldozer override: Pick the one with most space available (least negative capacity)
           const bestOption = validOptions.sort((a,b) => a.attendees.length - b.attendees.length)[0];
           genes.set(slotId, {
            sessionId: bestOption.sessionId,
            roomId: bestOption.roomId,
            slotId: bestOption.slotId
          });
          bestOption.attendees.push(adv.id);
        }
      }
    });
  });

  // PHASE 3: Remove duplicate sessions per advisor and refill with best available
  advisors.forEach(adv => {
    const genes = ind.genome.get(adv.id)!;
    const preferenceRank = new Map<number, number>();
    adv.preferences.forEach((p, idx) => preferenceRank.set(p, idx));

    const seenSessions = new Map<number, number>();
    genes.forEach((gene, slotId) => {
      if (seenSessions.has(gene.sessionId)) {
        removeGene(adv.id, slotId);
      } else {
        seenSessions.set(gene.sessionId, slotId);
      }
    });

    sessionSlots.forEach(slotId => {
      if (genes.has(slotId)) return;

      const presenterConflict = presenterObligations.get(slotId)?.some(o => o.advId === adv.id);
      if (presenterConflict) return;

      const options = ind.instances.filter(
        i =>
          i.slotId === slotId &&
          !seenSessions.has(i.sessionId) &&
          i.attendees.length <
            getStrictCapacity(i.roomId, i.sessionId, i.slotId, roomsById, slotsById, sessions)
      );

      options.sort((a, b) => {
        const rankA = preferenceRank.get(a.sessionId) ?? Number.MAX_SAFE_INTEGER;
        const rankB = preferenceRank.get(b.sessionId) ?? Number.MAX_SAFE_INTEGER;
        return rankA - rankB;
      });

      const choice = options[0];
      if (choice) {
        addGene(adv.id, choice);
        seenSessions.set(choice.sessionId, slotId);
      }
    });
  });

  // PHASE 4: Rebalance overfull sessions by moving low-preference attendees to open seats
  const preferenceRanks = new Map<number, Map<number, number>>();
  advisors.forEach(adv => {
    const map = new Map<number, number>();
    adv.preferences.forEach((p, idx) => map.set(p, idx));
    preferenceRanks.set(adv.id, map);
  });

  const overfullInstances = ind.instances.filter(inst => {
    const cap = getStrictCapacity(inst.roomId, inst.sessionId, inst.slotId, roomsById, slotsById, sessions);
    return inst.attendees.length > cap;
  });

  overfullInstances.forEach(inst => {
    const cap = getStrictCapacity(inst.roomId, inst.sessionId, inst.slotId, roomsById, slotsById, sessions);
    while (inst.attendees.length > cap) {
      const candidateAdv = [...inst.attendees].sort((a, b) => {
        const rankMapA = preferenceRanks.get(a);
        const rankMapB = preferenceRanks.get(b);
        const rankA = rankMapA?.get(inst.sessionId) ?? Number.MAX_SAFE_INTEGER;
        const rankB = rankMapB?.get(inst.sessionId) ?? Number.MAX_SAFE_INTEGER;
        return rankB - rankA;
      })[0];

      if (candidateAdv === undefined) break;

      const presenterConflict = presenterObligations.get(inst.slotId)?.some(o => o.advId === candidateAdv);
      if (presenterConflict) break;

      removeGene(candidateAdv, inst.slotId);

      const altOptions = ind.instances
        .filter(other => {
          if (other.slotId !== inst.slotId) return false;
          if (other.sessionId === inst.sessionId) return false;
          const rank = preferenceRanks.get(candidateAdv)?.get(other.sessionId) ?? Number.MAX_SAFE_INTEGER;
          const hasSpace =
            other.attendees.length <
            getStrictCapacity(other.roomId, other.sessionId, other.slotId, roomsById, slotsById, sessions);
          return hasSpace && rank !== Number.MAX_SAFE_INTEGER;
        })
        .sort((a, b) => {
          const rankA = preferenceRanks.get(candidateAdv)?.get(a.sessionId) ?? Number.MAX_SAFE_INTEGER;
          const rankB = preferenceRanks.get(candidateAdv)?.get(b.sessionId) ?? Number.MAX_SAFE_INTEGER;
          const spaceA =
            getStrictCapacity(a.roomId, a.sessionId, a.slotId, roomsById, slotsById, sessions) - a.attendees.length;
          const spaceB =
            getStrictCapacity(b.roomId, b.sessionId, b.slotId, roomsById, slotsById, sessions) - b.attendees.length;
          if (rankA !== rankB) return rankA - rankB;
          return spaceB - spaceA;
        });

      const fallback = ind.instances.find(
        other =>
          other.slotId === inst.slotId &&
          other.sessionId !== inst.sessionId &&
          other.attendees.length <
            getStrictCapacity(other.roomId, other.sessionId, other.slotId, roomsById, slotsById, sessions)
      );

      const destination = altOptions[0] ?? fallback;
      if (destination) {
        addGene(candidateAdv, destination);
      }
    }
  });
};

// ===================
// FITNESS
// ===================

const calculateFitness = (
  ind: Individual,
  advisors: Advisor[],
  sessions: Session[],
  roomsById: Map<string, Room>,
  slotsById: Map<number, TimeSlot>
): number => {
  let score = 0;

  ind.stats = {
    mandatoryMetPercent: 0,
    capacityViolations: 0,
    unfilledSlots: 0,
    preferenceMetPercent: 0,
    minSizeViolations: 0,
    duplicatesFound: 0
  };

  let totalMandatoryNeeded = 0;
  let totalMandatoryMet = 0;
  let totalPreferences = 0;
  let metPreferences = 0;
  let filledSlots = 0;

  // Include PLENARY in mandatory checks
  const mandatory = sessions.filter(s => s.type === SessionType.MANDATORY || s.type === SessionType.PLENARY);
  const sessionSlotsCount = Array.from(slotsById.values()).filter(
    s => s.type === SlotType.SESSION
  ).length;

  advisors.forEach(adv => {
    const genes = ind.genome.get(adv.id);
    const attendingIds = new Set<number>();
    
    // Check for duplicates
    if (genes) {
      genes.forEach(g => {
          if (attendingIds.has(g.sessionId)) {
              score += GA_CONFIG.WEIGHTS.DUPLICATE_SESSION;
              ind.stats.duplicatesFound++;
          }
          attendingIds.add(g.sessionId);
      });
      filledSlots += genes.size;
    }

    mandatory.forEach(m => {
      totalMandatoryNeeded++;
      if (attendingIds.has(m.id)) {
        totalMandatoryMet++;
      } else {
        score += GA_CONFIG.WEIGHTS.MANDATORY_MISSING;
      }
    });

    // KPI: Preference Score (Adjusted for max possible slots)
    // Max slots a person can fill is sessionSlotsCount - mandatory.length (approx)
    // But practically, it's just min(preferences.length, slots_attended_elective)
    // Let's keep it simple: matches / total_preferences.
    // IMPROVED: matches / min(preferences.length, available_elective_slots)
    // For now, let's stick to standard percentage but be lenient.
    
    // Better KPI:
    const possibleElectiveSlots = Math.max(0, sessionSlotsCount - mandatory.length);
    const maxMatchable = Math.min(adv.preferences.length, possibleElectiveSlots);
    
    if (maxMatchable > 0) {
        let personalMet = 0;
        adv.preferences.forEach(p => {
            if (attendingIds.has(p)) personalMet++;
        });
        
        // Add to global counter relative to max possible
        metPreferences += personalMet;
        totalPreferences += maxMatchable; // Normalize against what was possible
        
        score += (personalMet * GA_CONFIG.WEIGHTS.PREFERENCE_MET);
    }
  });

  ind.instances.forEach(inst => {
    const cap = getStrictCapacity(
      inst.roomId,
      inst.sessionId,
      inst.slotId,
      roomsById,
      slotsById,
      sessions
    );
    if (inst.attendees.length > cap) {
      const diff = inst.attendees.length - cap;
      ind.stats.capacityViolations += diff;
      score += diff * GA_CONFIG.WEIGHTS.CAPACITY_VIOLATION;
    }
  });

  let actualUnfilled = 0;
  advisors.forEach(adv => {
    const genes = ind.genome.get(adv.id);
    // Speaker logic: if speaker, they are 'busy' but no gene. 
    // We assume masterOptions has speaker constraint handled or we count presenting as filled.
    // For simplicity here, we just count genes. 
    // Ideally we subtract slots where they present.
    
    const presentingCount = sessions.filter(s => 
        s.speaker && s.speaker.toLowerCase().includes(adv.name.toLowerCase())
    ).length; 
    // This is rough, assumes 1 slot per presentation.
    
    const target = Math.max(0, sessionSlotsCount - presentingCount);
    
    if (genes && genes.size < target) {
      actualUnfilled += (target - genes.size);
    }
  });
  
  ind.stats.unfilledSlots = actualUnfilled;
  if (actualUnfilled > 0) {
    score += actualUnfilled * GA_CONFIG.WEIGHTS.UNFILLED_SLOT;
  }

  ind.stats.mandatoryMetPercent =
    totalMandatoryNeeded > 0 ? (totalMandatoryMet / totalMandatoryNeeded) * 100 : 100;
    
  // Adjusted Preference KPI
  ind.stats.preferenceMetPercent =
    totalPreferences > 0 ? (metPreferences / totalPreferences) * 100 : 100;

  ind.fitness = score;
  return score;
};

// ===================
// INSTANCE BUILDER
// ===================

const buildInstancesFromGenome = (
  genome: Genome,
  masterOptions: ScheduledInstance[]
): ScheduledInstance[] => {
  const instances = masterOptions.map(m => ({
    ...m,
    attendees: [] as number[]
  }));

  genome.forEach((slotMap, advId) => {
    slotMap.forEach(gene => {
      const inst = instances.find(
        i =>
          i.sessionId === gene.sessionId &&
          i.slotId === gene.slotId &&
          i.roomId === gene.roomId
      );
      if (inst) {
        inst.attendees.push(advId);
      }
    });
  });

  return instances;
};

// ===================
// RANDOM INDIVIDUAL
// ===================

const createRandomIndividual = (
  advisors: Advisor[],
  masterOptions: ScheduledInstance[],
  sessions: Session[],
  slotsById: Map<number, TimeSlot>,
  presenterObligations: Map<number, PresenterObligation[]>,
  roomsById: Map<string, Room>
): Individual => {
  const genome: Genome = new Map();
  const sessionSlots = Array.from(slotsById.values())
    .filter(s => s.type === SlotType.SESSION)
    .map(s => s.id);

  const mandatorySessions = sessions.filter(
    s => s.type === SessionType.MANDATORY || s.type === SessionType.PLENARY
  );

  const instanceKey = (inst: ScheduledInstance) => `${inst.sessionId}-${inst.slotId}-${inst.roomId}`;
  const occupancy = new Map<string, number>();

  const canFit = (inst: ScheduledInstance) => {
    const cap = getStrictCapacity(
      inst.roomId,
      inst.sessionId,
      inst.slotId,
      roomsById,
      slotsById,
      sessions
    );
    return (occupancy.get(instanceKey(inst)) ?? 0) < cap;
  };

  const reserve = (advId: number, inst: ScheduledInstance, advGenes: Map<number, Gene>) => {
    if (!canFit(inst)) return false;
    advGenes.set(inst.slotId, {
      sessionId: inst.sessionId,
      slotId: inst.slotId,
      roomId: inst.roomId
    });
    occupancy.set(instanceKey(inst), (occupancy.get(instanceKey(inst)) ?? 0) + 1);
    return true;
  };

  const obligationsByAdvisor = new Map<number, PresenterObligation[]>();
  presenterObligations.forEach(list => {
    list.forEach(ob => {
      const existing = obligationsByAdvisor.get(ob.advId) ?? [];
      existing.push(ob);
      obligationsByAdvisor.set(ob.advId, existing);
    });
  });

  advisors.forEach(adv => {
    const advGenes = new Map<number, Gene>();
    const pickedSessions = new Set<number>();
    const preferenceRank = new Map<number, number>();
    adv.preferences.forEach((p, idx) => preferenceRank.set(p, idx));

    const advObligations = obligationsByAdvisor.get(adv.id) ?? [];
    advObligations.forEach(ob => {
      advGenes.set(ob.slotId, {
        sessionId: ob.sessionId,
        slotId: ob.slotId,
        roomId: ob.roomId
      });
      pickedSessions.add(ob.sessionId);
      occupancy.set(`${ob.sessionId}-${ob.slotId}-${ob.roomId}`, (occupancy.get(`${ob.sessionId}-${ob.slotId}-${ob.roomId}`) ?? 0) + 1);
    });

    // Reserve mandatory and plenary sessions first
    mandatorySessions.forEach(ms => {
      if (pickedSessions.has(ms.id)) return;
      const instances = masterOptions
        .filter(i => i.sessionId === ms.id && !advGenes.has(i.slotId))
        .sort((a, b) => a.slotId - b.slotId);

      if (instances.length > 0) {
        const inst = instances.find(i => canFit(i)) ?? instances[0];
        if (reserve(adv.id, inst, advGenes)) {
          pickedSessions.add(inst.sessionId);
        }
      }
    });

    sessionSlots.forEach(slotId => {
      if (advGenes.has(slotId)) return;
      const options = masterOptions
        .filter(i => i.slotId === slotId && !pickedSessions.has(i.sessionId))
        .sort((a, b) => {
          const rankA = preferenceRank.has(a.sessionId)
            ? preferenceRank.get(a.sessionId)!
            : Number.MAX_SAFE_INTEGER;
          const rankB = preferenceRank.has(b.sessionId)
            ? preferenceRank.get(b.sessionId)!
            : Number.MAX_SAFE_INTEGER;
          return rankA - rankB;
        });

      if (options.length === 0) return;

      const topPreference = options[0];
      const isSpeaker = sessions.some(
        s =>
          s.speaker &&
          s.speaker.toLowerCase().includes(adv.name.toLowerCase()) &&
          s.id === topPreference.sessionId
      );

      if (!isSpeaker) {
        if (reserve(adv.id, topPreference, advGenes)) {
          pickedSessions.add(topPreference.sessionId);
        } else {
          const alt = options.find(o => canFit(o));
          if (alt && reserve(adv.id, alt, advGenes)) {
            pickedSessions.add(alt.sessionId);
          }
        }
      }
    });

    genome.set(adv.id, advGenes);
  });

  const instances = buildInstancesFromGenome(genome, masterOptions);
  return { genome, fitness: 0, stats: {}, instances };
};

// ===================
// CROSSOVER
// ===================

const crossoverIndividuals = (
  p1: Individual,
  p2: Individual,
  advisors: Advisor[],
  masterOptions: ScheduledInstance[]
): Individual => {
  const childGenome: Genome = new Map();

  advisors.forEach(adv => {
    const g1 = p1.genome.get(adv.id);
    const g2 = p2.genome.get(adv.id);

    const childMap = new Map<number, Gene>();
    const allSlots = new Set<number>();

    if (g1) g1.forEach((_, slotId) => allSlots.add(slotId));
    if (g2) g2.forEach((_, slotId) => allSlots.add(slotId));

    allSlots.forEach(slotId => {
      const gene1 = g1?.get(slotId);
      const gene2 = g2?.get(slotId);

      let chosen: Gene | undefined;
      const r = Math.random();

      if (gene1 && gene2) {
        chosen = r < 0.5 ? gene1 : gene2;
      } else if (gene1 || gene2) {
        chosen = gene1 ?? gene2!;
      } else {
        chosen = undefined;
      }

      if (chosen) {
        childMap.set(slotId, { ...chosen });
      }
    });

    childGenome.set(adv.id, childMap);
  });

  const childInstances = buildInstancesFromGenome(childGenome, masterOptions);
  return { genome: childGenome, instances: childInstances, fitness: 0, stats: {} };
};

// ===================
// SMART MUTATION
// ===================

const mutateIndividual = (
  ind: Individual,
  advisors: Advisor[],
  sessions: Session[],
  roomsById: Map<string, Room>,
  slotsById: Map<number, TimeSlot>,
  masterOptions: ScheduledInstance[],
  mutationRate: number,
  presenterObligations: Map<number, PresenterObligation[]>
) => {
  if (Math.random() > mutationRate) {
    enforcePresenterObligations(ind, presenterObligations, masterOptions);
    return;
  }

  calculateFitness(ind, advisors, sessions, roomsById, slotsById);

  const overfullInstances = ind.instances.filter(inst => {
    const cap = getStrictCapacity(
      inst.roomId,
      inst.sessionId,
      inst.slotId,
      roomsById,
      slotsById,
      sessions
    );
    return inst.attendees.length > cap;
  });

  const sessionSlots = Array.from(slotsById.values())
    .filter(s => s.type === SlotType.SESSION)
    .map(s => s.id);

  const hasMandatoryProblem = ind.stats.mandatoryMetPercent < 100;
  const hasCapacityProblem = overfullInstances.length > 0;
  const hasUnfilledSlots = ind.stats.unfilledSlots > 0;

  const mutationChoice: MutationMode = hasMandatoryProblem
    ? 'MANDATORY_FIX'
    : hasCapacityProblem
    ? 'CAPACITY_FIX'
    : hasUnfilledSlots
    ? 'FILL_SLOT'
    : 'RANDOM_SWAP';

  switch (mutationChoice) {
    case 'MANDATORY_FIX': {
      const mandatorySessions = sessions.filter(s => s.type === SessionType.MANDATORY || s.type === SessionType.PLENARY);
      const rndAdv = advisors[Math.floor(Math.random() * advisors.length)];
      const genes = ind.genome.get(rndAdv.id);
      if (!genes) break;

      const attending = new Set(Array.from(genes.values()).map(g => g.sessionId));
      const missing = mandatorySessions.filter(m => !attending.has(m.id));
      if (missing.length === 0) break;

      const target = missing[Math.floor(Math.random() * missing.length)];
      const instances = ind.instances.filter(i => i.sessionId === target.id);
      if (instances.length === 0) break;

      const chosenInst = instances[Math.floor(Math.random() * instances.length)];

      genes.set(chosenInst.slotId, {
        sessionId: chosenInst.sessionId,
        roomId: chosenInst.roomId,
        slotId: chosenInst.slotId
      });
      chosenInst.attendees.push(rndAdv.id);
      break;
    }

    case 'CAPACITY_FIX': {
      const inst = overfullInstances[Math.floor(Math.random() * overfullInstances.length)];
      const advId = inst.attendees[Math.floor(Math.random() * inst.attendees.length)];
      const genes = ind.genome.get(advId);
      if (!genes) break;

      genes.delete(inst.slotId);
      inst.attendees = inst.attendees.filter(a => a !== advId);

      const altOptions = ind.instances.filter(i => i.slotId === inst.slotId);
      const feasible = altOptions.filter(o => {
        const cap = getStrictCapacity(
          o.roomId,
          o.sessionId,
          o.slotId,
          roomsById,
          slotsById,
          sessions
        );
        return o.attendees.length < cap;
      });

      if (feasible.length > 0) {
        const choice = feasible[Math.floor(Math.random() * feasible.length)];
        genes.set(choice.slotId, {
          sessionId: choice.sessionId,
          roomId: choice.roomId,
          slotId: choice.slotId
        });
        choice.attendees.push(advId);
      }
      break;
    }

    case 'FILL_SLOT': {
      const adv = advisors[Math.floor(Math.random() * advisors.length)];
      const genes = ind.genome.get(adv.id);
      if (!genes) break;

      const emptySlots = sessionSlots.filter(sid => !genes.has(sid));
      if (emptySlots.length === 0) break;

      const slotId = emptySlots[Math.floor(Math.random() * emptySlots.length)];
      const options = ind.instances.filter(i => i.slotId === slotId);

      const feasible = options.filter(o => {
        const cap = getStrictCapacity(
          o.roomId,
          o.sessionId,
          o.slotId,
          roomsById,
          slotsById,
          sessions
        );
        return o.attendees.length < cap;
      });

      if (feasible.length === 0) break;

      const pref = feasible.find(o => adv.preferences.includes(o.sessionId));
      const choice = pref || feasible[Math.floor(Math.random() * feasible.length)];

      genes.set(slotId, {
        sessionId: choice.sessionId,
        roomId: choice.roomId,
        slotId: choice.slotId
      });
      choice.attendees.push(adv.id);
      break;
    }

    case 'RANDOM_SWAP': {
      const slotId = sessionSlots[Math.floor(Math.random() * sessionSlots.length)];
      const adv1 = advisors[Math.floor(Math.random() * advisors.length)];
      const adv2 = advisors[Math.floor(Math.random() * advisors.length)];
      if (adv1.id === adv2.id) break;

      const g1 = ind.genome.get(adv1.id);
      const g2 = ind.genome.get(adv2.id);
      if (!g1 || !g2) break;

      const gene1 = g1.get(slotId);
      const gene2 = g2.get(slotId);
      if (!gene1 && !gene2) break;

      if (gene2) {
        g1.set(slotId, { ...gene2 });
      } else {
        g1.delete(slotId);
      }

      if (gene1) {
        g2.set(slotId, { ...gene1 });
      } else {
        g2.delete(slotId);
      }
      break;
    }
  }

  enforcePresenterObligations(ind, presenterObligations, masterOptions);
};

// ===================
// LOCAL SEARCH (MEMETIC STEP)
// ===================

const localSearch = (
  ind: Individual,
  advisors: Advisor[],
  sessions: Session[],
  masterOptions: ScheduledInstance[],
  roomsById: Map<string, Room>,
  slotsById: Map<number, TimeSlot>,
  presenterObligations: Map<number, PresenterObligation[]>
) => {
  refineScheduleWithBulldozer(ind, advisors, sessions, masterOptions, roomsById, slotsById, presenterObligations);
  calculateFitness(ind, advisors, sessions, roomsById, slotsById);
};

const isPerfectSchedule = (stats: any) => {
  if (!stats) return false;
  return (
    stats.mandatoryMetPercent === 100 &&
    stats.unfilledSlots === 0 &&
    stats.capacityViolations === 0 &&
    stats.duplicatesFound === 0
  );
};

const selectParent = (population: Individual[]): Individual => {
  const TOURNAMENT_SIZE = 4;
  let champion = population[Math.floor(Math.random() * Math.min(population.length, GA_CONFIG.POPULATION_SIZE / 2))];

  for (let i = 1; i < TOURNAMENT_SIZE; i++) {
    const contender = population[Math.floor(Math.random() * population.length)];
    if (contender.fitness > champion.fitness) {
      champion = contender;
    }
  }

  return champion;
};

// ===================
// GENETIC ALGORITHM CORE
// ===================

export const solveSchedule = async (
  advisors: Advisor[],
  sessions: Session[],
  timeSlots: TimeSlot[],
  rooms: Room[],
  fixedInstances: Partial<ScheduledInstance>[],
  onProgress?: ProgressCallback
): Promise<ScheduleResult> => {
  const roomsById = new Map(rooms.map(r => [r.id, r]));
  const slotsById = new Map(timeSlots.map(s => [s.id, s]));

  // 1. Generate Master Schedule
  const masterOptions = generateSmartMasterOptions(
    sessions,
    rooms,
    timeSlots,
    fixedInstances,
    roomsById,
    slotsById,
    advisors
  );

  const presenterObligations = buildPresenterObligations(sessions, advisors, masterOptions);

  // 2. Initialize Population
  let population: Individual[] = [];
  for (let i = 0; i < GA_CONFIG.POPULATION_SIZE; i++) {
    const ind = createRandomIndividual(
      advisors,
      masterOptions,
      sessions,
      slotsById,
      presenterObligations,
      roomsById
    );
    calculateFitness(ind, advisors, sessions, roomsById, slotsById);
    population.push(ind);
  }

  const startTime = Date.now();
  let generation = 0;

  let currentMutationRate = GA_CONFIG.MUTATION_RATE;
  let lastBestFitness = -Infinity;
  let stagnationCounter = 0;

  const TOP_K_LOCAL_SEARCH = 8;

  while (
    generation < GA_CONFIG.MAX_GENERATIONS &&
    Date.now() - startTime < GA_CONFIG.TIME_LIMIT_MS
  ) {
    population.sort((a, b) => b.fitness - a.fitness);

    for (let i = 0; i < Math.min(TOP_K_LOCAL_SEARCH, population.length); i++) {
      localSearch(population[i], advisors, sessions, masterOptions, roomsById, slotsById, presenterObligations);
    }

    population.sort((a, b) => b.fitness - a.fitness);

    if (isPerfectSchedule(population[0].stats)) {
      break;
    }

    if (population[0].fitness <= lastBestFitness) {
      stagnationCounter++;
    } else {
      stagnationCounter = 0;
      lastBestFitness = population[0].fitness;
    }

    if (stagnationCounter > 20) {
      currentMutationRate = Math.min(0.5, currentMutationRate * 1.5);
    } else {
      currentMutationRate = GA_CONFIG.MUTATION_RATE;
    }

    if (generation % 10 === 0 && onProgress) {
      onProgress({
        iteration: generation,
        maxIterations: GA_CONFIG.MAX_GENERATIONS,
        stats: population[0].stats
      });
      await new Promise(r => setTimeout(r, 0));
    }

    const newPop: Individual[] = population.slice(0, GA_CONFIG.ELITISM_COUNT);

    while (newPop.length < GA_CONFIG.POPULATION_SIZE) {
      const p1 = selectParent(population);
      const p2 = selectParent(population);

      let child = crossoverIndividuals(p1, p2, advisors, masterOptions);

      mutateIndividual(
        child,
        advisors,
        sessions,
        roomsById,
        slotsById,
        masterOptions,
        currentMutationRate,
        presenterObligations
      );

      calculateFitness(child, advisors, sessions, roomsById, slotsById);
      newPop.push(child);
    }

    population = newPop;
    generation++;
  }

  population.sort((a, b) => b.fitness - a.fitness);
  const best = population[0];

  // STRICT REPAIR LOOP: Run until mandatory is 100% and missing is 0
  let repairAttempts = 0;
  const SAFE_BREAK_LIMIT = 200; 

  while (
    repairAttempts < SAFE_BREAK_LIMIT &&
    (best.stats.mandatoryMetPercent < 100 || best.stats.unfilledSlots > 0 || best.stats.capacityViolations > 0)
  ) {
    refineScheduleWithBulldozer(best, advisors, sessions, masterOptions, roomsById, slotsById, presenterObligations);
    calculateFitness(best, advisors, sessions, roomsById, slotsById);

    if (onProgress && repairAttempts % 5 === 0) {
      onProgress({
        iteration: GA_CONFIG.MAX_GENERATIONS + repairAttempts,
        maxIterations: GA_CONFIG.MAX_GENERATIONS + SAFE_BREAK_LIMIT,
        stats: best.stats
      });
      await new Promise(r => setTimeout(r, 0));
    }

    repairAttempts++;
  }

  return {
    instances: best.instances,
    advisors,
    fitness: best.fitness,
    stats: best.stats
  };
};
