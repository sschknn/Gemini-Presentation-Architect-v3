
import React, { useState, useEffect, useRef } from 'react';
import { Presentation, Slide, SlideLayout } from './types';
import { generatePresentationStructure, generateImage, createPresentationTool } from './services/geminiService';
import SlideRenderer from './components/SlideRenderer';
import { GoogleGenAI, LiveServerMessage, FunctionDeclaration, Type, Modality } from "@google/genai";
import { decodeBase64, pcmToAudioBuffer, createPCMBlob } from './services/audioUtils';

const LOCAL_STORAGE_KEY = 'gemini_architect_v5_save';

const updateSlideTool: FunctionDeclaration = {
  name: 'update_slide',
  description: 'Aktualisiert die aktuelle Folie mit neuen Inhalten oder Layouts.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: 'Neuer Titel der Folie.' },
      subTitle: { type: Type.STRING, description: 'Neuer Untertitel.' },
      content: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Neue Bullet-Points.' },
      layout: { type: Type.STRING, enum: Object.values(SlideLayout), description: 'Neues Layout.' }
    }
  }
};

const App: React.FC = () => {
  const [presentation, setPresentation] = useState<Presentation>({ 
    id: '1', 
    title: 'Präsentations-KI', 
    slides: [{ 
      id: '1', 
      title: 'Bereit für Ihre Vision', 
      content: ['Klicken Sie auf das Mikrofon', 'Sprechen Sie: "Erstelle eine Präsentation über [Thema]"'], 
      layout: SlideLayout.TITLE 
    }] 
  });
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'active'>('idle');
  const [liveTranscription, setLiveTranscription] = useState('');
  const [manualTopic, setManualTopic] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [visualizerData, setVisualizerData] = useState<number[]>(new Array(16).fill(0));
  const [micLevel, setMicLevel] = useState(0);

  // Refs für Audio-Hardware
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Timing & Audio Queuing
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const handleGenerateRef = useRef<any>(null);
  const handleUpdateRef = useRef<any>(null);

  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try { 
        const parsed = JSON.parse(saved); 
        if (parsed.slides) setPresentation(parsed); 
      } catch (e) {}
    }
    return () => stopLive();
  }, []);

  const handleUpdateCurrentSlide = (updates: Partial<Slide>) => {
    setPresentation(prev => {
      const news = [...prev.slides];
      news[activeSlideIndex] = { ...news[activeSlideIndex], ...updates };
      const updated = { ...prev, slides: news };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };
  handleUpdateRef.current = handleUpdateCurrentSlide;

  const handleGenerate = async (topic: string) => {
    if (!topic || isGenerating) return;
    setIsGenerating(true);
    try {
      const pres = await generatePresentationStructure(topic);
      setPresentation(pres);
      setActiveSlideIndex(0);
      setIsGenerating(false);
      setIsPainting(true);
      
      for (let i = 0; i < pres.slides.length; i++) {
        if (pres.slides[i].imagePrompt) {
          generateImage(pres.slides[i].imagePrompt!).then(url => {
            setPresentation(p => {
              const n = [...p.slides];
              if (n[i]) n[i].imageUrl = url;
              const next = { ...p, slides: n };
              localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
              return next;
            });
          }).catch(console.error);
        }
      }
    } catch (e) {
      console.error("Generierung fehlgeschlagen:", e);
      setIsGenerating(false);
    } finally {
      setIsPainting(false);
    }
  };
  handleGenerateRef.current = handleGenerate;

  const startLive = async () => {
    try {
      setConnectionStatus('connecting');
      
      // 1. Zugriff auf Mikrofon
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        } 
      });
      streamRef.current = stream;

      // 2. Audio-Kontexte initialisieren
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      await inputCtx.resume();
      await outputCtx.resume();
      
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;

      // 3. Signal-Kette aufbauen mit Gain (Verstärkung)
      const source = inputCtx.createMediaStreamSource(stream);
      
      // Verstärker hinzufügen, falls das Mikrofon zu leise ist
      const gainNode = inputCtx.createGain();
      gainNode.gain.value = 2.5; // Verstärkung um Faktor 2.5 für Visualizer & KI

      const analyser = inputCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;

      const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = scriptProcessor;

      // Kette: Source -> Gain -> Analyser -> ScriptProcessor -> Destination
      source.connect(gainNode);
      gainNode.connect(analyser);
      analyser.connect(scriptProcessor);
      scriptProcessor.connect(inputCtx.destination);

      // 4. Visualisierungs-Loop
      const updateVis = () => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        
        let sum = 0;
        let max = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
          if (data[i] > max) max = data[i];
        }
        
        // Nutze den Max-Wert für reaktiveren Ausschlag
        const level = max / 255;
        setMicLevel(level);

        const simplified = Array.from({length: 16}, (_, i) => {
          const idx = Math.floor(i * data.length / 16);
          return data[idx] / 255;
        });
        setVisualizerData(simplified);
        animationFrameRef.current = requestAnimationFrame(updateVis);
      };
      updateVis();

      // 5. Gemini Live Verbindung
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const systemInstruction = `Du bist ein proaktiver Präsentations-Assistent. 
      WICHTIG: Erstelle SOFORT eine Präsentation mit 8 Folien, wenn der User ein Thema nennt. Nutze das Tool 'create_presentation'.
      ANTWORTE IMMER AUF DEUTSCH.
      Sollte der User nur "Hallo" sagen, frage ihn nach einem Thema.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setConnectionStatus('active');
            
            scriptProcessor.onaudioprocess = (e) => {
              const pcmData = e.inputBuffer.getChannelData(0);
              const base64Data = createPCMBlob(pcmData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({
                  media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            };
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              setLiveTranscription("Du: " + message.serverContent.inputTranscription.text);
            } else if (message.serverContent?.outputTranscription) {
              setLiveTranscription("KI: " + message.serverContent.outputTranscription.text);
            }

            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'create_presentation') {
                  handleGenerateRef.current((fc.args as any).topic);
                } else if (fc.name === 'update_slide') {
                  handleUpdateRef.current(fc.args as any);
                }
                sessionPromise.then(s => s.sendToolResponse({
                  functionResponses: { id: fc.id, name: fc.name, response: { result: "OK" } }
                }));
              }
            }

            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  const buf = await pcmToAudioBuffer(decodeBase64(part.inlineData.data), outputCtx, 24000, 1);
                  const source = outputCtx.createBufferSource();
                  source.buffer = buf;
                  source.connect(outputCtx.destination);
                  const now = outputCtx.currentTime;
                  if (nextStartTimeRef.current < now) nextStartTimeRef.current = now + 0.05;
                  source.start(nextStartTimeRef.current);
                  nextStartTimeRef.current += buf.duration;
                  audioSourcesRef.current.add(source);
                  source.onended = () => audioSourcesRef.current.delete(source);
                }
              }
            }

            if (message.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => { stopLive(); },
          onclose: () => stopLive()
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [createPresentationTool, updateSlideTool] }],
          systemInstruction: systemInstruction,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (e) {
      setConnectionStatus('idle');
      alert("Mikrofon-Zugriff nicht möglich.");
    }
  };

  const stopLive = () => {
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(s => s.close()).catch(() => {});
      sessionPromiseRef.current = null;
    }
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    inputAudioCtxRef.current?.close().catch(() => {});
    outputAudioCtxRef.current?.close().catch(() => {});
    setConnectionStatus('idle');
    setLiveTranscription('');
    setMicLevel(0);
    setVisualizerData(new Array(16).fill(0));
    nextStartTimeRef.current = 0;
  };

  return (
    <div className={`flex flex-col lg:flex-row h-screen transition-all overflow-hidden ${isDarkMode ? 'bg-[#050505] text-white' : 'bg-slate-50 text-slate-900'}`}>
      
      {/* Thumbnails Sidebar */}
      <aside className={`z-40 lg:w-24 lg:hover:w-64 flex flex-row lg:flex-col border-t lg:border-r lg:border-t-0 order-last lg:order-first backdrop-blur-3xl shadow-2xl transition-all duration-300 ${isDarkMode ? 'bg-black/80 border-white/5' : 'bg-white/90 border-black/5'}`}>
        <div className="flex-1 overflow-x-auto lg:overflow-y-auto p-3 flex lg:flex-col gap-4 custom-scrollbar">
          {presentation.slides.map((s, idx) => (
            <div key={idx} onClick={() => setActiveSlideIndex(idx)} className={`cursor-pointer rounded-lg overflow-hidden border-2 transition-all w-28 lg:w-full aspect-video flex-shrink-0 relative ${activeSlideIndex === idx ? 'border-green-500 scale-105 shadow-xl' : 'border-transparent opacity-40'}`}>
              <div className="absolute inset-0 scale-[0.08] origin-top-left pointer-events-none"><SlideRenderer slide={s} isDarkMode={isDarkMode} /></div>
            </div>
          ))}
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Header mit Status & Visualizer */}
        <header className="h-20 flex items-center justify-between px-8 border-b border-white/5 z-50 backdrop-blur-md">
          <div className="flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40">{presentation.title}</span>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${connectionStatus === 'active' ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-white/10'}`}></div>
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">
                {connectionStatus === 'active' ? 'Sprachsteuerung aktiv' : 'Status: ' + connectionStatus}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
              <i className={`fas ${isDarkMode ? 'fa-sun' : 'fa-moon'}`}></i>
            </button>
            
            {/* Mikrofon Button & LED Meter */}
            <div className="flex items-center gap-5">
              {connectionStatus === 'active' && (
                <div className="flex flex-col gap-1 items-center">
                  <span className="text-[8px] font-black uppercase tracking-widest text-green-500/50 mb-1">Signal</span>
                  <div className="flex gap-1 h-8 items-end">
                    {[0, 0.2, 0.4, 0.6, 0.8].map((threshold, i) => (
                      <div 
                        key={i} 
                        className={`w-2 rounded-sm transition-all duration-75 ${micLevel > threshold ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-white/10'}`}
                        style={{ height: `${20 + (i * 20)}%` }}
                      ></div>
                    ))}
                  </div>
                </div>
              )}

              <button 
                onClick={connectionStatus === 'idle' ? startLive : stopLive} 
                className={`w-16 h-16 rounded-full flex items-center justify-center transition-all relative ${connectionStatus === 'active' ? 'bg-red-500 text-white' : 'bg-green-500 text-black shadow-xl shadow-green-500/20 hover:scale-105 active:scale-95'}`}
              >
                {connectionStatus === 'active' && (
                  <>
                    <div className="absolute inset-0 rounded-full border-4 border-red-500/20 animate-ping"></div>
                    <div 
                      className="absolute inset-0 rounded-full bg-red-500/10 transition-transform duration-75" 
                      style={{ transform: `scale(${1 + micLevel})` }}
                    ></div>
                  </>
                )}
                <i className={`fas ${connectionStatus === 'idle' ? 'fa-microphone' : 'fa-stop'} text-2xl`}></i>
              </button>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 relative flex flex-col items-center justify-center p-6">
          {liveTranscription && (
            <div className="absolute top-10 px-8 py-3 bg-black/95 border border-green-500/50 rounded-full text-green-500 font-bold text-[12px] uppercase tracking-widest z-[60] shadow-[0_0_40px_rgba(0,0,0,0.5)] backdrop-blur-xl animate-bounce-subtle text-center max-w-2xl">
              {liveTranscription}
            </div>
          )}

          <div className="w-full h-full max-w-6xl max-h-[75vh] relative rounded-[3rem] overflow-hidden border border-white/10 bg-black shadow-2xl group ring-1 ring-white/5">
            <SlideRenderer slide={presentation.slides[activeSlideIndex]} isDarkMode={isDarkMode} />
            
            <div className="absolute inset-x-0 bottom-0 p-8 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-all pointer-events-none translate-y-4 group-hover:translate-y-0">
              <button onClick={() => setActiveSlideIndex(v => Math.max(0, v - 1))} className="w-12 h-12 rounded-full bg-black/60 border border-white/10 text-white hover:bg-green-500 hover:text-black transition-all pointer-events-auto flex items-center justify-center"><i className="fas fa-chevron-left"></i></button>
              <div className="px-6 py-2 bg-black/60 rounded-full text-[10px] font-black tracking-widest text-white border border-white/10 backdrop-blur-md uppercase">Slide {activeSlideIndex + 1} / {presentation.slides.length}</div>
              <button onClick={() => setActiveSlideIndex(v => Math.min(presentation.slides.length - 1, v + 1))} className="w-12 h-12 rounded-full bg-black/60 border border-white/10 text-white hover:bg-green-500 hover:text-black transition-all pointer-events-auto flex items-center justify-center"><i className="fas fa-chevron-right"></i></button>
            </div>
          </div>

          <div className="mt-8 w-full max-w-lg flex gap-3">
            <input 
              type="text" 
              value={manualTopic}
              onChange={(e) => setManualTopic(e.target.value)}
              placeholder="Thema eintippen oder einfach sprechen..."
              onKeyDown={(e) => e.key === 'Enter' && manualTopic && (handleGenerate(manualTopic), setManualTopic(''))}
              className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:border-green-500/50 transition-all"
            />
            <button 
              onClick={() => manualTopic && (handleGenerate(manualTopic), setManualTopic(''))}
              className="px-8 py-4 bg-green-500 text-black text-[10px] font-black uppercase tracking-widest rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-lg shadow-green-500/20"
            >
              Start
            </button>
          </div>
        </div>

        {/* Loading */}
        {(isGenerating || isPainting) && (
          <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex flex-col items-center justify-center animate-fadeIn text-center p-10">
            <div className="relative">
              <div className="w-32 h-32 border-2 border-green-500/20 border-t-green-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <i className="fas fa-presentation-screen text-green-500 text-2xl animate-pulse"></i>
              </div>
            </div>
            <h2 className="text-2xl font-black uppercase tracking-[0.5em] text-white mt-12">
              {isGenerating ? 'Architektur wird entworfen' : 'Visuals werden berechnet'}
            </h2>
            <p className="mt-4 text-[10px] uppercase tracking-widest text-slate-500">Gemini Pro erstellt hochqualitative Inhalte für Sie</p>
          </div>
        )}
      </main>
      <style>{`
        @keyframes bounce-subtle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        .animate-bounce-subtle { animation: bounce-subtle 3s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

export default App;
