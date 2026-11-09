import { AIProvider } from '../ai/provider';
export function model() {
  return new AIProvider({baseUrl:process.env.AI_BASE_URL||'',key:process.env.AI_API_KEY||'',model:process.env.AI_MODEL||'',visionModel:process.env.AI_VISION_MODEL});
}
