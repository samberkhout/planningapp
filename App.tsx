
import React, { useState } from 'react';
import { solveSchedule, ProgressCallback } from './services/aiSolver';
import { generateAndDownloadZip } from './services/exportService';
import { parseExcelFile } from './services/excelService';
import { Advisor, ScheduleResult, Session, TimeSlot, ScheduledInstance, Room } from './types';
import ScheduleView from './components/ScheduleView';
import StatsCard from './components/StatsCard';

const DefaultLogo = () => (
  <img
    src="/agrifirm-logo.png"
    alt="Agrifirm"
    className="h-10 w-auto"
  />
);


const App: React.FC = () => {
  // State for Data - Start Empty
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [fixedInstances, setFixedInstances] = useState<Partial<ScheduledInstance>[]>([]);
  
  // State for Logic
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedAdvisorId, setSelectedAdvisorId] = useState<number | null>(null);
  const [isFileUploaded, setIsFileUploaded] = useState(false);
  const [uploadError, setUploadError] = useState<string|null>(null);
  const [progress, setProgress] = useState<{ iteration: number, maxIterations: number, stats: any } | null>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploadError(null);
      const data = await parseExcelFile(file);
      setAdvisors(data.advisors);
      setSessions(data.sessions);
      setTimeSlots(data.timeSlots); 
      setRooms(data.rooms);
      if (data.fixedInstances) setFixedInstances(data.fixedInstances);

      setIsFileUploaded(true);
      setResult(null); // Reset previous result
    } catch (e: any) {
      console.error(e);
      setUploadError(e.message || "Fout bij het lezen van het Excel bestand.");
    }
  };

  const handleRunAlgorithm = async () => {
    setIsSolving(true);
    setProgress(null);
    // Allow UI render cycle to show loading state before blocking main thread
    setTimeout(async () => {
      try {
        const solution = await solveSchedule(
            advisors, 
            sessions, 
            timeSlots, 
            rooms, 
            fixedInstances,
            (p) => setProgress(p)
        );
        setResult(solution);
      } catch(e) {
        console.error(e);
      } finally {
        setIsSolving(false);
        setProgress(null);
      }
    }, 100);
  };

  const handleExport = async () => {
    if (!result) return;
    setIsExporting(true);
    try {
      await generateAndDownloadZip(result, sessions, timeSlots, rooms);
    } catch (e) {
      console.error("Export failed", e);
      alert("Failed to generate export.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <DefaultLogo />
            <span className="hidden md:inline-block h-6 w-px bg-gray-300 mx-2"></span>
            <h1 className="text-xl font-medium text-gray-600">Planningstool 2025</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 bg-gray-50 p-4 sm:p-8">
        <div className="max-w-7xl mx-auto space-y-8">

          {/* Intro / Upload State */}
          {!result && !isSolving && (
             <div className="text-center py-10">
               <div className="bg-white p-10 rounded-2xl shadow-sm inline-block max-w-2xl w-full">
                 <div className="w-16 h-16 bg-agriYellow rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">
                   📁
                 </div>
                 <h2 className="text-2xl font-bold text-gray-900 mb-4">Input Data</h2>
                 <p className="text-gray-600 mb-8">
                   Upload het Excel-bestand met de tabbladen: <br/>
                   <em>Programma, Lezingen 2025, Keuze per deelnemer</em>
                 </p>
                 
                 <div className="mb-6">
                    <label className="block w-full cursor-pointer bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-6 hover:bg-gray-100 transition">
                        <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" />
                        <span className="text-agriGreen font-bold">Klik om Excel te uploaden</span>
                    </label>
                 </div>

                 {uploadError && (
                    <div className="bg-red-50 text-red-700 p-3 rounded mb-4 text-sm">
                        ⚠️ {uploadError}
                    </div>
                 )}

                 {isFileUploaded ? (
                    <div className="bg-green-50 text-green-800 p-4 rounded mb-6 text-left text-sm">
                        <p className="font-bold">✅ Bestand succesvol geladen</p>
                        <ul className="list-disc pl-5 mt-2 space-y-1">
                            <li>{advisors.length} Adviseurs ingeladen</li>
                            <li>{sessions.length} Lezingen gevonden</li>
                            <li>{timeSlots.length} Tijdsloten herkend</li>
                            <li>{rooms.length} Zalen gevonden</li>
                        </ul>
                    </div>
                 ) : (
                   <p className="text-xs text-gray-400 italic">Selecteer eerst uw databestand om te beginnen.</p>
                 )}

                 <button 
                  onClick={handleRunAlgorithm}
                  disabled={!isFileUploaded}
                  className={`px-8 py-3 rounded-lg font-bold shadow w-full ${!isFileUploaded ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-agriGreen text-white hover:bg-green-700'}`}
                 >
                   Start Planning Algoritme (Extra Optimalisatie)
                 </button>
               </div>
             </div>
          )}

          {/* Loading Progress Modal */}
          {isSolving && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
                <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full animate-pulse-slow">
                    <h3 className="text-xl font-bold mb-4 text-agriGreen text-center">Planning Genereren...</h3>
                    
                    {progress ? (
                        <div className="mb-6">
                            <div className="flex justify-between text-xs font-mono mb-2 text-gray-500">
                                <span>Iteratie {progress.iteration}</span>
                                <span>{Math.round((progress.iteration / progress.maxIterations) * 100)}%</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                                <div 
                                    className="bg-agriGreen h-full rounded-full transition-all duration-300 ease-out" 
                                    style={{ width: `${(progress.iteration / progress.maxIterations) * 100}%` }}
                                ></div>
                            </div>
                            
                            <div className="mt-6 space-y-3 text-sm border-t border-gray-100 pt-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600">Verplicht Behaald</span>
                                    <span className={`font-mono font-bold ${progress.stats.mandatoryMetPercent === 100 ? 'text-green-600' : 'text-gray-400'}`}>
                                        {progress.stats.mandatoryMetPercent.toFixed(1)}%
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600">Conflicten</span>
                                    <span className={`font-mono font-bold ${progress.stats.capacityViolations === 0 ? 'text-green-600' : 'text-red-500'}`}>
                                        {progress.stats.capacityViolations}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600">Missende Lezingen</span>
                                    <span className={`font-mono font-bold ${progress.stats.unfilledSlots === 0 ? 'text-green-600' : 'text-orange-500'}`}>
                                        {progress.stats.unfilledSlots}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-600">Voorkeuren</span>
                                    <span className={`font-mono font-bold ${progress.stats.preferenceMetPercent >= 80 ? 'text-green-600' : 'text-blue-500'}`}>
                                        {progress.stats.preferenceMetPercent.toFixed(1)}%
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex justify-center py-8">
                             <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-agriGreen"></div>
                        </div>
                    )}
                    <p className="text-center text-xs text-gray-400 italic mt-2">Dit kan enkele seconden duren...</p>
                </div>
            </div>
          )}

          {/* Results Dashboard */}
          {result && (
            <>
              {/* Metrics Row */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <StatsCard 
                  title="Verplicht Behaald" 
                  value={`${result.stats.mandatoryMetPercent.toFixed(1)}%`} 
                  subtext="Doel: 100%"
                  color={result.stats.mandatoryMetPercent === 100 ? 'green' : 'red'}
                />
                <StatsCard 
                  title="Capaciteit Conflicten" 
                  value={result.stats.capacityViolations} 
                  subtext="Moet 0 zijn"
                  color={result.stats.capacityViolations === 0 ? 'green' : 'red'}
                />
                <StatsCard 
                  title="Missende Lezingen" 
                  value={result.stats.unfilledSlots} 
                  subtext="Doel: 0 (Volledig)"
                  color={result.stats.unfilledSlots === 0 ? 'green' : 'red'}
                />
                <StatsCard 
                  title="Te Kleine Groepen" 
                  value={result.stats.minSizeViolations} 
                  subtext="Groepen < 15"
                  color={result.stats.minSizeViolations === 0 ? 'green' : 'yellow'}
                />
                 <StatsCard 
                  title="Voorkeuren Score" 
                  value={`${result.stats.preferenceMetPercent.toFixed(1)}%`} 
                  subtext="Doel: > 80%"
                  color={result.stats.preferenceMetPercent > 80 ? 'green' : 'red'}
                />
                
                {/* Export Card */}
                <div className="p-4 rounded-lg border shadow-sm bg-gray-800 text-white flex flex-col justify-between">
                   <div>
                     <h3 className="text-sm font-medium uppercase tracking-wider opacity-80 text-gray-300">Export</h3>
                     <p className="text-lg font-bold mt-1">{advisors.length} PDF's + PPT</p>
                   </div>
                   <button 
                    onClick={handleExport}
                    disabled={isExporting}
                    className="mt-3 w-full bg-agriYellow text-black font-bold py-2 rounded text-sm hover:bg-yellow-400 disabled:opacity-50"
                   >
                     {isExporting ? 'Zipping...' : 'Download ZIP'}
                   </button>
                </div>
              </div>

              {/* Controls */}
              <div className="flex justify-between items-center bg-white p-4 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-bold text-gray-700">Filter op Adviseur:</label>
                  <select 
                    className="border border-gray-300 rounded px-3 py-1 text-sm focus:ring-2 focus:ring-agriGreen outline-none"
                    onChange={(e) => setSelectedAdvisorId(e.target.value ? parseInt(e.target.value) : null)}
                    value={selectedAdvisorId || ''}
                  >
                    <option value="">Toon Alles (Master View)</option>
                    {advisors.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                {selectedAdvisorId && (
                  <div className="text-sm text-gray-600">
                    Voorkeuren: {advisors.find(a => a.id === selectedAdvisorId)?.preferences.slice(0, 5).join(', ')}...
                  </div>
                )}
              </div>

              {/* Schedule Visualization */}
              <ScheduleView 
                schedule={result.instances} 
                selectedAdvisorId={selectedAdvisorId}
                sessions={sessions}
                timeSlots={timeSlots}
                rooms={rooms}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
