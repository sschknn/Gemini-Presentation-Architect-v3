
import { GoogleGenAI, Type, FunctionDeclaration, GenerateContentResponse } from "@google/genai";
import { Presentation, SlideLayout } from "../types";

export const createPresentationTool: FunctionDeclaration = {
  name: 'create_presentation',
  description: 'Erstellt eine komplett neue Präsentation mit 8 Folien zu einem bestimmten Thema. Nutze dies, wenn der User eine neue Präsentation oder eine Testfolie wünscht.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      topic: {
        type: Type.STRING,
        description: 'Das Hauptthema der Präsentation (z.B. "Zukunft der KI" oder "Test-Präsentation").'
      }
    },
    required: ['topic']
  }
};

export const generateImage = async (prompt: string): Promise<string> => {
  // Immer neue Instanz für aktuellsten Key
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response: GenerateContentResponse = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [{ text: `Professional high-end cinematic presentation slide background: ${prompt}. Minimalist, futuristic, dark aesthetics, 4k resolution, no text in image.` }]
    },
    config: {
      imageConfig: {
        aspectRatio: "16:9"
      }
    }
  });

  if (response.candidates?.[0]?.content?.parts) {
    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  }
  throw new Error("Bildgenerierung fehlgeschlagen");
};

export const generatePresentationStructure = async (topic: string): Promise<Presentation> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const prompt = `Erstelle eine professionelle Präsentation zum Thema: "${topic}". 
  Anforderungen:
  - Exakt 8 Folien.
  - Nutze Google Search für aktuelle Fakten und Trends.
  - Layouts: TITLE, CONTENT, IMAGE_TEXT, TWO_COLUMN, QUOTE.
  - Jede Folie braucht einen 'imagePrompt' für die Bild-KI (beschreibe nur das visuelle Motiv).
  - Gib NUR valides JSON zurück.`;

  const response: GenerateContentResponse = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: { parts: [{ text: prompt }] },
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          title: { type: Type.STRING },
          slides: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                subTitle: { type: Type.STRING },
                content: { type: Type.ARRAY, items: { type: Type.STRING } },
                layout: { type: Type.STRING, enum: Object.values(SlideLayout) },
                imagePrompt: { type: Type.STRING }
              },
              required: ["id", "title", "content", "layout", "imagePrompt"]
            }
          }
        },
        required: ["id", "title", "slides"]
      }
    }
  });

  const presentation: Presentation = JSON.parse(response.text || '{}');
  
  // Extrahiere Grounding-Quellen (Pflicht bei Google Search)
  const sources: {title: string, uri: string}[] = [];
  const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (groundingChunks) {
    groundingChunks.forEach((chunk: any) => {
      if (chunk.web?.uri) {
        sources.push({ title: chunk.web.title || chunk.web.uri, uri: chunk.web.uri });
      }
    });
  }
  
  // Duplikate entfernen
  presentation.sources = Array.from(new Map(sources.map(s => [s.uri, s])).values());

  return presentation;
};
