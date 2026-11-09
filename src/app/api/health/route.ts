export function GET() {
  return Response.json({status:'ok',databaseConfigured:Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY),aiConfigured:Boolean(process.env.AI_BASE_URL && process.env.AI_API_KEY && process.env.AI_MODEL)},{headers:{'Cache-Control':'no-store'}});
}
