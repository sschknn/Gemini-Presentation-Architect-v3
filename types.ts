
export enum SlideLayout {
  TITLE = 'TITLE',
  CONTENT = 'CONTENT',
  TWO_COLUMN = 'TWO_COLUMN',
  IMAGE_TEXT = 'IMAGE_TEXT',
  QUOTE = 'QUOTE'
}

export interface Slide {
  id: string;
  title: string;
  content: string[];
  layout: SlideLayout;
  imageUrl?: string;
  imagePrompt?: string; 
  subTitle?: string;
}

export interface Presentation {
  id: string;
  title: string;
  slides: Slide[];
  sources?: { title: string; uri: string }[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  sources?: { title: string; uri: string }[];
}
