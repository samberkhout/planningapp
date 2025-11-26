
import { Advisor, Session, SessionType, TimeSlot, SlotType, ScheduledInstance, Room } from '../types';

declare global {
  interface Window {
    XLSX: any;
  }
}

interface ParsedData {
  advisors: Advisor[];
  sessions: Session[];
  timeSlots: TimeSlot[];
  rooms: Room[];
  fixedInstances: Partial<ScheduledInstance>[];
}

// STRICT: Sessions to completely ignore
const IGNORED_SESSION_IDS = [8, 9, 13, 21];
const MANDATORY_IDS = [46, 47, 48, 49, 50, 51];

const normalize = (str: string) => str ? str.toString().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
const cleanStr = (str: string) => str ? str.toString().trim() : '';

// --- HELPER PARSERS ---

const parseRoomsFromSheet = (json: any[]): { rooms: Room[], columnMap: Map<number, string> } => {
    const rooms: Room[] = [];
    const columnMap = new Map<number, string>();
    
    // Scan first 10 rows for room header
    for(let r=0; r<10 && r<json.length; r++) {
        const row = json[r];
        if(!row) continue;
        
        let possibleRooms = 0;
        row.forEach((cell: any, idx: number) => {
            if(!cell) return;
            const str = cell.toString().toLowerCase();
            // Heuristic for room names in header
            if(str.includes('zaal') || str.includes('leeuw') || str.includes('kinderdijk') || str.includes('princeville') || str.includes('haagse') || str.includes('witte') || str.includes('akkerbouw') || str.includes('molenhoek')) {
                possibleRooms++;
            }
        });

        if (possibleRooms >= 3) {
            // Found the header row
            row.forEach((cell: any, idx: number) => {
                if(!cell) return;
                const name = cleanStr(cell);
                // Ignore "tijdstip" or empty
                if (name.toLowerCase().includes('tijd') || name.length < 2) return;

                const id = normalize(name);
                let capacity = 27; // Default
                if (id.includes('leeuw2')) capacity = 45;
                if (id.includes('leeuw3')) capacity = 35;
                if (id.includes('molenhoek')) capacity = 300;
                
                // If room already exists (merged cells), assume same room
                let existing = rooms.find(r => r.id === id);
                if (!existing) {
                    existing = { id, name, capacity };
                    rooms.push(existing);
                }
                columnMap.set(idx, existing.id);
            });
            return { rooms, columnMap };
        }
    }
    
    return { rooms: [], columnMap: new Map() };
};

