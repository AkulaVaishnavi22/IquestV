export interface Stage {
  id: number;
  name: string;
  type: 'normal' | 'pitch' | 'crisis' | 'video-pitch' | 'ppt-pitch';
  phase: 'Idea' | 'Resources' | 'Investors' | 'Growth' | 'Scale';
  objective: string;
  tasks: string[];
  realWorldResources: {
    title: string;
    description: string;
    link?: string;
  }[];
  governmentFundingGuide?: {
    programName: string;
    eligibility: string;
    submissionTips: string;
  };
  simulation: {
    scenario: string;
    options: {
      text: string;
      impact: {
        budget: number;
        trust: number;
        impact: number;
      };
      feedback: string;
    }[];
  };
  realWorldCostEstimate: string;
  simulationCost: number;
}

export interface GameState {
  idea: string;
  audience: string;
  budget: number;
  trust: number;
  impact: number;
  currentStage: number;
  stages: Stage[];
  isGameOver: boolean;
  stageStatus: 'overview' | 'simulation' | 'feedback';
  performanceHistory: number[];
  pitchFeedback?: {
    score: number;
    feedback: string;
    questions: string[];
    isBad?: boolean;
  };
}
