import { z } from 'zod';
export const id=z.uuid();
export const shortText=z.string().trim().min(1).max(2000);
export const textMessage=z.object({kind:z.enum(['text','emoji','image','audio','share']),body:z.string().max(8000).default(''),mediaId:id.optional(),storyId:id.optional()}).strict()
  .refine(v=>!(v.mediaId&&v.storyId),{path:['storyId']})
  .refine(v=>!v.storyId||!['image','audio'].includes(v.kind),{path:['storyId']})
  .refine(v=>!['image','audio'].includes(v.kind)||!!v.mediaId,{path:['mediaId']});
export const locationCoordinatesInput=z.object({latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),accuracy:z.number().finite().min(0).max(100000)}).strict();
export const locationDurationInput=z.union([z.literal(30),z.literal(60)]);
export const locationStartInput=locationCoordinatesInput.extend({durationMinutes:locationDurationInput.optional()}).strict();
export const storyCreateInput=z.object({
  mediaId:id.optional(),
  mediaIds:z.array(id).min(1).max(10).refine(values=>new Set(values).size===values.length,{message:'Choose each photo only once.'}).optional(),
  caption:z.string().trim().max(500).default(''),
  coordinates:locationCoordinatesInput.optional(),
  durationMinutes:locationDurationInput.optional(),
  // Keep accepting existing clients while the new composer always attempts geolocation.
  withLocation:z.boolean().optional(),
}).strict().refine(value=>Boolean(value.mediaId)!==Boolean(value.mediaIds),{path:['mediaIds'],message:'Choose either one photo or a photo group.'})
  .refine(value=>!(value.coordinates&&value.withLocation!==undefined),{path:['coordinates']})
  .refine(value=>!value.durationMinutes||Boolean(value.coordinates),{path:['durationMinutes']});
export const storySaveInput=z.object({linkedEntryId:id.nullable().optional()}).strict();
export const songInput=z.object({title:z.string().trim().min(1).max(200),artist:z.string().trim().min(1).max(200),album:z.string().max(300).default(''),version:z.string().max(200).default(''),mediaId:id.nullable().default(null)}).strict();
export const songSurpriseItemInput=z.union([
  z.object({song_id:id,mode:z.literal('question').default('question'),question:z.string().trim().max(500).optional()}).strict(),
  z.object({song_id:id,mode:z.literal('message'),message:shortText}).strict(),
  z.object({song_id:id,mode:z.literal('none')}).strict(),
]);
export const boxInput=z.object({items:z.array(songSurpriseItemInput).min(1).max(50),note:z.string().max(2000).default('')}).strict();
// Only the stored draw can decide whether an answer is required.
export const drawAnswerInput=z.object({answer:z.string().trim().max(2000).optional()}).strict();
export const feedInput=z.object({petId:id,kind:z.enum(['text','emoji','image','song']),content:shortText,question:z.string().trim().min(1).max(500),answer:shortText}).strict();
export const checkinInput=z.object({nonce:id,values:z.object({energy:shortText.optional(),wish:shortText.optional(),care:shortText.optional(),smallThing:shortText.optional()}).strict().refine(v=>Object.keys(v).length>0)}).strict();
export const entryInput=z.object({kind:z.enum(['memory','todo','wish','anniversary','preferences']),title:z.string().trim().min(1).max(200),body:z.string().max(8000).default(''),visibility:z.enum(['shared','personal']).default('shared'),event_date:z.iso.date().nullable().default(null),media_id:id.nullable().default(null),media_ids:z.array(id).min(1).max(20).optional()}).strict().refine(v=>!v.media_ids||(!v.media_id&&v.kind==='memory'&&new Set(v.media_ids).size===v.media_ids.length),{path:['media_ids']});
