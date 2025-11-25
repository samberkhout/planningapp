import { ScheduleResult, Session, TimeSlot, Room, SlotType } from '../types';
import { ROOMS } from '../constants';
import { generatePresentation } from './presentationService';

declare global {
  interface Window {
    jspdf: any;
    JSZip: any;
    saveAs: any;
    XLSX: any;
  }
}

const generateExcelChecklist = (
  result: ScheduleResult,
  sessions: Session[],
  timeSlots: TimeSlot[]
) => {
  const XLSX = window.XLSX;
  
  // Filter for Session Slots only
  const sessionSlots = timeSlots.filter(ts => ts.type === SlotType.SESSION);

  // Headers: ID, Name, then all Timestamps
  const headers = ['ID', 'Naam', ...sessionSlots.map(s => `${s.label} (Dag ${s.day})`)];
  const data: any[][] = [headers];

  // Helper to find if advisor is presenting
  const getPresenterDuty = (advisorName: string, sessionList: Session[]) => {
     return sessionList.filter(s => s.speaker && s.speaker.toLowerCase().includes(advisorName.toLowerCase()));
  };

  result.advisors.forEach(advisor => {
      const row = [advisor.id, advisor.name];
      
      // Find all sessions they are presenting (Speaker)
      const presentingSessions = getPresenterDuty(advisor.name, sessions);

      sessionSlots.forEach(slot => {
          // Check if they are attending a session
          const instance = result.instances.find(i => i.slotId === slot.id && i.attendees.includes(advisor.id));
          
          if (instance) {
              const session = sessions.find(s => s.id === instance.sessionId);
              row.push(session ? `${session.id}. ${session.title}` : 'ERROR');
          } else {
              // Check if they are PRESENTING in this slot
              // We need to find a session where they are the speaker, AND that session is scheduled in this slot
              // Note: We need to look at the master schedule to see when their speaking session is actually scheduled.
              
              // 1. Find sessions they speak at
              const mySpeakingSessionIds = presentingSessions.map(s => s.id);
              // 2. Find when those sessions are happening
              const speakingInstance = result.instances.find(i => i.slotId === slot.id && mySpeakingSessionIds.includes(i.sessionId));

              if (speakingInstance) {
                  const s = sessions.find(s => s.id === speakingInstance.sessionId);
                  const room = ROOMS.find(r => r.id === speakingInstance.roomId);
                  row.push(`ZELF PRESENTEREN: ${s?.title} (${room ? room.name : 'Onbekend'})`);
              } else {
                  // Unassigned / Backup needed - This confirms the "Vraagteken" requirement
                  row.push("??? - HANDMATIG INDELEN");
              }
          }
      });
      data.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(data);
  
  // Basic Column Widths
  const wscols = [{wch: 5}, {wch: 30}];
  sessionSlots.forEach(() => wscols.push({wch: 40}));
  ws['!cols'] = wscols;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Totaaloverzicht");

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
};

export const generateAndDownloadZip = async (
  result: ScheduleResult, 
  sessions: Session[], 
  timeSlots: TimeSlot[]
) => {
  const { jsPDF } = window.jspdf;
  const JSZip = window.JSZip;
  const saveAs = window.saveAs;

  if (!jsPDF || !JSZip || !saveAs) {
    alert("Export libraries not loaded. Please refresh the page.");
    return;
  }

  const zip = new JSZip();
  
  // 1. PDF Folder
  const folder = zip.folder("Planning_Schedules");
  const getSession = (id: number): Session | undefined => sessions.find(s => s.id === id);
  const getRoom = (id: string): Room | undefined => ROOMS.find(r => r.id === id);

  for (const advisor of result.advisors) {
    const doc = new jsPDF();
    
    // --- Header (Page 1 Only) ---
    doc.setFontSize(16);
    doc.setTextColor(0, 128, 55); 
    doc.text("Programma-overzicht lezingen", 14, 20);
    
    doc.setDrawColor(0, 128, 55);
    doc.setLineWidth(0.5);
    doc.line(14, 22, 196, 22);

    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(`Naam: ${advisor.name}`, 14, 30);

    // --- Generate Tables for Each Day ---
    const days = [1, 2];
    days.forEach((day, index) => {
        if (index > 0) doc.addPage();

        const tableRows: any[] = [];
        tableRows.push([{ 
            content: day === 1 ? 'Woensdag 3 december 2025' : 'Donderdag 4 december 2025', 
            colSpan: 5, 
            styles: { fillColor: [220, 220, 220], fontStyle: 'bold', textColor: [50, 50, 50], halign: 'center' } 
        }]);

        const daySlots = timeSlots.filter(ts => ts.day === day);
        
        daySlots.forEach(slot => {
            let rowData = [slot.label, "", "", "", ""];

            if (slot.type === SlotType.SESSION) {
              const instance = result.instances.find(i => 
                  i.slotId === slot.id && i.attendees.includes(advisor.id)
              );
              
              // Check if presenting
              const isPresenting = sessions.filter(s => s.speaker && s.speaker.toLowerCase().includes(advisor.name.toLowerCase()))
                                           .some(s => {
                                              // Is this session scheduled in this slot?
                                              return result.instances.some(i => i.sessionId === s.id && i.slotId === slot.id);
                                           });

              if (instance) {
                  const session = getSession(instance.sessionId);
                  const room = getRoom(instance.roomId);
                  rowData = [
                      slot.label,
                      room ? room.name : "Onbekend",
                      session ? session.id.toString() : "-",
                      session ? session.title : "Fout in schema",
                      session ? session.speaker : "-"
                  ];
              } else if (isPresenting) {
                  const speakingSession = sessions.find(s => s.speaker && s.speaker.toLowerCase().includes(advisor.name.toLowerCase()));
                   // Need exact instance to get room
                  const speakingInstance = result.instances.find(i => i.slotId === slot.id && i.sessionId === speakingSession?.id);
                  const room = speakingInstance ? getRoom(speakingInstance.roomId) : null;
                  
                  rowData = [
                    slot.label, 
                    room ? room.name : "-", 
                    "-", 
                    `ZELF PRESENTEREN: ${speakingSession?.title || ''}`, 
                    "-"
                  ];
              } else {
                  // Changed text to reflect "Back-up" status instead of just "free time"
                  rowData = [slot.label, "-", "-", "Reserve / Back-up (Handmatig indelen)", "-"];
              }
            } else {
              const title = slot.title || "Activiteit";
              rowData = [slot.label, "-", "-", title.toUpperCase(), "-"];
            }
            
            if (slot.type !== SlotType.SESSION) {
               tableRows.push([
                 { content: slot.label, styles: { fillColor: [245, 245, 245] } },
                 { content: "-", styles: { fillColor: [245, 245, 245] } },
                 { content: "-", styles: { fillColor: [245, 245, 245] } },
                 { content: (slot.title || "").toUpperCase(), styles: { fontStyle: 'italic', fillColor: [245, 245, 245] } },
                 { content: "-", styles: { fillColor: [245, 245, 245] } }
               ]);
            } else {
               tableRows.push(rowData);
            }
        });

        const startY = (day === 1) ? 40 : 20;
        doc.autoTable({
            startY: startY,
            head: [['Tijd', 'Zaal', 'Nr', 'Titel / Activiteit', 'Inleider']],
            body: tableRows,
            theme: 'grid',
            headStyles: { fillColor: [0, 128, 55], textColor: 255, fontStyle: 'bold' },
            columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 35 }, 2: { cellWidth: 10 }, 3: { cellWidth: 'auto' }, 4: { cellWidth: 40 } },
            styles: { fontSize: 9, cellPadding: 2, valign: 'middle' },
        });
    });

    const pageCount = doc.internal.getNumberOfPages();
    for(let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(advisor.name, 14, 290);
    }

    const pdfBlob = doc.output('blob');
    folder.file(`${advisor.name.replace(/ /g, '_')}_Schedule.pdf`, pdfBlob);
  }

  // 2. PowerPoint Presentation
  try {
      const pptBlob = await generatePresentation(result, sessions, timeSlots, ROOMS);
      zip.file("Event_Presentation.pptx", pptBlob);
  } catch (e) {
      console.error("PPT Generation failed", e);
  }

  // 3. Excel Checklist
  try {
      const xlsxBuffer = generateExcelChecklist(result, sessions, timeSlots);
      zip.file("Checklist_Overzicht.xlsx", xlsxBuffer);
  } catch (e) {
      console.error("Excel Generation failed", e);
  }

  // Generate and Download Zip
  const content = await zip.generateAsync({ type: "blob" });
  window.saveAs(content, "Agrifirm_Planning_Package.zip");
};
