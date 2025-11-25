import { ScheduleResult, Session, TimeSlot, Room, SlotType, ScheduledInstance } from '../types';

declare global {
  interface Window {
    PptxGenJS: any;
  }
}

export const generatePresentation = async (
  result: ScheduleResult,
  sessions: Session[],
  timeSlots: TimeSlot[],
  rooms: Room[]
): Promise<Blob> => {
  const PptxGenJS = window.PptxGenJS;
  if (!PptxGenJS) throw new Error("PptxGenJS not loaded");

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  // Filter out Molenhoek for the entire presentation
  const displayRooms = rooms.filter(r => r.id !== 'molenhoek');

  // --- Title Slide ---
  const slide1 = pptx.addSlide();
  slide1.background = { color: 'FFFFFF' };
  slide1.addText("Agrifirm Specialisatiedagen 2025", {
    x: 1, y: 2, w: '80%', fontSize: 32, bold: true, color: '008037', align: 'center'
  });
  slide1.addText("Programma & Zaalindeling", {
    x: 1, y: 3, w: '80%', fontSize: 18, color: '666666', align: 'center'
  });

  // --- Helper to get data ---
  const getSession = (id: number) => sessions.find(s => s.id === id);
  const getRoom = (id: string) => rooms.find(r => r.id === id);

  // --- Overview Slides (Per Day) ---
  [1, 2].forEach(day => {
    const slide = pptx.addSlide();
    slide.addText(`Totaaloverzicht - Dag ${day}`, { x: 0.5, y: 0.5, fontSize: 18, bold: true, color: '008037' });

    const rows: any[] = [];
    // Header Row - Use displayRooms (without Molenhoek)
    const headerRow = ['Tijd', ...displayRooms.map(r => r.name)];
    rows.push(headerRow);

    const daySlots = timeSlots.filter(ts => ts.day === day && ts.type === SlotType.SESSION);

    daySlots.forEach(slot => {
      const row = [slot.label];
      displayRooms.forEach(room => {
        const inst = result.instances.find(i => i.slotId === slot.id && i.roomId === room.id);
        if (inst) {
          const s = getSession(inst.sessionId);
          row.push(s ? `${s.id}. ${s.title.substring(0, 30)}...` : '-');
        } else {
          row.push('-');
        }
      });
      rows.push(row);
    });

    slide.addTable(rows, {
      x: 0.2, y: 1.0, w: '96%',
      fontSize: 8,
      border: { pt: 1, color: 'E0E0E0' },
      fill: { color: 'F9F9F9' },
      headerStyles: { fill: '008037', color: 'FFFFFF', bold: true }
    });
  });

  // --- Hourly Detail Slides (For Display Screens) ---
  // Create a slide for every slot, showing what is happening in every room at that specific time.
  const sessionSlots = timeSlots.filter(ts => ts.type === SlotType.SESSION);

  sessionSlots.forEach(slot => {
    const slide = pptx.addSlide();
    
    // Header with Time
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 1.2, fill: '008037' });
    slide.addText(`NU BEZIG: ${slot.label}`, { x: 0.5, y: 0.3, fontSize: 36, bold: true, color: 'FFFFFF' });
    slide.addText(`Dag ${slot.day} - ${slot.title || 'Sessies'}`, { x: 0.5, y: 0.8, fontSize: 14, color: 'FFCC00' });

    // Grid of Rooms
    // We display cards for each room
    let x = 0.5;
    let y = 1.5;
    const w = 4.0;
    const h = 1.8;
    const margin = 0.2;

    const activeInstances = result.instances.filter(i => i.slotId === slot.id);

    // Filter relevant rooms for this slot (only rooms that have something)
    // Or show all rooms to be consistent - using displayRooms to exclude Molenhoek
    const sortedRooms = [...displayRooms].sort((a,b) => b.capacity - a.capacity);

    sortedRooms.forEach((room, index) => {
        const inst = activeInstances.find(i => i.roomId === room.id);
        
        // Calculate Grid Position (2 columns)
        const col = index % 2; 
        const row = Math.floor(index / 2);
        
        const cardX = 0.5 + (col * (4.5 + margin));
        const cardY = 1.5 + (row * (1.2 + margin));

        if (cardY > 6.5) return; // Safety clip

        // Room Name Box
        slide.addShape(pptx.ShapeType.rect, { 
            x: cardX, y: cardY, w: 4.5, h: 1.2, 
            fill: 'FFFFFF', line: { color: 'CCCCCC', width: 1 } 
        });

        // Room Title
        slide.addText(room.name, {
            x: cardX + 0.1, y: cardY + 0.1, w: 4.3, h: 0.3,
            fontSize: 14, bold: true, color: '008037'
        });

        if (inst) {
            const session = getSession(inst.sessionId);
            if (session) {
                // Dynamic font size for long titles
                const titleFontSize = session.title.length > 40 ? 10 : 12;

                // Session Title
                slide.addText(session.title, {
                    x: cardX + 0.1, y: cardY + 0.4, w: 4.3, h: 0.4,
                    fontSize: titleFontSize, bold: true, color: '333333'
                });
                // Speaker
                slide.addText(session.speaker, {
                    x: cardX + 0.1, y: cardY + 0.8, w: 4.3, h: 0.3,
                    fontSize: 10, italic: true, color: '666666'
                });
            }
        } else {
             slide.addText("Geen Sessie", {
                x: cardX + 0.1, y: cardY + 0.5, w: 4.3,
                fontSize: 12, color: '999999', italic: true
            });
        }
    });
  });

  return await pptx.write({ outputType: 'blob' });
};