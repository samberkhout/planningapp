import { Advisor, Session, SessionType, TimeSlot, SlotType } from '../types';
import { TIME_SLOTS as DEFAULT_SLOTS } from '../constants';

declare global {
  interface Window {
    XLSX: any;
  }
}

interface ParsedData {
  advisors: Advisor[];
  sessions: Session[];
  timeSlots: TimeSlot[];
}

export const parseExcelFile = async (file: File): Promise<ParsedData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = window.XLSX.read(data, { type: 'array' });
        
        // 1. Parse Sessions from "lezingen 2025" (Sheet 3)
        // Expected columns: ID | Company/Speaker | ... | Title | Repeats
        let sessions: Session[] = [];
        const sessionSheetName = workbook.SheetNames.find((n: string) => n.toLowerCase().includes('lezingen'));
        
        if (sessionSheetName) {
          const sheet = workbook.Sheets[sessionSheetName];
          const json = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });
          
          // Skip header row (index 0)
          for (let i = 1; i < json.length; i++) {
            const row: any = json[i];
            if (!row || row.length === 0) continue;

            // Mapping based on "lezingen 2025" structure
            const id = parseInt(row[0]); // Col A
            if (isNaN(id)) continue;

            const company = row[1] || "";
            const speaker = row[2] || company; // Presentator
            // const crop = row[3]; // Gewas
            const title = row[4] || `Lezing ${id}`; // Onderwerp
            const repeatsStr = row[5]; // aantal x
            
            let repeats = 1;
            if (repeatsStr) {
               repeats = parseInt(repeatsStr) || 1;
            }

            // Determine type
            let type = SessionType.ELECTIVE;
            // Check based on known IDs or logic
            if (id === 46) type = SessionType.PLENARY;
            else if ([47, 48, 49, 50, 51].includes(id) || repeats === 4) type = SessionType.MANDATORY;

            // Check if cancelled (colored red in source, but here we might just check if it exists)
            // If the row exists in the excel we assume it's valid unless marked "vervallen"
            
            sessions.push({
              id,
              title,
              speaker,
              type,
              repeats,
              durationMinutes: 45, // Default
              fixedSlot: type === SessionType.PLENARY ? 2 : undefined
            });
          }
        }

        // 2. Parse Advisors from "keuze per deelnemer" (Sheet 4)
        let advisors: Advisor[] = [];
        const advisorSheetName = workbook.SheetNames.find((n: string) => n.toLowerCase().includes('keuze'));
        
        if (advisorSheetName) {
          const sheet = workbook.Sheets[advisorSheetName];
          const json = window.XLSX.utils.sheet_to_json(sheet, { header: 1 });

          // Row 0 is header. Data starts row 1.
          for (let i = 1; i < json.length; i++) {
            const row: any = json[i];
            if (!row || !row[0]) continue;

            const id = parseInt(row[0]);
            const name = row[1];
            const preferences: number[] = [];

            // Preferences in columns C (index 2) through Q (index 16)
            for (let c = 2; c <= 16; c++) {
              if (row[c]) {
                const prefId = parseInt(row[c]);
                if (!isNaN(prefId)) {
                  preferences.push(prefId);
                }
              }
            }

            advisors.push({ id, name, preferences });
          }
        }

        // 3. Program/TimeSlots (Sheet 1 & 2)
        // Since parsing a visual grid is complex and error prone, we will fallback to the DEFAULT_SLOTS
        // but allowing for future extension if the user creates a structured list of times.
        // For now, we return the constants.
        
        if (sessions.length === 0) throw new Error("Geen sessies gevonden in tabblad 'lezingen 2025'");
        if (advisors.length === 0) throw new Error("Geen adviseurs gevonden in tabblad 'keuze per deelnemer'");

        resolve({
          advisors,
          sessions,
          timeSlots: DEFAULT_SLOTS // Using default timeline structure
        });

      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
};