const parseTimeSlotsFromSheet = (json: any[], day: 1 | 2): TimeSlot[] => {
    const slots: TimeSlot[] = [];
    let slotCounter = day === 1 ? 1 : 20; // Offset IDs to distinguish days
    
    // Regex to find time patterns like "08.00" or "08:00"
    // Matches "08.00", "8.00", "08:00", "8:00"
    const timePattern = /([0-9]{1,2}[\.:][0-9]{2})/i;
    
    for(let r=0; r<json.length; r++) {
        const row = json[r];
        if(!row) continue;

        // Column A and Column B
        const colA = (row[0] || "").toString().trim();
        const colB = (row[1] || "").toString().trim();
        
        let timeStr = "";
        let extraLabel = "";
        let found = false;

        // Scenario 1: Range in Column A (e.g., "08.00 - 08.10")
        const rangeMatch = colA.match(/([0-9]{1,2}[\.:][0-9]{2})\s*-\s*([0-9]{1,2}[\.:][0-9]{2})/);
        if (rangeMatch) {
            timeStr = rangeMatch[0].replace(/:/g, '.');
            extraLabel = colA.replace(rangeMatch[0], '').replace(/[uU]/g, '').trim(); // Remove 'u' suffix
            if (!extraLabel && colB && colB.length > 2) extraLabel = colB;
            found = true;
        } 
        // Scenario 2: Start in A, End in B (e.g., A="08.00", B="08.10")
        else if (colA.match(timePattern) && (colB.match(timePattern) || colA.toLowerCase().includes('uur'))) {
             const startMatch = colA.match(timePattern);
             const endMatch = colB.match(timePattern);
             
             if (startMatch) {
                 const start = startMatch[0].replace(/:/g, '.');
                 // If B is also a time, combine them. If not, maybe A has "08.00 u"
                 let end = "";
                 if (endMatch) {
                     end = endMatch[0].replace(/:/g, '.');
                     // If B was just time, check C for label
                     if (row[2]) extraLabel = row[2].toString();
                 } else {
                     // Maybe it's a single time point event like "17.00 aperitief"
                     // Just use start time
                 }
                 
                 timeStr = end ? `${start} - ${end}` : start;
                 // If we didn't find label in C, check if A or B had text leftovers
                 if (!extraLabel) {
                     extraLabel = colA.replace(timePattern, '').replace(/-/g, '').replace(/[uU]/g, '').trim();
                     if (!extraLabel) extraLabel = colB.replace(timePattern, '').replace(/-/g, '').replace(/[uU]/g, '').trim();
                 }
                 found = true;
             }
        }

        if (found) {
            const content = (colA + " " + colB + " " + (row[2]||"")).toLowerCase();
            
            let type = SlotType.SESSION;
            let title = undefined;
            let label = timeStr;

            if (content.includes('pauze')) {
                type = SlotType.BREAK;
                title = "Pauze";
                label = timeStr + " Pauze";
            } else if (content.includes('lunch') || content.includes('diner') || content.includes('buffet')) {
                type = SlotType.MEAL;
                title = content.includes('lunch') ? "Lunch" : "Diner";
                label = timeStr + " " + title;
            } else if (content.includes('welkom') || content.includes('aperitief') || content.includes('start') || content.includes('programma') || content.includes('borrel') || content.includes('foyer') || content.includes('ontbijt') || content.includes('vertrek')) {
                type = SlotType.OTHER;
                title = extraLabel || "Activiteit";
                if (title.length < 2 && row[2]) title = cleanStr(row[2]); 
                label = timeStr + " " + title;
            } else if (content.includes('lezing') || extraLabel.toLowerCase().includes('lezing')) {
                type = SlotType.SESSION;
                // Clean label
                if (extraLabel) {
                    label = `${timeStr} ${extraLabel}`;
                }
            } else {
                // Fallback for sessions that might just have a number or title in col B/C
                // If we have a valid time range but no "lezing" keyword, assume session if strictly formatted
                if (timeStr.includes('-') && !title) {
                     // Assume session if not explicitly other
                     type = SlotType.SESSION;
                     if (extraLabel) label = `${timeStr} ${extraLabel}`;
                }
            }

            // Avoid duplicates
            if (!slots.some(s => s.label === label)) {
                slots.push({
                    id: slotCounter++,
                    day,
                    label,
                    type,
                    title
                });
            }
        }
    }
    return slots;
};


