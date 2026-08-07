export {};

declare global {
  interface Window {
    luno: {
      backendUrl: string;
      platform: string;
      pickFolder: () => Promise<string | null>;
      pickImage: () => Promise<string | null>;
      pickVideos: () => Promise<string[]>;
    };
  }
}
