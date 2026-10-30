import type { ComponentType } from "react";
import {
  AudioLines,
  Captions,
  Clapperboard,
  Columns2,
  ImageIcon,
  type LucideIcon,
  MessageCircleMore,
  MessageSquareQuote,
  PersonStanding,
  ScrollText,
  Scissors,
  Sparkles,
  Trophy,
  Video,
} from "lucide-react";
import AiVideoTool from "./aivideo/AiVideoTool";
import PuppetTool from "./puppet/PuppetTool";
import RankingTool from "./ranking/RankingTool";
import VideoGenTool from "./videogen/VideoGenTool";
import VoiceoverTool from "./voiceover/VoiceoverTool";

/**
 * Every tool in the app. To add one: make a folder next to `ranking/` with a component that
 * handles its own sub-routes, then add an entry here with `status: "ready"` and `component`.
 * Backend routes are registered in backend/app/tools/__init__.py.
 */
export type ToolDef = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  group: "Create" | "Edit & automate" | "Voice & text";
  status: "ready" | "soon";
  cta?: string;
  component?: ComponentType;
};

export const TOOLS: ToolDef[] = [
  {
    id: "ranking",
    name: "Ranking Video",
    description: "Stack clips into a countdown with a bold title and a live rank list.",
    icon: Trophy,
    group: "Create",
    status: "ready",
    cta: "Start Ranking",
    component: RankingTool,
  },
  {
    id: "aivideo",
    name: "Multiple Clip Generator",
    description: "Generate footage from a text prompt.",
    icon: Clapperboard,
    group: "Create",
    status: "ready",
    cta: "Start Generating",
    component: AiVideoTool,
  },
  {
    id: "videogen",
    name: "Video Generator",
    description: "Edit one video: its sound, your own audio, captions and text anywhere.",
    icon: Video,
    group: "Create",
    status: "ready",
    cta: "Start Editing",
    component: VideoGenTool,
  },
  {
    id: "voiceover",
    name: "Voice Generator",
    description: "Turn a script into an MP3 in 70+ languages and hundreds of voices.",
    icon: AudioLines,
    group: "Create",
    status: "ready",
    cta: "Start Voicing",
    component: VoiceoverTool,
  },
  {
    id: "puppet",
    name: "Story Puppets",
    description: "Pick or draw a character, give it actions, and make a story video.",
    icon: PersonStanding,
    group: "Create",
    status: "ready",
    cta: "Start a Story",
    component: PuppetTool,
  },
  {
    id: "commentary",
    name: "Video Commentary",
    description: "Turn a script into scenes with commentary over your footage.",
    icon: MessageSquareQuote,
    group: "Create",
    status: "soon",
  },
  {
    id: "text-story",
    name: "Text Story",
    description: "Fake chat conversations that play out message by message.",
    icon: MessageCircleMore,
    group: "Create",
    status: "soon",
  },
  {
    id: "reddit-story",
    name: "Reddit Story",
    description: "Narrated Reddit posts over satisfying background gameplay.",
    icon: ScrollText,
    group: "Create",
    status: "soon",
  },
  {
    id: "ai-image",
    name: "AI Image Generator",
    description: "Create thumbnails and visual assets.",
    icon: ImageIcon,
    group: "Create",
    status: "soon",
  },
  {
    id: "split-screen",
    name: "Split Screen",
    description: "Pair your clip with gameplay to keep viewers watching.",
    icon: Columns2,
    group: "Edit & automate",
    status: "soon",
  },
  {
    id: "auto-clip",
    name: "Auto Clipping",
    description: "Cut a long video into short, ready-to-post clips.",
    icon: Scissors,
    group: "Edit & automate",
    status: "soon",
  },
  {
    id: "highlights",
    name: "Auto Highlights",
    description: "Find the most engaging moments in your footage.",
    icon: Sparkles,
    group: "Edit & automate",
    status: "soon",
  },
  {
    id: "captions",
    name: "Auto Captions",
    description: "Transcribe a video and burn in animated subtitles.",
    icon: Captions,
    group: "Voice & text",
    status: "soon",
  },
];

export const GROUPS: ToolDef["group"][] = ["Create", "Edit & automate", "Voice & text"];
