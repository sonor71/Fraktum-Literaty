export type PageType = 'cover' | 'title' | 'content';
export type WrapMode = 'none' | 'around';

export interface PageBackground {
  color: string;
  textColor: string;
  assetId: string | null;
  storagePath: string | null;
  assetPath?: string | null;
  fit: 'cover' | 'contain';
}

export interface CanvasObjectBase {
  id: string;
  type: 'text' | 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  locked: boolean;
}

export interface TextDocument {
  type: 'doc';
  content: Array<Record<string, unknown>>;
}

export interface TextObject extends CanvasObjectBase {
  type: 'text';
  content: TextDocument;
  style: Record<string, string | number | null>;
}

export interface ImageObject extends CanvasObjectBase {
  type: 'image';
  assetId: string;
  storagePath: string;
  assetPath: string;
  url: string;
  pageId: string;
  layoutMode: 'flow' | 'free';
  wrapMode: 'left' | 'right' | 'center' | 'full' | 'around' | 'none';
  alt: string;
  caption: string;
  previewUrl?: string;
  crop: { x: number; y: number; width: number; height: number };
  opacity: number;
  wrap: WrapMode;
  wrapGap: number;
}

export type CanvasObject = TextObject | ImageObject;

export interface CanvasPage {
  id: string;
  type: PageType;
  width: number;
  height: number;
  background: PageBackground;
  objects: CanvasObject[];
  connections: CanvasConnection[];
}

export interface CanvasConnection {
  id: string;
  fromObjectId: string;
  toObjectId: string;
  type: 'cause' | 'relation' | 'dependency' | 'hypothesis';
  label: string;
  style: {width: number; dash: boolean};
}

export interface BookDocument {
  version: 1;
  pages: CanvasPage[];
}

export type SaveStatus = 'unsaved' | 'saving' | 'saved' | 'offline' | 'error' | 'conflict';
