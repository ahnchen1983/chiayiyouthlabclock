
import { GoogleGenAI, Type } from "@google/genai";
import { Shift, User } from "../types";

const apiKey = process.env.API_KEY || "dummy_key_for_dev";
const ai = new GoogleGenAI({ apiKey });

export const getGeminiScheduleAdvice = async (shifts: Shift[], users: User[]) => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
        Analyze the following team shift schedule and provide 3 key insights or recommendations for improvement. 
        Focus on coverage gaps, employee fatigue (back-to-back shifts), or distribution.
        
        Team: ${JSON.stringify(users.map(u => u.name))}
        Current Schedule: ${JSON.stringify(shifts)}
        
        Provide the response in a concise list.
      `,
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "無法生成 AI 建議（請檢查 API Key）。";
  }
};

export const suggestWeeklySchedule = async (users: User[], weekStartDate: string) => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Generate a balanced weekly shift schedule for a team of ${users.length} people starting from ${weekStartDate}. 
                 Ensure everyone has at least 2 days off and shifts are distributed fairly.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              userName: { type: Type.STRING },
              date: { type: Type.STRING },
              type: { type: Type.STRING, enum: ['Morning', 'Afternoon', 'Night'] },
              startTime: { type: Type.STRING },
              endTime: { type: Type.STRING },
            },
            required: ["userName", "date", "type", "startTime", "endTime"]
          }
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini Smart Schedule Error:", error);
    throw new Error("AI 排班服務暫時無法使用。");
  }
};
