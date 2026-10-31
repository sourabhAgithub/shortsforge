export type Item = {
  id: string;
  name: string; // given by the user; empty = show the script
  text: string;
  voice: string; // "recording" for your own voice
  rate: number;
  pitch: number;
  duration: number;
  created_at: number;
  url: string;
  download: string;
};
