import { GoogleGenAI, Type } from "@google/genai";
import { Stage } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function generateStages(idea: string, budget: string): Promise<Stage[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate a 10-stage simulation journey for a startup idea: "${idea}" with an initial budget of "${budget}".
    The journey should be a professional, realistic path that a founder would take, organized into phases: 'Idea', 'Resources', 'Investors', 'Growth', 'Scale'.
    
    Assign a 'type' to each stage:
    - 'normal': Standard operational challenges.
    - 'pitch': A mock text pitch (e.g., elevator pitch).
    - 'video-pitch': A mock video pitch (e.g., for a demo day).
    - 'ppt-pitch': A mock pitch deck (PPT) evaluation (e.g., for a VC meeting).
    - 'crisis': An unexpected, high-stakes problem.
    
    Ensure at least 1 stage is 'video-pitch', 1 is 'ppt-pitch', 2 are 'pitch' and 1 is 'crisis'.
    
    Each stage needs:
    - id (1-10)
    - name
    - type ('normal' | 'pitch' | 'crisis' | 'video-pitch' | 'ppt-pitch')
    - phase ('Idea' | 'Resources' | 'Investors' | 'Growth' | 'Scale')
    - objective
    - tasks (array of 3 strings)
    - realWorldResources: An array of 2 objects with title, description, and a realistic link (e.g. to YC, Techstars, or relevant government sites).
    - governmentFundingGuide: An object with programName, eligibility, and submissionTips specific to the startup idea.
    - simulation scenario with 3 options. Each option has text, impact (budget change, trust change, impact change), and feedback.
    - realWorldCostEstimate: A string explaining how much this phase would realistically cost in the real world if successful (e.g., "$10,000 - $25,000 for initial MVP development").
    - simulationCost: A numeric value representing the cost to attempt this stage in the simulation (e.g., 5000). This should be a reasonable fraction of the total budget.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.INTEGER },
            name: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["normal", "pitch", "crisis", "video-pitch", "ppt-pitch"] },
            phase: { type: Type.STRING, enum: ["Idea", "Resources", "Investors", "Growth", "Scale"] },
            objective: { type: Type.STRING },
            tasks: { type: Type.ARRAY, items: { type: Type.STRING } },
            realWorldResources: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  link: { type: Type.STRING }
                },
                required: ["title", "description"]
              }
            },
            governmentFundingGuide: {
              type: Type.OBJECT,
              properties: {
                programName: { type: Type.STRING },
                eligibility: { type: Type.STRING },
                submissionTips: { type: Type.STRING }
              },
              required: ["programName", "eligibility", "submissionTips"]
            },
            simulation: {
              type: Type.OBJECT,
              properties: {
                scenario: { type: Type.STRING },
                options: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      impact: {
                        type: Type.OBJECT,
                        properties: {
                          budget: { type: Type.NUMBER },
                          trust: { type: Type.NUMBER },
                          impact: { type: Type.NUMBER }
                        },
                        required: ["budget", "trust", "impact"]
                      },
                      feedback: { type: Type.STRING }
                    },
                    required: ["text", "impact", "feedback"]
                  }
                }
              },
              required: ["scenario", "options"]
            },
            realWorldCostEstimate: { type: Type.STRING },
            simulationCost: { type: Type.NUMBER }
          },
          required: ["id", "name", "type", "phase", "objective", "tasks", "simulation", "realWorldResources", "governmentFundingGuide", "realWorldCostEstimate", "simulationCost"]
        }
      }
    }
  });

  return JSON.parse(response.text);
}

export async function evaluateVideoPitch(idea: string, stageName: string, videoBase64: string, mimeType: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        text: `You are a highly critical, high-stakes Angel Investor evaluating a mock VIDEO pitch for the startup idea: "${idea}" at the stage: "${stageName}".
        Analyze the video pitch for:
        1. Clarity of value proposition.
        2. Confidence and body language.
        3. Substantiated claims vs. hype.
        4. Professionalism.

        Be tough but fair. If the pitch is vague, over-hyped, or lacks substance, give a low score and set 'isBad' to true.
        Provide a score out of 100, detailed feedback from an investor's perspective, and 3 tough questions.
        If the pitch is bad, suggest specific improvements.`
      },
      {
        inlineData: {
          data: videoBase64,
          mimeType: mimeType
        }
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          feedback: { type: Type.STRING },
          questions: { type: Type.ARRAY, items: { type: Type.STRING } },
          isBad: { type: Type.BOOLEAN, description: "True if the pitch needs significant work" }
        },
        required: ["score", "feedback", "questions", "isBad"]
      }
    }
  });

  return JSON.parse(response.text);
}

export async function evaluatePptPitch(idea: string, stageName: string, pptContent: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are a VC Partner evaluating a Pitch Deck (PPT) summary for the startup idea: "${idea}" at the stage: "${stageName}".
    The user's pitch deck content/summary: "${pptContent}"
    
    Evaluate the deck for:
    1. Market size (TAM/SAM/SOM).
    2. Business model clarity.
    3. Competitive advantage (Moat).
    4. Financial projections realism.
    
    Provide a score out of 100, detailed feedback from a VC's perspective (be critical and practical), and 3 tough questions.
    If the deck is weak, set 'isBad' to true.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          feedback: { type: Type.STRING },
          questions: { type: Type.ARRAY, items: { type: Type.STRING } },
          isBad: { type: Type.BOOLEAN }
        },
        required: ["score", "feedback", "questions", "isBad"]
      }
    }
  });

  return JSON.parse(response.text);
}

export async function evaluateMockPitch(idea: string, stageName: string, pitchText: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are a highly critical Angel Investor evaluating a mock pitch for the startup idea: "${idea}" at the stage: "${stageName}".
    The user's pitch: "${pitchText}"
    
    Evaluate the pitch for:
    1. Clarity and impact.
    2. Feasibility of the model.
    3. Founder's grasp of the problem.
    
    Be tough. If the pitch is weak, vague, or unrealistic, give a low score and set 'isBad' to true.
    Provide a score out of 100, detailed feedback from an angel investor's perspective, and 2 tough questions for the user to answer.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          feedback: { type: Type.STRING },
          questions: { type: Type.ARRAY, items: { type: Type.STRING } },
          isBad: { type: Type.BOOLEAN }
        },
        required: ["score", "feedback", "questions", "isBad"]
      }
    }
  });

  return JSON.parse(response.text);
}

export async function evaluatePitch(idea: string, pitchText: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are a Lead Investor evaluating a final startup pitch for the idea: "${idea}".
    Pitch: "${pitchText}"
    
    This is the final evaluation. Be extremely critical. Look for scalability, unit economics, and market fit.
    If the pitch is not venture-scale or lacks a clear path to impact/profit, set 'isBad' to true.
    
    Provide a score out of 100, detailed feedback from an investor's perspective, and 3 hard questions to consider.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          feedback: { type: Type.STRING },
          questions: { type: Type.ARRAY, items: { type: Type.STRING } },
          isBad: { type: Type.BOOLEAN }
        },
        required: ["score", "feedback", "questions", "isBad"]
      }
    }
  });

  return JSON.parse(response.text);
}