export const parseExcelFile = async (file: File): Promise<ParsedData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = window.XLSX.read(data, { type: 'array' });
        
        // 1. Sessions (Lezingen 2025)
        let sessions: Session[] = [];
        const sessionSheetName = workbook.SheetNames.find((n: string) => 
            normalize(n).includes('lezing') || normalize(n).includes('sessions')
        );
        if (sessionSheetName) {
           const sheet = workbook.Sheets[sessionSheetName];
           const json = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
           
           // Determine column indices from header row (Row 0)
           let colId = 0;
           let colTitle = 4; // Onderwerp
           let colSpeaker = 2; // Presentator
           let colRepeats = 5; // aantal x
           let colTargetSize = 7; // aantal/zaal
           let colMoment = 8; // moment

           if (json.length > 0) {
             // Try to find the header row. It might not be row 0.
             let headerRowIdx = 0;
             for(let r=0; r<5; r++) {
                 const row = json[r] as string[];
                 if (row && row.some(c => c && c.toString().toLowerCase().includes('onderwerp'))) {
                     headerRowIdx = r;
                     break;
                 }
             }

             const header = json[headerRowIdx] as string[];
             if (header) {
                 header.forEach((h, idx) => {
                     if (!h) return;
                     const txt = h.toString().toLowerCase();
                     if (txt.includes('bedrijf')) colId = idx - 1; // Usually ID is before Bedrijf
                     if (txt.includes('presentator')) colSpeaker = idx;
                     if (txt.includes('onderwerp')) colTitle = idx;
                     if (txt.includes('aantal') && txt.includes('x')) colRepeats = idx;
                     if ((txt.includes('zaal') && txt.includes('aantal')) || txt.includes('inteken')) colTargetSize = idx;
                     if (txt.includes('moment')) colMoment = idx;
                 });
             }
             
             // Fix ID col if header scan failed
             if (colId < 0) colId = 0;

             for (let i = headerRowIdx + 1; i < json.length; i++) {
               const row: any = json[i];
               if (!row || row.length === 0) continue;
               
               const id = parseInt(row[colId]); 
               if (isNaN(id) || IGNORED_SESSION_IDS.includes(id)) continue;
               
               const title = row[colTitle] ? row[colTitle].toString() : `Lezing ${id}`;
               const speaker = row[colSpeaker] ? row[colSpeaker].toString() : "";
               
               let repeats = 0;
               if (row[colRepeats]) repeats = parseInt(row[colRepeats]);
               
               if (MANDATORY_IDS.includes(id)) repeats = 4;
               if (id === 46) repeats = 1; // Plenary is 1x
               
               // Fallback for repeats if missing
               if ((repeats === 0 || isNaN(repeats)) && !MANDATORY_IDS.includes(id) && id !== 46) {
                   // Default to 1 if valid session row
                   repeats = 1; 
               }

               let type = SessionType.ELECTIVE;
               if (id === 46) type = SessionType.PLENARY;
               else if (MANDATORY_IDS.includes(id)) type = SessionType.MANDATORY;

               // Parse Target Size (aantal/zaal)
               let targetSize = 27;
               if (row[colTargetSize]) {
                   const parsed = parseInt(row[colTargetSize]);
                   if (!isNaN(parsed)) targetSize = parsed;
               }

               // Parse Moment Constraints
               let constraints: any = { allowedDays: [], timeOfDay: 'any' };
               if (row[colMoment]) {
                   const m = row[colMoment].toString().toLowerCase();
                   if (m.includes('wo')) constraints.allowedDays.push(1);
                   if (m.includes('do')) constraints.allowedDays.push(2);
                   
                   if (m.includes('ochtend')) constraints.timeOfDay = 'morning';
                   else if (m.includes('middag')) constraints.timeOfDay = 'afternoon';
               }
               if (constraints.allowedDays.length === 0) constraints.allowedDays = [1, 2];

               sessions.push({
                 id,
                 title,
                 speaker,
                 type,
                 repeats,
                 durationMinutes: 45,
                 targetSize,
                 constraints
               });
             }
           }
        }

        // 2. Advisors (Keuze per deelnemer)
        let advisors: Advisor[] = [];
        const advisorSheetName = workbook.SheetNames.find((n: string) => 
            normalize(n).includes('keuze') || normalize(n).includes('deelnemer')
        );
        if (advisorSheetName) {
            const sheet = workbook.Sheets[advisorSheetName];
            const json = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
            
            // Find header for advisors
            let startRow = 1;
            
            for (let i = startRow; i < json.length; i++) {
                const row: any = json[i];
                if (!row || !row[0]) continue;
                const id = parseInt(row[0]);
                const name = row[1];
                if (!name || isNaN(id)) continue;
                const preferences: number[] = [];
                // Preferences start from col 2 usually
                for (let c = 2; c < row.length; c++) {
                    if (row[c]) {
                        const prefId = parseInt(row[c]);
                        if (!isNaN(prefId) && sessions.some(s => s.id === prefId) && !IGNORED_SESSION_IDS.includes(prefId)) {
                            preferences.push(prefId);
                        }
                    }
                }
                const uniquePreferences = Array.from(new Set(preferences));
                advisors.push({ id, name: name.toString(), preferences: uniquePreferences });
            }
        }

        // 3. Program Sheets -> TimeSlots, Rooms, Fixed Instances
        let allTimeSlots: TimeSlot[] = [];
        let allRooms: Room[] = [];
        let fixedInstances: Partial<ScheduledInstance>[] = [];
        const roomMap = new Map<string, Room>(); // dedupe rooms

        // Strict sheet name matching
        const programSheets = workbook.SheetNames.filter((n: string) => 
            (normalize(n).includes('programma') || normalize(n).includes('prog')) &&
            (normalize(n).includes('3') || normalize(n).includes('4') || normalize(n).includes('dec'))
        );

        programSheets.forEach((sheetName: string) => {
            const sheet = workbook.Sheets[sheetName];
            const json = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
            if (json.length < 5) return;

            // Determine Day
            const nameNorm = normalize(sheetName);
            let day: 1 | 2 = 1;
            if (nameNorm.includes('4') || nameNorm.includes('do') || nameNorm.includes('donderdag')) {
                day = 2;
            } else if (nameNorm.includes('3') || nameNorm.includes('wo') || nameNorm.includes('woensdag')) {
                day = 1;
            }

            // Parse TimeSlots
            const sheetSlots = parseTimeSlotsFromSheet(json, day);
            allTimeSlots = [...allTimeSlots, ...sheetSlots];

            // Parse Rooms
            const { rooms: sheetRooms, columnMap } = parseRoomsFromSheet(json);
            
            // Merge rooms
            sheetRooms.forEach(r => {
                if (!roomMap.has(r.id)) {
                    roomMap.set(r.id, r);
                    allRooms.push(r);
                }
            });

            // Scan grid for fixed instances
            // Regex for detecting time rows again to align grid
            const timeRegex = /([0-9]{1,2}[\.:][0-9]{2})/;
            
            for(let r=0; r<json.length; r++) {
                const row: any = json[r];
                if (!row) continue;
                
                const colA = (row[0] || "").toString();
                const match = colA.match(timeRegex);
                
                if (match) {
                    const timeStr = match[0].replace(/:/g, '.');
                    // Find corresponding slot
                    const slot = sheetSlots.find(s => s.label.includes(timeStr));
                    
                    if (slot && slot.type === SlotType.SESSION) {
                        // Iterate columns using columnMap
                        columnMap.forEach((roomId, colIdx) => {
                           // Check current column AND neighbors for merged cell data
                           const candidateCells = [row[colIdx], row[colIdx-1], row[colIdx+1]];
                           
                           let sessId = -1;
                           
                           for (const cellVal of candidateCells) {
                               if (cellVal && sessId === -1) {
                                   const cellStr = cellVal.toString();
                                   // 1. Exact ID match "23"
                                   if (!isNaN(parseInt(cellStr)) && cellStr.length < 4) {
                                       const parsed = parseInt(cellStr);
                                       if (sessions.some(s => s.id === parsed)) {
                                           sessId = parsed;
                                       }
                                   }
                                   // 2. "Lezing 23"
                                   if (sessId === -1 && cellStr.toLowerCase().includes('lezing')) {
                                       const matches = cellStr.match(/lezing\s*(\d+)/i);
                                       if (matches && matches[1]) sessId = parseInt(matches[1]);
                                   }
                                   // 3. Title match
                                   if (sessId === -1) {
                                       const found = sessions.find(s => cellStr.includes(s.title));
                                       if (found) sessId = found.id;
                                   }
                                   
                                   // 4. Special: Plenary
                                   if (sessId === -1 && cellStr.toLowerCase().includes('plenair')) {
                                       sessId = 46;
                                   }
                               }
                           }

                           if (sessId > 0) {
                               // Avoid duplicates for same slot/room
                               const exists = fixedInstances.some(fi => fi.slotId === slot.id && fi.roomId === roomId);
                               if (!exists) {
                                   fixedInstances.push({
                                       sessionId: sessId,
                                       roomId: roomId,
                                       slotId: slot.id
                                   });
                               }
                           }
                        });
                    }
                }
            }
        });

        // Deduplicate slots
        allTimeSlots.sort((a,b) => (a.day*1000 + a.id) - (b.day*1000 + b.id));
        const uniqueSlots: TimeSlot[] = [];
        const seenLabels = new Set();
        allTimeSlots.forEach(s => {
            const key = `${s.day}-${s.label}`;
            if(!seenLabels.has(key)) {
                seenLabels.add(key);
                uniqueSlots.push(s);
            }
        });

        resolve({
          advisors,
          sessions,
          timeSlots: uniqueSlots,
          rooms: allRooms,
          fixedInstances
        });

      } catch (error) {
        reject(error);
      }
    };
    reader.readAsArrayBuffer(file);
  });
};
