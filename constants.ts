import { Room, SlotType, TimeSlot } from './types';

// Based on PDF Page 1 & 2
export const ROOMS: Room[] = [
  { id: 'kinderdijk', name: 'Kinderdijk', capacity: 27 },
  { id: 'haagse', name: 'Haagse Schouw', capacity: 27 },
  { id: 'princeville', name: 'Princeville', capacity: 27 },
  { id: 'witte', name: 'De Witte', capacity: 27 },
  { id: 'leeuw2', name: 'Gouden Leeuw 2', capacity: 45 },
  { id: 'leeuw3', name: 'Gouden Leeuw 3', capacity: 35 },
  { id: 'molenhoek', name: 'Molenhoek (Plenair)', capacity: 200 }, // Unlimited
];

// Full Schedule based on PDF screenshots (Page 1 of PDF 2 and Page 3 of PDF 2)
export const TIME_SLOTS: TimeSlot[] = [
  // --- Day 1 (Wednesday 3 Dec) ---
  { id: 1, day: 1, label: "08.00 - 08.10", type: SlotType.OTHER, title: "Welkom" },
  { id: 2, day: 1, label: "08.15 - 09.15", type: SlotType.SESSION }, // Lezing 1
  { id: 3, day: 1, label: "09.15 - 09.30", type: SlotType.BREAK, title: "Pauze" },
  { id: 4, day: 1, label: "09.30 - 10.15", type: SlotType.SESSION }, // Lezing 2
  { id: 5, day: 1, label: "10.15 - 10.30", type: SlotType.BREAK, title: "Pauze" },
  { id: 6, day: 1, label: "10.30 - 11.15", type: SlotType.SESSION }, // Lezing 3
  { id: 7, day: 1, label: "11.15 - 11.30", type: SlotType.BREAK, title: "Pauze" },
  { id: 8, day: 1, label: "11.30 - 12.15", type: SlotType.SESSION }, // Lezing 4
  { id: 9, day: 1, label: "12.15 - 13.15", type: SlotType.MEAL, title: "Lunch" },
  { id: 10, day: 1, label: "13.15 - 14.00", type: SlotType.SESSION }, // Lezing 5
  { id: 11, day: 1, label: "14.00 - 14.15", type: SlotType.BREAK, title: "Pauze" },
  { id: 12, day: 1, label: "14.15 - 15.00", type: SlotType.SESSION }, // Lezing 6
  { id: 13, day: 1, label: "15.00 - 15.15", type: SlotType.BREAK, title: "Pauze" },
  { id: 14, day: 1, label: "15.15 - 16.00", type: SlotType.SESSION }, // Lezing 7
  { id: 15, day: 1, label: "16.00 - 16.15", type: SlotType.BREAK, title: "Pauze" },
  { id: 16, day: 1, label: "16.15 - 17.00", type: SlotType.SESSION }, // Lezing 8
  { id: 17, day: 1, label: "17.00 - 17.45", type: SlotType.MEAL, title: "Aperitief" },
  { id: 18, day: 1, label: "17.45 - 19.15", type: SlotType.MEAL, title: "Dinerbuffet" },
  { id: 19, day: 1, label: "20.00 - 21.15", type: SlotType.OTHER, title: "Avondprogramma" },
  { id: 20, day: 1, label: "21.15 - 01.00", type: SlotType.OTHER, title: "Bar Businessfoyer" },

  // --- Day 2 (Thursday 4 Dec) ---
  { id: 21, day: 2, label: "07.00 - 08.00", type: SlotType.MEAL, title: "Ontbijt" },
  { id: 22, day: 2, label: "08.00 - 08.10", type: SlotType.OTHER, title: "Plenaire start in zaal Molenhoek" },
  { id: 23, day: 2, label: "08.10 - 08.15", type: SlotType.OTHER, title: "Deelnemers naar zaal" },
  { id: 24, day: 2, label: "08.15 - 09.15", type: SlotType.SESSION }, // Lezing 1
  { id: 25, day: 2, label: "09.15 - 09.30", type: SlotType.BREAK, title: "Pauze" },
  { id: 26, day: 2, label: "09.30 - 10.15", type: SlotType.SESSION }, // Lezing 2
  { id: 27, day: 2, label: "10.15 - 10.30", type: SlotType.BREAK, title: "Pauze" },
  { id: 28, day: 2, label: "10.30 - 11.15", type: SlotType.SESSION }, // Lezing 3
  { id: 29, day: 2, label: "11.15 - 11.30", type: SlotType.BREAK, title: "Pauze" },
  { id: 30, day: 2, label: "11.30 - 12.15", type: SlotType.SESSION }, // Lezing 4
  { id: 31, day: 2, label: "12.15 - 13.15", type: SlotType.MEAL, title: "Lunch" },
  { id: 32, day: 2, label: "13.15 - 14.00", type: SlotType.SESSION }, // Lezing 5
  { id: 33, day: 2, label: "14.00 - 14.15", type: SlotType.BREAK, title: "Pauze" },
  { id: 34, day: 2, label: "14.15 - 15.00", type: SlotType.SESSION }, // Lezing 6
  { id: 35, day: 2, label: "15.00 - 15.15", type: SlotType.BREAK, title: "Pauze" },
  { id: 36, day: 2, label: "15.15 - 16.00", type: SlotType.SESSION }, // Lezing 7
  { id: 37, day: 2, label: "16.00 - 16.15", type: SlotType.BREAK, title: "Pauze" },
  { id: 38, day: 2, label: "16.15 - 17.00", type: SlotType.SESSION }, // Lezing 8
  { id: 39, day: 2, label: "17.15 - 18.30", type: SlotType.MEAL, title: "Dinerbuffet" },
  { id: 40, day: 2, label: "18.30", type: SlotType.OTHER, title: "Vertrek" },
];