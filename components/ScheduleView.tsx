import React, { useState } from 'react';
import { ScheduledInstance, SlotType, TimeSlot, SessionType, Session, Room } from '../types';

interface Props {
  schedule: ScheduledInstance[];
  selectedAdvisorId: number | null;
  sessions: Session[];
  timeSlots: TimeSlot[];
  rooms: Room[];
}

const ScheduleView: React.FC<Props> = ({ schedule, selectedAdvisorId, sessions, timeSlots, rooms }) => {
  const [activeTab, setActiveTab] = useState<'TIMELINE' | 'ROOMS'>('TIMELINE');
  
  const getSessionDetails = (sid: number) => sessions.find(s => s.id === sid);
  const getRoomDetails = (rid: string) => rooms.find(r => r.id === rid);

  const renderTimelineSlot = (slot: TimeSlot) => {
    // Handle Breaks/Meals/Other differently
    if (slot.type !== SlotType.SESSION) {
      let bgColor = 'bg-gray-100';
      if (slot.type === SlotType.MEAL) bgColor = 'bg-orange-50 border-orange-100 text-orange-800';
      if (slot.type === SlotType.BREAK) bgColor = 'bg-blue-50 border-blue-100 text-blue-800';
      if (slot.type === SlotType.OTHER) bgColor = 'bg-purple-50 border-purple-100 text-purple-800';

      return (
        <div key={slot.id} className={`p-3 border-b border-gray-200 flex items-center justify-between ${bgColor}`}>
          <div className="flex items-center gap-4">
             <span className="font-mono text-sm font-bold opacity-70 w-32">{slot.label}</span>
             <span className="font-bold text-sm uppercase tracking-wider">{slot.title}</span>
          </div>
          <span className="text-xs uppercase opacity-60 font-semibold">{slot.type}</span>
        </div>
      );
    }

    // Find sessions happening in this slot
    const instancesInSlot = schedule.filter(i => i.slotId === slot.id);

    // If filtering by advisor, only show their session
    const userInstance = selectedAdvisorId 
      ? instancesInSlot.find(i => i.attendees.includes(selectedAdvisorId))
      : null;

    if (selectedAdvisorId && !userInstance) {
      return (
        <div key={slot.id} className="border-b border-gray-100 p-4 bg-white flex items-center">
           <div className="w-32 flex-shrink-0 font-bold text-gray-700 text-sm">{slot.label}</div>
           <div className="text-gray-400 italic text-sm">Geen sessie (Vrije tijd)</div>
        </div>
      );
    }

    const instancesToShow = userInstance ? [userInstance] : instancesInSlot;

    return (
      <div key={slot.id} className="border-b border-gray-200 p-4 hover:bg-gray-50 transition-colors bg-white">
        <div className="flex items-start">
          <div className="w-32 flex-shrink-0 pt-1">
            <span className="font-bold text-gray-700 text-sm block">{slot.label}</span>
            <span className="text-xs text-gray-500 uppercase">{slot.day === 1 ? 'Woensdag' : 'Donderdag'}</span>
          </div>
          
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {instancesToShow.map(inst => {
              const session = getSessionDetails(inst.sessionId);
              const room = getRoomDetails(inst.roomId);
              if (!session) return null;

              // Color coding
              let typeClass = "border-l-4 pl-3 py-2 shadow-sm bg-white rounded border border-gray-100";
              if (session.type === SessionType.PLENARY) typeClass += " border-l-gray-800 bg-gray-50";
              else if (session.type === SessionType.MANDATORY) typeClass += " border-l-agriGreen bg-green-50/30";
              else typeClass += " border-l-agriYellow bg-yellow-50/30";

              return (
                <div key={inst.instanceId} className={typeClass}>
                  <div className="flex justify-between items-start">
                    <h4 className="font-semibold text-sm text-gray-800 leading-tight">{session.id}. {session.title}</h4>
                    {selectedAdvisorId && <span className="text-[10px] bg-blue-100 text-blue-800 px-1 rounded ml-1">Aanwezig</span>}
                  </div>
                  <p className="text-xs text-gray-600 mt-1 truncate">{session.speaker}</p>
                  <div className="flex justify-between mt-2 text-xs text-gray-500 font-mono">
                    <span>📍 {room?.name}</span>
                    <span>👥 {inst.attendees.length}/{room?.capacity}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderRoomView = () => {
      return (
          <div className="grid grid-cols-1 gap-6 p-4">
              {rooms.map(room => (
                  <div key={room.id} className="bg-white rounded border border-gray-200 shadow-sm overflow-hidden">
                      <div className="bg-gray-100 px-4 py-2 font-bold text-gray-800 border-b border-gray-200 flex justify-between">
                          <span>{room.name}</span>
                          <span className="text-xs bg-white px-2 py-1 rounded text-gray-500">Cap: {room.capacity}</span>
                      </div>
                      <div className="divide-y divide-gray-100">
                          {timeSlots.filter(ts => ts.type === SlotType.SESSION).map(slot => {
                              const instance = schedule.find(i => i.roomId === room.id && i.slotId === slot.id);
                              if (!instance) return null;

                              const session = getSessionDetails(instance.sessionId);
                              if (!session) return null;

                              return (
                                  <div key={slot.id} className="px-4 py-3 flex gap-4 items-center hover:bg-gray-50">
                                      <div className="w-24 flex-shrink-0 text-xs font-bold text-gray-500">
                                          {slot.label}<br/>
                                          <span className="font-normal opacity-75">Dag {slot.day}</span>
                                      </div>
                                      <div className="flex-1">
                                          <div className="text-sm font-semibold text-agriGreen">{session.title}</div>
                                          <div className="text-xs text-gray-600">{session.speaker}</div>
                                      </div>
                                      <div className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                                          {instance.attendees.length} pax
                                      </div>
                                  </div>
                              );
                          })}
                          {/* If no sessions found for this room at all */}
                          {timeSlots.filter(ts => ts.type === SlotType.SESSION).every(slot => !schedule.find(i => i.roomId === room.id && i.slotId === slot.id)) && (
                              <div className="p-4 text-center text-gray-400 italic text-sm">Geen sessies ingepland in deze zaal.</div>
                          )}
                      </div>
                  </div>
              ))}
          </div>
      );
  };

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
      <div className="bg-gray-100 px-4 py-3 border-b border-gray-200 font-bold text-gray-700 flex justify-between items-center">
        <span>{selectedAdvisorId ? `Rooster voor Adviseur ${selectedAdvisorId}` : 'Planning'}</span>
        
        {/* Tabs */}
        {!selectedAdvisorId && (
            <div className="flex bg-gray-200 rounded-lg p-1 gap-1">
                <button 
                    onClick={() => setActiveTab('TIMELINE')}
                    className={`px-3 py-1 rounded text-xs font-bold transition-all ${activeTab === 'TIMELINE' ? 'bg-white text-agriGreen shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    Tijdlijn
                </button>
                <button 
                    onClick={() => setActiveTab('ROOMS')}
                    className={`px-3 py-1 rounded text-xs font-bold transition-all ${activeTab === 'ROOMS' ? 'bg-white text-agriGreen shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    Zaalindeling
                </button>
            </div>
        )}

        <span className="text-xs font-normal text-gray-500 bg-gray-200 px-2 py-1 rounded hidden md:inline-block">2 Dagen • {timeSlots.length} Blokken</span>
      </div>
      
      {activeTab === 'TIMELINE' || selectedAdvisorId ? (
          <div className="divide-y divide-gray-100">
            {timeSlots.map(slot => renderTimelineSlot(slot))}
          </div>
      ) : (
          renderRoomView()
      )}
    </div>
  );
};

export default ScheduleView;