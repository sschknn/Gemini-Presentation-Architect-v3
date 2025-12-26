
import React, { useRef, useState, useEffect } from 'react';
import { Slide, SlideLayout } from '../types';

interface SlideRendererProps {
  slide: Slide;
  isDarkMode?: boolean;
}

const SlideRenderer: React.FC<SlideRendererProps> = ({ slide, isDarkMode = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const BASE_WIDTH = 1920;
  const BASE_HEIGHT = 1080;

  useEffect(() => {
    const updateScale = () => {
      if (!containerRef.current || !containerRef.current.parentElement) return;
      const parent = containerRef.current.parentElement;
      const scaleW = parent.clientWidth / BASE_WIDTH;
      const scaleH = parent.clientHeight / BASE_HEIGHT;
      setScale(Math.min(scaleW, scaleH));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (containerRef.current?.parentElement) observer.observe(containerRef.current.parentElement);
    window.addEventListener('resize', updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, []);

  const bgMain = isDarkMode ? 'bg-[#050505]' : 'bg-white';
  const textTitle = isDarkMode ? 'text-white' : 'text-slate-900';
  const textSub = isDarkMode ? 'text-slate-500' : 'text-slate-400';
  const textContent = isDarkMode ? 'text-slate-400' : 'text-slate-600';
  const borderCol = isDarkMode ? 'border-white/5' : 'border-black/5';

  const renderLayout = () => {
    switch (slide.layout) {
      case SlideLayout.TITLE:
        return (
          <div className={`w-full h-full flex flex-col items-center justify-center text-center px-32 relative ${bgMain}`}>
            <div className="flex flex-col items-center z-10">
              <div className="w-24 h-2 bg-green-500 mb-12 shadow-[0_0_50px_rgba(34,197,94,0.6)] rounded-full"></div>
              <h1 className={`text-[12rem] font-black leading-[0.85] uppercase tracking-tighter mb-8 ${textTitle}`}>{slide.title}</h1>
              {slide.subTitle && <p className={`text-5xl font-medium max-w-5xl leading-relaxed ${textSub}`}>{slide.subTitle}</p>}
            </div>
          </div>
        );
      case SlideLayout.IMAGE_TEXT:
        return (
          <div className={`w-full h-full grid grid-cols-2 ${bgMain}`}>
            <div className="relative h-full">
              {slide.imageUrl ? (
                <img src={slide.imageUrl} className="w-full h-full object-cover grayscale opacity-60 contrast-125 brightness-90" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/5"><i className="fas fa-image text-8xl opacity-10"></i></div>
              )}
              <div className={`absolute inset-0 bg-gradient-to-r ${isDarkMode ? 'from-[#050505]' : 'from-white'} via-transparent`}></div>
            </div>
            <div className="p-32 flex flex-col justify-center space-y-16">
              <h2 className={`text-8xl font-black uppercase tracking-tighter leading-[0.9] ${textTitle}`}>{slide.title}</h2>
              <div className="space-y-10">
                {slide.content.map((item, i) => (
                  <div key={i} className="flex items-start space-x-10">
                    <div className="w-3 h-3 rounded-full bg-green-500 mt-4 flex-shrink-0 shadow-lg"></div>
                    <p className={`text-4xl leading-snug font-medium ${textContent}`}>{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      case SlideLayout.TWO_COLUMN:
        return (
          <div className={`w-full h-full flex flex-col p-32 ${bgMain}`}>
            <h2 className={`text-8xl font-black uppercase tracking-tighter mb-24 border-b pb-16 ${textTitle} ${borderCol}`}>{slide.title}</h2>
            <div className="grid grid-cols-2 gap-40 flex-1">
              {[0, 1].map(col => (
                <div key={col} className="space-y-12">
                  {slide.content.slice(col * 4, (col + 1) * 4).map((item, i) => (
                    <div key={i} className="flex items-start space-x-10">
                      <div className="w-4 h-4 rounded-sm bg-green-500 mt-3 flex-shrink-0 rotate-45"></div>
                      <p className={`text-4xl font-semibold leading-tight ${textContent}`}>{item}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      case SlideLayout.QUOTE:
        return (
          <div className={`w-full h-full flex flex-col items-center justify-center text-center p-40 relative ${bgMain}`}>
            <i className={`fas fa-quote-left text-green-500/20 text-[12rem] mb-12 opacity-20`}></i>
            <h2 className={`text-7xl leading-[1.15] font-light italic max-w-6xl z-10 ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>"{slide.content[0]}"</h2>
            <div className={`mt-24 text-3xl font-black uppercase tracking-[0.5em] opacity-50 ${textTitle}`}>{slide.title}</div>
          </div>
        );
      default:
        return (
          <div className={`w-full h-full flex flex-col p-32 ${bgMain}`}>
            <h2 className={`text-[9rem] font-black uppercase tracking-tighter leading-[0.8] mb-24 ${textTitle}`}>{slide.title}</h2>
            <div className="space-y-16 flex-1 max-w-6xl">
              {slide.content.map((item, i) => (
                <div key={i} className="flex items-start space-x-16">
                  <div className={`text-8xl font-black opacity-10 tabular-nums ${textTitle}`}>0{i + 1}</div>
                  <p className={`text-5xl leading-tight font-semibold mt-2 ${textContent}`}>{item}</p>
                </div>
              ))}
            </div>
          </div>
        );
    }
  };

  return (
    <div 
      ref={containerRef}
      className={`absolute top-1/2 left-1/2 overflow-hidden shadow-2xl ${bgMain}`}
      style={{ 
        width: BASE_WIDTH, height: BASE_HEIGHT, 
        transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: 'center center'
      }}
    >
      <div className="absolute top-20 right-20 z-20 opacity-20 font-black text-xl tracking-[0.6em] uppercase">Architect v5.2</div>
      {renderLayout()}
    </div>
  );
};

export default SlideRenderer;
